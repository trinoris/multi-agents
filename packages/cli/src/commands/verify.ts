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

import { mkdirSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export interface VerifyResult {
  structureOk: boolean;
  configOk: boolean;
  atomicityOk: boolean;
  filesystem: string;
  trials: number;
  concurrency: number;
  badTrials: number;
  totalWinners: number;
  notes: string[];
}

function filesystemOf(path: string): string {
  try {
    return execFileSync('stat', ['-f', '-c', '%T', path], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * One trial: N real processes race a single mkdir, released together by a barrier file.
 *
 * The barrier matters less than it looks — a pool without one also detects a
 * non-exclusive primitive — but it costs nothing and makes the starts genuinely
 * simultaneous rather than merely parallel.
 */
async function raceOnce(lockPath: string, barrier: string, n: number): Promise<number> {
  const child = `
    const fs = require('node:fs');
    while (!fs.existsSync(process.argv[2])) {}
    try { fs.mkdirSync(process.argv[1]); process.stdout.write('W'); } catch {}
  `;
  // spawn (not execFileSync) so all N are genuinely in flight at once. Running them
  // with execFileSync would serialise the racers and the test would pass vacuously.
  const running = Array.from({ length: n }, () => {
    const p = spawn(process.execPath, ['-e', child, lockPath, barrier], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    return new Promise<string>((res) => p.on('close', () => res(out)));
  });
  const outs = await Promise.all(running);
  return outs.join('').split('W').length - 1;
}

export async function verify(workDir: string, trials = 50, concurrency = 8): Promise<VerifyResult> {
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
  for (let t = 0; t < trials; t++) {
    const lock = join(arena, `t${t}.lock`);
    const barrier = join(arena, `go${t}`);
    mkdirSync(barrier);                       // created before racers spin on it
    const winners = await raceOnce(lock, barrier, concurrency);
    totalWinners += winners;
    if (winners !== 1) {
      badTrials++;
      notes.push(`trial ${t}: ${winners} winners (expected exactly 1)`);
    }
  }
  const filesystem = filesystemOf(arena);
  rmSync(arena, { recursive: true, force: true });

  const atomicityOk = badTrials === 0 && totalWinners === trials;
  if (!atomicityOk) {
    notes.push('mkdir is NOT atomic here — do not install the protocol in this tree');
  }
  return { structureOk, configOk, atomicityOk, filesystem, trials, concurrency, badTrials, totalWinners, notes };
}
