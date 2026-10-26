import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './setup.js';

const roots: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), 'agent-setup-security-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('SG-01 safe setup', () => {
  it('rejects path-shaped classes before creating any generated file', () => {
    const root = fixture(); expect(() => setup({ workDir: root, agentClasses: ['../../escape'] })).toThrow();
    expect(readdirSync(root)).toEqual([]);
  });
  it('refuses to create a parallel state root beside a legacy coordination directory', () => {
    const workDir = fixture(); mkdirSync(join(workDir, 'coordination'));
    expect(() => setup({ workDir })).toThrow(/top-level coordination directory exists/i);
    expect(readdirSync(workDir)).toEqual(['coordination']);
  });
  it.each([false, true])('rejects a symlinked instruction target with force=%s', force => {
    const base = fixture(); const workDir = join(base, 'work'); mkdirSync(workDir);
    const victim = join(base, 'victim'); writeFileSync(victim, 'keep'); symlinkSync(victim, join(workDir, 'AGENTS.md'));
    expect(() => setup({ workDir, force })).toThrow(); expect(readFileSync(victim, 'utf8')).toBe('keep');
  });
  it('ships a complete versioned contract and disables unsupported heartbeats', () => {
    const workDir = fixture(); setup({ workDir });
    expect(readFileSync(join(workDir, '.trinoris/PROTOCOL.md'), 'utf8')).not.toContain('placeholder');
    expect(readFileSync(join(workDir, '.trinoris/config.json'), 'utf8')).toContain('protocol_version');
    expect(readdirSync(workDir)).not.toContain('coordination');
    expect(readFileSync(join(workDir, '.gitignore'), 'utf8')).toContain('/.trinoris/');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('.trinoris/PROTOCOL.md');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('.trinoris/handoff/for-<class>/');
    expect(readFileSync(join(workDir, '.claude/skills/agent-handoff/SKILL.md'), 'utf8')).toContain('.trinoris/PROTOCOL.md');
    expect(readFileSync(join(workDir, '.claude/skills/agent-handoff/SKILL.md'), 'utf8')).toContain('.trinoris/active/<instance>/');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('locks_released: true');
    const config = JSON.parse(readFileSync(join(workDir, '.trinoris/config.json'), 'utf8'));
    expect(config.protocol_version).toBe('3'); expect(config.heartbeat.enabled).toBe(false);
    expect(readFileSync(join(workDir, '.gitignore'), 'utf8')).toContain('/.trinoris/');
    expect(existsSync(join(workDir, '.kiro'))).toBe(false);
  });
  it('ships all four load-bearing rules to an empty external consumer', () => {
    const workDir = fixture(); setup({ workDir });
    const contract = readFileSync(join(workDir, '.trinoris/PROTOCOL.md'), 'utf8');
    expect(contract).toContain('exit 3'); expect(contract).toContain('Grace delays takeover');
    expect(contract).toContain('mv -n'); expect(contract).toContain('locks/<scope>.breaking');
    expect(contract).toContain('21/100'); expect(contract).toContain('25/60');
  });
  it('adds the ignore rule without replacing user rules and remains idempotent', () => {
    const workDir = fixture(); writeFileSync(join(workDir, '.gitignore'), 'build/\n');
    setup({ workDir }); setup({ workDir });
    const ignore = readFileSync(join(workDir, '.gitignore'), 'utf8');
    expect(ignore.startsWith('build/\n')).toBe(true);
    expect(ignore.split('\n').filter(line => line === '/.trinoris/')).toHaveLength(1);
  });
});
