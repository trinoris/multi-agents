/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * `verify` — the adoption gate (spec 05, MA-01).
 *
 * The protocol rests on `mkdir` being atomic on the target filesystem. If it is not,
 * the protocol does not apply to that tree and must not be installed. So this races
 * real OS processes rather than checking a flag: the whole point is to find out whether
 * this filesystem behaves, not whether we believe it does. Worker threads issue
 * the mkdir calls concurrently without starting a shell or subprocess.
 */

import fs, { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { PROTOCOL_TEXT, PROTOCOL_VERSION } from '@trinoris/agent-core';
import { loadConfiguration, readText, removeOwnedDirectory, safePath } from '@trinoris/agent-sdk';

export interface VerifyResult {
  structureOk: boolean;
  configOk: boolean;
  protocolOk: boolean;
  gitignoreOk: boolean;
  ready: boolean;
  /** null means the probe could not run to completion; it is not an atomicity failure. */
  atomicityOk: boolean | null;
  filesystem: string;
  trials: number;
  concurrency: number;
  badTrials: number;
  totalWinners: number;
  probeErrors: string[];
  notes: string[];
}

const RACE_TIMEOUT_MS = 15_000;

function validateOptions(trials: number, concurrency: number): void {
  if (!Number.isInteger(trials) || trials < 1) {
    throw new RangeError(`trials must be a positive integer; received ${trials}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 2) {
    throw new RangeError(`concurrency must be an integer of at least 2; received ${concurrency}`);
  }
  if (trials > 100) throw new RangeError('trials must be at most 100');
  if (concurrency > 32) throw new RangeError('concurrency must be at most 32');
  if (trials * concurrency > 1024) throw new RangeError('trials x concurrency must be at most 1024');
}

function filesystemOf(path: string): { name: string; warning?: string } {
  try {
    // Keep the filesystem probe usable if the runtime omits the optional statfs API.
    if (typeof fs.statfsSync !== 'function') return { name: 'unknown', warning: 'filesystem type is unavailable in this Node.js version' };
    const type = fs.statfsSync(path).type >>> 0;
    const known: Record<number, string> = { 0xef53: 'ext-family', 0x794c7630: 'overlayfs', 0x6969: 'nfs', 0x01021994: 'tmpfs', 0x01021997: '9p' };
    return { name: known[type] ?? `fs-type-0x${type.toString(16)}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name: 'unknown', warning: `could not identify filesystem type: ${detail}` };
  }
}

/** One trial: N worker threads race the same filesystem mkdir after a shared barrier. */
async function raceOnce(lockPath: string, barrier: string, n: number, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw new Error('probe aborted');
  const sharedBarrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  let timedOut = false;
  const workers: Array<{ worker: Worker; readyPromise: Promise<void>; resultPromise: Promise<{ code: number | null; signal: null; error?: string }>; output: () => string }> = [];
  try {
   for (let index = 0; index < n; index++) {
    const worker = new Worker(new URL('./race-worker.mjs', import.meta.url), { workerData: { lockPath, barrier: sharedBarrier, timeoutMs } });
    let output = '';
    let workerError: string | undefined;
    let ready = false;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let resultResolve!: (result: { code: number | null; signal: null; error?: string }) => void;
    const readyPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // A later Worker constructor can fail before the shared Promise.all is formed.
    // Mark this promise handled immediately; callers still observe the original rejection.
    void readyPromise.catch(() => undefined);
    const resultPromise = new Promise<{ code: number | null; signal: null; error?: string }>((resolve) => { resultResolve = resolve; });
    worker.on('message', (message: { type?: string; outcome?: string; error?: string }) => {
      if (message?.type === 'ready' && !ready) { ready = true; output += 'READY\n'; readyResolve(); }
      else if (message?.type === 'outcome' && (message.outcome === 'WIN' || message.outcome === 'LOSE')) output += `${message.outcome}\n`;
      else if (message?.type === 'error') workerError = message.error ?? 'unknown worker error';
    });
    worker.on('error', (error) => {
      const detail = `race worker failed: ${error.message}`;
      workerError = detail;
      readyReject(new Error(detail));
    });
    worker.on('exit', (code) => {
      if (!ready) {
        const reason = timedOut ? `race workers timed out after ${timeoutMs / 1000}s` : `race worker exited before READY (code ${code})`;
        readyReject(new Error(reason));
      }
      resultResolve({ code, signal: null, ...(workerError ? { error: workerError } : {}) });
    });
    workers.push({ worker, readyPromise, resultPromise, output: () => output });
   }
  } catch (error) {
    for (const entry of workers) void entry.worker.terminate();
    await Promise.all(workers.map(entry => entry.resultPromise));
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not start race worker: ${detail}`, { cause: error });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    for (const entry of workers) void entry.worker.terminate();
  }, timeoutMs);
  const abort = () => { for (const entry of workers) void entry.worker.terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await Promise.all(workers.map(entry => entry.readyPromise));
    Atomics.store(new Int32Array(sharedBarrier), 0, 1);
    Atomics.notify(new Int32Array(sharedBarrier), 0, n);
    const results = await Promise.all(workers.map(entry => entry.resultPromise));
    if (signal?.aborted) throw new Error('probe aborted');
    if (timedOut) throw new Error(`race workers timed out after ${timeoutMs / 1000}s`);
    const errors: string[] = [];
    let winners = 0;
    let losers = 0;
    results.forEach((result, index) => {
      const output = workers[index].output();
      const outcomes = output.match(/^(WIN|LOSE)$/gm) ?? [];
      if (result.error) errors.push(`worker ${index}: ${result.error}`);
      else if (result.code !== 0) errors.push(`worker ${index} exited with code ${result.code}, signal ${result.signal ?? 'none'}`);
      else if (!/^READY$/m.test(output) || outcomes.length !== 1) errors.push(`worker ${index} returned an invalid response: ${JSON.stringify(output)}`);
      else if (outcomes[0] === 'WIN') winners++;
      else losers++;
    });
    if (errors.length) throw new Error(errors.join('; '));
    if (winners + losers !== n) throw new Error(`received ${winners + losers} race outcomes from ${n} workers`);
    return winners;
  } catch (error) {
    for (const entry of workers) void entry.worker.terminate();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    await Promise.all(workers.map(entry => entry.resultPromise));
  }
}

export async function verify(workDir: string, trials = 50, concurrency = 8, options: { signal?: AbortSignal } = {}): Promise<VerifyResult> {
  validateOptions(trials, concurrency);
  const coord = join(workDir, '.trinoris');
  const notes: string[] = [];

  const required = ['locks', 'claims', 'handoff', 'active', 'archive', 'incidents'];
  const missing = required.filter(d => !safePath(workDir, join(coord, d))?.isDirectory());
  const structureOk = !!safePath(workDir, coord)?.isDirectory() && missing.length === 0;
  if (!structureOk) {
    notes.push(safePath(workDir, coord)
      ? `missing subdirectories: ${missing.join(', ')}`
      : `no .trinoris/ in ${workDir} — run setup first`);
  }

  let configOk = false;
  try { loadConfiguration({ root: coord }, true); configOk = true; }
  catch (e) { notes.push(`configuration not ready: ${e instanceof Error ? e.message : String(e)}`); }
  let protocolOk = false;
  let gitignoreOk = false;
  try {
    gitignoreOk = (readText(workDir, join(workDir, '.gitignore'), 1024 * 1024) ?? '')
      .split(/\r?\n/).some(line => line.trim() === '/.trinoris/');
    if (!gitignoreOk) notes.push('missing /.trinoris/ ignore rule in .gitignore; rerun setup');
  } catch (e) { notes.push(`gitignore not ready: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const contract = readText(workDir, join(coord, 'PROTOCOL.md'), 65536);
    const meta = JSON.parse(readText(workDir, join(coord, 'protocol.json')) ?? 'null');
    const expected = createHash('sha256').update(PROTOCOL_TEXT).digest('hex');
    protocolOk = contract !== null && meta?.version === PROTOCOL_VERSION && meta?.sha256 === expected && createHash('sha256').update(contract).digest('hex') === expected;
    if (!protocolOk) notes.push('protocol missing or divergent: run setup and inspect the package-owned contract');
    for (const path of ['AGENTS.md', 'CLAUDE.md', '.claude/skills/agent-handoff/SKILL.md']) {
      if (!readText(workDir, join(workDir, path))?.includes('.trinoris/PROTOCOL.md')) { protocolOk = false; notes.push('missing generated protocol pointer'); }
    }
  } catch (e) { notes.push(`protocol not ready: ${e instanceof Error ? e.message : String(e)}`); }

  // Race in the tree being verified — the filesystem under .trinoris/ is the one
  // that has to behave. Fall back to tmp only when the tree is not set up yet.
  const arenaBase = structureOk ? coord : tmpdir();
  if (!safePath(arenaBase)?.isDirectory()) throw new Error('Unsafe verifier filesystem root');
  const arena = mkdtempSync(join(arenaBase, '.verify-atomicity-'));

  let badTrials = 0, totalWinners = 0;
  const probeErrors: string[] = [];
  let filesystem = 'unknown';
  const deadline = Date.now() + 60_000;
  try {
  for (let t = 0; t < trials; t++) {
    const lock = join(arena, `t${t}.lock`);
    const barrier = join(arena, `go${t}`);
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('overall probe deadline exceeded');
      const winners = await raceOnce(lock, barrier, concurrency, Math.min(RACE_TIMEOUT_MS, remaining), options.signal);
      totalWinners += winners;
      if (winners !== 1) {
        badTrials++;
        notes.push(`trial ${t}: ${winners} winners (expected exactly 1)`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      probeErrors.push(`trial ${t}: ${detail}`);
      notes.push(`atomicity probe failed: trial ${t}: ${detail}`);
      break;
    }
  }
  const filesystemInfo = filesystemOf(arena);
  filesystem = filesystemInfo.name;
  if (filesystemInfo.warning) notes.push(filesystemInfo.warning);
  } finally { removeOwnedDirectory(arenaBase, arena); }

  const atomicityOk = probeErrors.length ? null : badTrials === 0 && totalWinners === trials;
  if (atomicityOk === false) {
    notes.push('mkdir is NOT atomic here — do not install the protocol in this tree');
  }
  return { structureOk, configOk, protocolOk, gitignoreOk, ready: structureOk && configOk && protocolOk && gitignoreOk && atomicityOk === true, atomicityOk, filesystem, trials, concurrency, badTrials, totalWinners, probeErrors, notes };
}
