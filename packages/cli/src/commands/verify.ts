/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * `verify` — the adoption gate (spec 05, MA-01).
 *
 * The protocol rests on `mkdir` being atomic on the target filesystem. If it is not,
 * the protocol does not apply to that tree and must not be installed. So this races
 * real OS processes rather than checking a flag: the whole point is to find out whether
 * this filesystem behaves, not whether we believe it does.
 */

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export interface VerifyResult {
  structureOk: boolean;
  configOk: boolean;
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
}

function filesystemOf(path: string): { name: string; warning?: string } {
  try {
    return { name: execFileSync('stat', ['-f', '-c', '%T', path], { encoding: 'utf8' }).trim() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name: 'unknown', warning: `could not identify filesystem type: ${detail}` };
  }
}

/**
 * One trial: N real processes race a single mkdir, released together by a barrier file.
 *
 * Each process reports READY before the parent releases the barrier, so every
 * contender is known to have started before the race begins.
 */
async function raceOnce(lockPath: string, barrier: string, n: number): Promise<number> {
  const child = `
    const fs = require('node:fs');
    const lockPath = process.argv[1];
    const barrierPath = process.argv[2];
    process.stdout.write('READY\\n');
    while (!fs.existsSync(barrierPath)) {}
    try {
      fs.mkdirSync(lockPath);
      process.stdout.write('WIN\\n');
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'EISDIR') process.stdout.write('LOSE\\n');
      else {
        process.stderr.write(String(error.stack || error));
        process.exitCode = 1;
      }
    }
  `;
  const children = Array.from({ length: n }, () => {
    const p = spawn(process.execPath, ['-e', child, lockPath, barrier], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let stderr = '';
    let ready = false;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let resultResolve!: (result: { code: number | null; signal: NodeJS.Signals | null; error?: string }) => void;
    const readyPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const resultPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: string }>((resolve) => { resultResolve = resolve; });
    p.on('error', (error) => {
      const detail = `could not start race worker: ${error.message}`;
      readyReject(new Error(detail));
      resultResolve({ code: null, signal: null, error: detail });
    });
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.stdout.on('data', () => {
      if (!ready && /^READY$/m.test(out)) {
        ready = true;
        readyResolve();
      }
    });
    p.on('close', (code, signal) => {
      if (!ready) {
        const reason = timedOut
          ? `race workers timed out after ${RACE_TIMEOUT_MS / 1000}s`
          : `race worker exited before READY (code ${code}, signal ${signal ?? 'none'})${stderr ? `: ${stderr.trim()}` : ''}`;
        readyReject(new Error(reason));
      }
      resultResolve({ code, signal, ...(stderr ? { error: stderr.trim() } : {}) });
    });
    return { p, readyPromise, resultPromise, output: () => out };
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    for (const child of children) child.p.kill('SIGKILL');
  }, RACE_TIMEOUT_MS);
  try {
    await Promise.all(children.map(child => child.readyPromise));
    writeFileSync(barrier, 'release\\n', 'utf8');
    const results = await Promise.all(children.map(child => child.resultPromise));
    if (timedOut) throw new Error(`race workers timed out after ${RACE_TIMEOUT_MS / 1000}s`);
    const errors: string[] = [];
    let winners = 0;
    let losers = 0;
    results.forEach((result, index) => {
      const output = children[index].output();
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
    for (const child of children) child.p.kill('SIGKILL');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verify(workDir: string, trials = 50, concurrency = 8): Promise<VerifyResult> {
  validateOptions(trials, concurrency);
  const coord = join(workDir, 'coordination');
  const notes: string[] = [];

  const required = ['locks', 'claims', 'handoff', 'active', 'archive', 'incidents'];
  const missing = required.filter(d => !existsSync(join(coord, d)));
  const structureOk = existsSync(coord) && missing.length === 0;
  if (!structureOk) {
    notes.push(existsSync(coord)
      ? `missing subdirectories: ${missing.join(', ')}`
      : `no coordination/ in ${workDir} — run setup first`);
  }

  let configOk = false;
  for (const p of [join(workDir, '.kiro', 'coordination.json'), join(coord, 'config.json')]) {
    try {
      const c = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(c?.scopes?.registry) && c.scopes.registry.length) { configOk = true; break; }
      notes.push(`${p} parsed but has no scopes.registry`);
    } catch { /* try next */ }
  }
  if (!configOk) notes.push('no readable coordination config with a scope registry');

  // Race in the tree being verified — the filesystem under coordination/ is the one
  // that has to behave. Fall back to tmp only when the tree is not set up yet.
  const arenaBase = structureOk ? coord : tmpdir();
  const arena = join(arenaBase, '.verify-atomicity');
  rmSync(arena, { recursive: true, force: true });
  mkdirSync(arena, { recursive: true });

  let badTrials = 0, totalWinners = 0;
  const probeErrors: string[] = [];
  for (let t = 0; t < trials; t++) {
    const lock = join(arena, `t${t}.lock`);
    const barrier = join(arena, `go${t}`);
    try {
      const winners = await raceOnce(lock, barrier, concurrency);
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
  const filesystem = filesystemInfo.name;
  if (filesystemInfo.warning) notes.push(filesystemInfo.warning);
  rmSync(arena, { recursive: true, force: true });

  const atomicityOk = probeErrors.length ? null : badTrials === 0 && totalWinners === trials;
  if (atomicityOk === false) {
    notes.push('mkdir is NOT atomic here — do not install the protocol in this tree');
  }
  return { structureOk, configOk, atomicityOk, filesystem, trials, concurrency, badTrials, totalWinners, probeErrors, notes };
}
