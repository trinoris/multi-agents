#!/usr/bin/env node
/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquire, acquireMany, release, renew, inspect, isHolder, breakLock, claim, diagnose, recoverMarker, loadConfiguration, safePath } from '@trinoris/agent-sdk';
import { generateInstanceId, terminalText, identifier } from '@trinoris/agent-core';
import { setup } from './commands/setup.js';
import { verify } from './commands/verify.js';

const common = ['work-dir', 'agent-class', 'instance', 'json'];
const identityCommands = new Set(['acquire', 'acquire-many', 'check', 'renew', 'release', 'break', 'claim', 'recover']);
const allowed: Record<string, string[]> = {
  setup: ['force', 'agent-classes', 'scopes', 'lease-minutes', 'grace-minutes'], verify: ['trials', 'concurrency'], status: ['scope'],
  acquire: ['scope', 'task'], 'acquire-many': ['scopes'], check: ['scope', 'generation'],
  renew: ['scope', 'generation'], release: ['scope', 'generation'], break: ['scope', 'reason'],
  claim: ['note', 'from', 'to'], diagnose: [], recover: ['marker', 'operation', 'reason', 'confirm-stopped'],
};
const booleans = new Set(['json', 'force', 'confirm-stopped']);
const usage = `trinoris-agent — cooperative local coordination, protocol 3

setup [--force] [--lease-minutes N --grace-minutes N]
                                    Install the protocol and set bounded lease policy
verify [--trials N --concurrency N]   Check protocol readiness and actual mkdir behavior
status [--scope S]                   Inspect recorded leases
acquire --scope S [--task T]         Acquire; retain the returned generation
acquire-many --scopes api,tests      All-or-none registry-ordered acquisition
check --scope S --generation G       Check the active instance and lease generation
renew --scope S --generation G       Renew a still-live generation
release --scope S --generation G     Remove only the matching generation
break --scope S --reason R           Take over a stale lease; retain its new generation
claim --note F                      Validate routing; move to active/<instance>/
diagnose                            Read abandoned operation metadata
recover --marker M --operation ID --reason R --confirm-stopped
                                    Offline operator recovery, never automatic

Common: --work-dir DIR --agent-class CLASS --instance ID --json
Stateful commands require explicit --agent-class and stable --instance values.
Reuse the same instance and retain the generation for each lease lifecycle.
Exit: 0 success, 1 invalid/uncertain, 3 contention (do not spin), 4 lease lost.
Locks are advisory; they do not authenticate agents or fence an uncoordinated writer.`;

function parse(command: string, args: string[]) {
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown command; use --help');
  const opts: Record<string, string | true> = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    if (![...common, ...allowed[command]].includes(key) || Object.hasOwn(opts, key)) throw new Error('Unknown or duplicate option');
    if (booleans.has(key)) { opts[key] = true; continue; }
    const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    opts[key] = value;
  }
  return opts;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') { console.log(usage); return; }
  const opts = parse(command, args);
  if (identityCommands.has(command) && (typeof opts['agent-class'] !== 'string' || typeof opts.instance !== 'string')) {
    throw new Error('Stateful commands require --agent-class and --instance; reuse the same values across related commands');
  }
  const required = (key: string): string => { const value = opts[key]; if (typeof value !== 'string') throw new Error(`--${key} is required`); return value; };
  const value = (key: string, fallback: string) => typeof opts[key] === 'string' ? opts[key] as string : fallback;
  const output = (data: unknown, readable?: string) => console.log(opts.json ? JSON.stringify(data) : terminalText(readable ?? JSON.stringify(data)));
  const workDir = resolve(value('work-dir', process.cwd())); const paths = { root: join(workDir, '.trinoris') };
  const agentClass = value('agent-class', 'claude-opus-5');
  const instance = opts.instance ? required('instance') : generateInstanceId(agentClass, undefined, randomUUID);
  identifier(instance, 'instance'); const owner = { agent_class: agentClass, agent_instance: instance };
  if (command === 'setup') {
    const result = setup({
      workDir,
      force: opts.force === true,
      ...(opts.scopes ? { scopes: required('scopes').split(',') } : {}),
      ...(opts['agent-classes'] ? { agentClasses: required('agent-classes').split(',') } : {}),
      ...(opts['lease-minutes'] ? { leaseMinutes: Number(required('lease-minutes')) } : {}),
      ...(opts['grace-minutes'] ? { graceMinutes: Number(required('grace-minutes')) } : {}),
    });
    output(result); return;
  }
  if (command === 'verify') {
    const controller = new AbortController(); const abort = () => controller.abort();
    process.once('SIGINT', abort); process.once('SIGTERM', abort);
    try {
      const result = await verify(workDir, Number(value('trials', '50')), Number(value('concurrency', '8')), { signal: controller.signal });
      output(result); if (!result.ready) process.exitCode = 1;
    } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
    return;
  }
  if (command === 'diagnose') { output(diagnose(paths)); return; }
  if (command === 'recover') {
    const id = required('operation');
    const result = recoverMarker(paths, required('marker'), id === 'unknown' ? null : id, owner, required('reason'), opts['confirm-stopped'] === true);
    output(result); if (!result.ok) process.exitCode = result.reason === 'busy' ? 3 : 1; return;
  }
  const config = loadConfiguration(paths, true);
  const minutes = config.scopes.lease_duration_minutes; const grace = config.scopes.grace_period_minutes;
  if (command === 'status') {
    const dir = join(paths.root, 'locks'); if (!safePath(paths.root, dir)?.isDirectory()) throw new Error('Missing locks directory');
    const scopes = opts.scope ? [required('scope')] : fs.readdirSync(dir).filter(n => n.endsWith('.lock')).map(n => n.slice(0, -5));
    output(scopes.map(scope => ({ scope, ...inspect(paths, scope, grace) }))); return;
  }
  if (command === 'check') {
    const active = isHolder(paths, required('scope'), instance, required('generation'));
    output({ ok: active }, active ? 'Active lease confirmed' : 'Lease lost or uncertain; stop writing');
    if (!active) process.exitCode = 4; return;
  }
  let result;
  switch (command) {
    case 'acquire': result = acquire(paths, required('scope'), owner, minutes, opts.task ? required('task') : undefined); break;
    case 'acquire-many': result = acquireMany(paths, required('scopes').split(','), owner, minutes); break;
    case 'renew': result = renew(paths, required('scope'), instance, minutes, required('generation')); break;
    case 'release': result = release(paths, required('scope'), instance, required('generation')); break;
    case 'break': result = breakLock(paths, required('scope'), owner, minutes, grace, required('reason')); break;
    case 'claim': result = claim(paths, required('note'), value('from', `handoff/for-${agentClass}`), value('to', `active/${instance}`), owner); break;
    default: throw new Error('Unsupported command');
  }
  output(result);
  if (!result.ok) process.exitCode = result.reason === 'not-holder' ? 4 : ['busy', 'held', 'token-held', 'scope-held', 'claimed-by-other'].includes(result.reason) ? 3 : 1;
}
void main().catch(error => { console.error(terminalText(error instanceof Error ? error.message : error)); process.exitCode = 1; });
