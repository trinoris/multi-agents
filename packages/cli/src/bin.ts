#!/usr/bin/env node
/**
 * © 2026 TRINORIS. All rights reserved.
 * Proprietary and confidential.
 *
 * trinoris-agent — coordination CLI.
 *
 * Exit codes are the contract for agents driving this from a shell:
 *   0  success
 *   1  usage or runtime error
 *   3  contended: the scope is held, or the note is already claimed. NOT an error —
 *      the caller should pick other work. Spec 01 forbids spinning on it.
 *   4  not the holder: the lease was lost. Stop writing immediately.
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquire, release, renew, inspect, isHolder, breakLock, claim, type LockPaths } from './lock.js';
import { generateInstanceId, formatDuration, timeUntilExpiry } from '@trinoris/agent-core';

const DEFAULTS = { lease: 15, grace: 5 };

function loadConfig(root: string) {
  for (const p of [join(root, '.kiro', 'coordination.json'), join(root, 'coordination', 'config.json')]) {
    try {
      const c = JSON.parse(readFileSync(p, 'utf8'));
      return {
        lease: c?.scopes?.lease_duration_minutes ?? DEFAULTS.lease,
        grace: c?.scopes?.grace_period_minutes ?? DEFAULTS.grace,
        registry: c?.scopes?.registry as string[] | undefined,
      };
    } catch { /* try next */ }
  }
  return { ...DEFAULTS, registry: undefined };
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

const USAGE = `trinoris-agent — multi-agent coordination

  status  [--scope S]                     show lock state (all scopes, or one)
  acquire  --scope S [--task T]           take a scope lock
  renew    --scope S                      push out the lease
  release  --scope S                      give the lock back
  check    --scope S                      am I still the holder? (exit 4 if not)
  break    --scope S --reason R           take over a stale lock (token-guarded)
  claim    --note F --from D --to D       atomically claim a handoff note

Common: --work-dir DIR  --agent-class CLASS  --instance ID
Exit: 0 ok · 1 error · 3 contended · 4 not holder`;

const cmd = process.argv[2];
const workDir = resolve(arg('work-dir', process.cwd())!);
const paths: LockPaths = { root: join(workDir, 'coordination') };
const cfg = loadConfig(workDir);
const agentClass = arg('agent-class', 'claude')!;
const instance = arg('instance') ?? generateInstanceId(agentClass);
const identity = { agent_instance: instance, agent_class: agentClass };

if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0); }
if (!existsSync(paths.root)) die(`No coordination/ in ${workDir}. Run setup first.`);

const scope = () => arg('scope') ?? die('--scope is required');

switch (cmd) {
  case 'status': {
    const one = arg('scope');
    const dir = join(paths.root, 'locks');
    mkdirSync(dir, { recursive: true });
    const scopes = one
      ? [one]
      : [...new Set(readdirSync(dir).filter(d => d.endsWith('.lock')).map(d => d.replace(/\.lock$/, '')))];
    if (!scopes.length) { console.log('no locks held'); break; }
    for (const s of scopes) {
      const st = inspect(paths, s, cfg.grace);
      if (st.state === 'free') { console.log(`${s}: free`); }
      else if (st.state === 'held') {
        console.log(`${s}: HELD by ${st.lock.agent_instance} (${st.lock.agent_class}) — expires in ${formatDuration(timeUntilExpiry(st.lock))}${st.lock.task ? ` — ${st.lock.task}` : ''}`);
      } else if (st.state === 'expired') {
        console.log(`${s}: EXPIRED (held by ${st.lock.agent_instance})${st.breakable ? ' — breakable' : ' — within grace, do not break'}`);
      } else {
        console.log(`${s}: MALFORMED (no readable holder.json, dir mtime ${st.dirMtime.toISOString()})${st.breakable ? ' — breakable' : ' — within grace, do not break'}`);
      }
    }
    break;
  }
  case 'acquire': {
    const s = scope();
    if (cfg.registry && !cfg.registry.includes(s)) die(`Unknown scope "${s}". Registry: ${cfg.registry.join(', ')}`);
    const r = acquire(paths, s, identity, cfg.lease, arg('task'));
    if (!r.ok) {
      const st = inspect(paths, s, cfg.grace);
      const who = st.state === 'held' || st.state === 'expired' ? st.lock.agent_instance : 'unknown';
      console.error(`contended: ${s} is held by ${who}. Do not wait — pick other work or write a handoff.`);
      process.exit(3);
    }
    console.log(`${instance} acquired ${s} until ${r.lock.expires_at}`);
    break;
  }
  case 'renew': {
    const r = renew(paths, scope(), instance, cfg.lease);
    if (!r.ok) die(`not the holder of ${scope()} — stop writing and re-acquire`, 4);
    console.log(`renewed ${scope()} until ${r.lock.expires_at}`);
    break;
  }
  case 'release': {
    const r = release(paths, scope(), instance);
    if (!r.ok) die(r.reason === 'free' ? `${scope()} was not held` : `not the holder of ${scope()}`, r.reason === 'free' ? 1 : 4);
    console.log(`released ${scope()}`);
    break;
  }
  case 'check': {
    if (!isHolder(paths, scope(), instance)) die(`NOT holder of ${scope()} — lease lost, stop writing`, 4);
    console.log(`still holder of ${scope()}`);
    break;
  }
  case 'break': {
    const s = scope();
    const reason = arg('reason') ?? die('--reason is required: breaking a lock must be explained');
    const r = breakLock(paths, s, identity, cfg.lease, cfg.grace, reason);
    if (!r.ok) {
      if (r.reason === 'token-held') { console.error(`another agent is already breaking ${s} — stand down`); process.exit(3); }
      if (r.reason === 'not-stale') { console.error(`${s} is not stale (holder may have renewed) — do not break`); process.exit(3); }
      die(`lost the race while breaking ${s} — re-read state before acting`, 4);
    }
    console.log(`broke ${s} (evicted ${r.evicted?.agent_instance ?? 'malformed lock'}) — incident: ${r.incident}`);
    console.log('The evicted agent may have left the tree mid-edit: check git status and run tests.');
    break;
  }
  case 'claim': {
    const note = arg('note') ?? die('--note is required');
    const r = claim(paths, note, arg('from', 'handoff/for-' + agentClass)!, arg('to', 'active')!);
    if (!r.ok) {
      if (r.reason === 'claimed-by-other') { console.error(`${note} is being claimed by another agent`); process.exit(3); }
      die(`${note} not found`);
    }
    console.log(`claimed ${note} -> ${r.path}`);
    break;
  }
  default:
    die(`Unknown command "${cmd}"\n\n${USAGE}`);
}
