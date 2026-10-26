#!/usr/bin/env node
/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquire, acquireMany, release, renew, inspect, isHolder, breakLock, claim, diagnose, recoverMarker, loadConfiguration, safePath, validateHandoffDraft, publishHandoff, listHandoffs, readHandoff, completeHandoff, listIncidents } from '@trinoris/agent-sdk';
import { generateInstanceId, terminalText, identifier } from '@trinoris/agent-core';
import { setup } from './commands/setup.js';
import { verify } from './commands/verify.js';

const common = ['work-dir', 'agent-class', 'instance', 'json'];
const identityCommands = new Set(['acquire', 'acquire-many', 'check', 'renew', 'release', 'break', 'claim', 'recover', 'handoff-publish', 'handoff-complete']);
const allowed: Record<string, string[]> = {
  setup: ['force', 'agent-classes', 'scopes', 'lease-minutes', 'grace-minutes'], verify: ['trials', 'concurrency'], status: ['scope'],
  acquire: ['scope', 'task'], 'acquire-many': ['scopes'], check: ['scope', 'generation'],
  renew: ['scope', 'generation'], release: ['scope', 'generation'], break: ['scope', 'reason'],
  claim: ['note', 'from', 'to'], diagnose: [], recover: ['marker', 'operation', 'reason', 'confirm-stopped'],
  'handoff-validate': ['note'], 'handoff-publish': ['note'], 'handoff-list': [],
  'handoff-show': ['note', 'location'], 'handoff-complete': ['note', 'outcome'],
  'incidents-list': ['scope'],
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
handoff validate --note F           Validate a draft under .trinoris/handoff/drafts/
handoff publish --note F            Publish a validated draft to its declared inbox
handoff list                        List this class's inbox and this instance's active notes
handoff show --note F [--location L] Read an authorized inbox or active note
handoff claim --note F              Claim a note from the class inbox
handoff complete --note F --outcome T Archive an active note and record its outcome
incidents list [--scope S]          Read bounded takeover and recovery events
diagnose                            Read abandoned operation metadata
recover --marker M --operation ID --reason R --confirm-stopped
                                    Offline operator recovery, never automatic

Common: --work-dir DIR --agent-class CLASS --instance ID --json
Stateful commands require explicit --agent-class and stable --instance values.
Reuse the same instance and retain the generation for each lease lifecycle.
Exit: 0 success, 1 invalid/uncertain, 3 contention (do not spin), 4 lease lost.
Locks are advisory; they do not authenticate agents or fence an uncoordinated writer.`;
const commandDescriptions: Record<string, string> = {
  setup: 'Install the package-owned protocol files and bounded lease policy.',
  verify: 'Check protocol readiness and filesystem coordination behavior.',
  status: 'Inspect registered lease directories without changing state.',
  acquire: 'Acquire one registered scope lease.', 'acquire-many': 'Acquire several scopes in registry order or roll back.',
  check: 'Confirm the exact lease generation remains active.', renew: 'Renew the exact live lease generation.',
  release: 'Release only the exact lease generation.', break: 'Take over a lease after expiry and grace.',
  claim: 'Claim a routed handoff into this instance active directory.', diagnose: 'Inspect abandoned mutation markers.',
  recover: 'Recover one exact marker after confirming all actors stopped.',
  'handoff-validate': 'Validate a draft without changing it.', 'handoff-publish': 'Publish a validated draft to its declared inbox.',
  'handoff-list': 'List this class inbox, universal inbox, and this instance active notes.',
  'handoff-show': 'Read a note from an authorized managed location.', 'handoff-complete': 'Archive this instance active handoff with its outcome.',
  'incidents-list': 'Read bounded takeover and recovery event summaries.',
};
const commandNames: Record<string, string> = {
  'acquire-many': 'acquire-many', 'handoff-validate': 'handoff validate', 'handoff-publish': 'handoff publish',
  'handoff-list': 'handoff list', 'handoff-show': 'handoff show', 'handoff-complete': 'handoff complete',
  'incidents-list': 'incidents list',
};
const optionValues: Record<string, string> = {
  'work-dir': 'DIR', 'agent-class': 'CLASS', instance: 'ID', scope: 'SCOPE', task: 'TEXT', scopes: 'CSV',
  generation: 'ID', reason: 'TEXT', note: 'FILE', from: 'INBOX', to: 'ACTIVE_DIR', marker: 'PATH',
  operation: 'ID', trials: 'N', concurrency: 'N', location: 'LOCATION', outcome: 'TEXT',
  'agent-classes': 'CSV', 'lease-minutes': 'N', 'grace-minutes': 'N',
};
function commandHelp(command: string): string {
  const publicName = commandNames[command] ?? command;
  const options = [...common, ...allowed[command]].map(key => `  --${key}${booleans.has(key) ? '' : ` <${optionValues[key] ?? 'VALUE'}>`}`).join('\n');
  const examples: Record<string, string> = {
    setup: 'trinoris-agent setup --work-dir REPO',
    verify: 'trinoris-agent verify --work-dir REPO --json',
    status: 'trinoris-agent status --work-dir REPO --json',
    acquire: 'trinoris-agent acquire --work-dir REPO --agent-class codex --instance codex-1 --scope api --json',
    'handoff-validate': 'trinoris-agent handoff validate --work-dir REPO --note review.md',
    'handoff-publish': 'trinoris-agent handoff publish --work-dir REPO --agent-class codex --instance codex-1 --note review.md',
    'handoff-list': 'trinoris-agent handoff list --work-dir REPO --agent-class codex --instance codex-1',
    'handoff-show': 'trinoris-agent handoff show --work-dir REPO --agent-class codex --note review.md',
    'handoff-complete': 'trinoris-agent handoff complete --work-dir REPO --agent-class codex --instance codex-1 --note review.md --outcome "Review passed"',
    'incidents-list': 'trinoris-agent incidents list --work-dir REPO --scope api --json',
  };
  return `Usage: trinoris-agent ${publicName} [options]\n\n${commandDescriptions[command] ?? 'Run this protocol 3 coordination command.'}\n\nOptions:\n${options}\n  -h, --help  Show this command help\n\nExample:\n  ${examples[command] ?? `trinoris-agent ${publicName} --work-dir REPO --json`}`;
}

function cliVersion(): string {
  try {
    const entry = fs.realpathSync(process.argv[1] ?? '');
    const packagePath = join(resolve(entry, '..', '..'), 'package.json');
    const value: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return value && typeof value === 'object' && typeof (value as { version?: unknown }).version === 'string'
      ? (value as { version: string }).version : 'unknown';
  } catch { return 'unknown'; }
}

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
  const [rawCommand, ...rawArgs] = process.argv.slice(2);
  if (rawCommand === '--version' || rawCommand === '-v') { console.log(cliVersion()); return; }
  let command = rawCommand; let args = rawArgs;
  if (rawCommand === 'handoff') {
    const [subcommand, ...rest] = rawArgs;
    if (!subcommand || !['validate', 'publish', 'list', 'show', 'claim', 'complete'].includes(subcommand)) throw new Error('Unknown handoff command; use --help');
    command = subcommand === 'claim' ? 'claim' : `handoff-${subcommand}`;
    args = rest;
  }
  if (rawCommand === 'incidents') {
    const [subcommand, ...rest] = rawArgs;
    if (subcommand !== 'list') throw new Error('Unknown incidents command; use --help');
    command = 'incidents-list'; args = rest;
  }
  if (!command || command === '--help' || command === '-h') { console.log(usage); return; }
  if (args.includes('--help') || args.includes('-h')) { console.log(commandHelp(command)); return; }
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
  if (command === 'handoff-validate') {
    const result = validateHandoffDraft(paths, required('note'));
    output(result, result.ok ? `Valid handoff draft: ${result.note.title}` : `Invalid or unavailable handoff draft (${result.reason})`);
    if (!result.ok) process.exitCode = 1; return;
  }
  if (command === 'handoff-list') {
    if (typeof opts['agent-class'] !== 'string' || typeof opts.instance !== 'string') throw new Error('handoff list requires --agent-class and --instance so it can include the caller\'s active notes');
    output(listHandoffs(paths, { agent_class: agentClass, agent_instance: instance })); return;
  }
  if (command === 'handoff-show') {
    if (typeof opts['agent-class'] !== 'string') throw new Error('handoff show requires --agent-class');
    const location = value('location', 'inbox');
    if (location === 'active' && typeof opts.instance !== 'string') throw new Error('Reading an active handoff requires --instance');
    if (!['inbox', 'universal', 'active'].includes(location)) throw new Error('--location must be inbox, universal, or active');
    const result = readHandoff(paths, required('note'), { agent_class: agentClass, agent_instance: instance }, location as 'inbox' | 'universal' | 'active');
    output(result, result.ok ? result.content : `Handoff unavailable (${result.reason})`);
    if (!result.ok) process.exitCode = 1; return;
  }
  if (command === 'incidents-list') {
    const entries = listIncidents(paths, typeof opts.scope === 'string' ? opts.scope : undefined);
    const readable = entries.length ? entries.map(entry => entry.valid
      ? `${entry.timestamp} · ${entry.stage} · ${entry.scope ?? 'global'} · ${entry.action ?? 'operation'}${entry.reason ? ` · ${entry.reason}` : ''}`
      : `${entry.filename} · malformed record`).join('\n') : 'No incident records.';
    output(entries, readable); return;
  }
  const config = loadConfiguration(paths, true);
  const minutes = config.scopes.lease_duration_minutes; const grace = config.scopes.grace_period_minutes;
  if (command === 'status') {
    const dir = join(paths.root, 'locks'); if (!safePath(paths.root, dir)?.isDirectory()) throw new Error('Missing locks directory');
    const scopes = opts.scope ? [required('scope')] : fs.readdirSync(dir).filter(n => n.endsWith('.lock')).map(n => n.slice(0, -5));
    output(scopes.map(scope => config.scopes.registry.includes(scope)
      ? { scope, ...inspect(paths, scope, grace) }
      : { scope, state: 'unknown' })); return;
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
    case 'handoff-publish': result = publishHandoff(paths, required('note'), owner); break;
    case 'handoff-complete': result = completeHandoff(paths, required('note'), owner, required('outcome')); break;
    default: throw new Error('Unsupported command');
  }
  output(result);
  if (!result.ok) process.exitCode = result.reason === 'not-holder' ? 4 : ['busy', 'held', 'token-held', 'scope-held', 'claimed-by-other'].includes(result.reason) ? 3 : 1;
}
void main().catch(error => {
  const message = terminalText(error instanceof Error ? error.message : error).slice(0, 512);
  if (process.argv.includes('--json')) console.error(JSON.stringify({ error: { code: 'cli_error', message } }));
  else console.error(message);
  process.exitCode = 1;
});
