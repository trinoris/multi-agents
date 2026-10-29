import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseHandoff } from '@trinoris/agent-core';
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
  it('rejects dangling instruction links and hard-linked files without touching their targets', () => {
    const base = fixture(); const workDir = join(base, 'work'); mkdirSync(workDir);
    const missingTarget = join(base, 'missing-target'); symlinkSync(missingTarget, join(workDir, 'AGENTS.md'));
    expect(() => setup({ workDir })).toThrow(); expect(existsSync(missingTarget)).toBe(false);

    const linkedWorkDir = join(base, 'linked-work'); mkdirSync(linkedWorkDir);
    const source = join(base, 'shared-instructions'); writeFileSync(source, 'preserve');
    linkSync(source, join(linkedWorkDir, 'AGENTS.md'));
    expect(() => setup({ workDir: linkedWorkDir, force: true })).toThrow();
    expect(readFileSync(source, 'utf8')).toBe('preserve');
    expect(readdirSync(linkedWorkDir)).toEqual(['AGENTS.md']);
  });
  it('ships a complete versioned contract and disables unsupported heartbeats', () => {
    const workDir = fixture(); setup({ workDir });
    expect(readFileSync(join(workDir, '.trinoris/PROTOCOL.md'), 'utf8')).not.toContain('placeholder');
    expect(readFileSync(join(workDir, '.trinoris/config.json'), 'utf8')).toContain('protocol_version');
    expect(readdirSync(workDir)).not.toContain('coordination');
    expect(readFileSync(join(workDir, '.gitignore'), 'utf8')).toContain('/.trinoris/');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('.trinoris/PROTOCOL.md');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('.trinoris/handoff/for-<class>/');
    const agentInstructions = readFileSync(join(workDir, 'AGENTS.md'), 'utf8');
    expect(agentInstructions).toContain('Kiro and Cursor support it as workspace instructions');
    expect(agentInstructions).toContain('Codex, Kiro, and Cursor read AGENTS.md');
    expect(agentInstructions).toContain('At each new agent session cold start, run `trinoris-agent doctor --runtime` once when the installed CLI is available.');
    expect(existsSync(join(workDir, '.cursor'))).toBe(false);
    expect(existsSync(join(workDir, '.kiro'))).toBe(false);
    const claudeInstructions = readFileSync(join(workDir, 'CLAUDE.md'), 'utf8');
    expect(claudeInstructions).toContain('.claude/skills/agent-handoff/SKILL.md');
    expect(claudeInstructions).toContain('.trinoris/PROTOCOL.md');
    expect(readFileSync(join(workDir, '.claude/skills/agent-handoff/SKILL.md'), 'utf8')).toContain('.trinoris/PROTOCOL.md');
    expect(readFileSync(join(workDir, '.claude/skills/agent-handoff/SKILL.md'), 'utf8')).toContain('.trinoris/active/<instance>/');
    expect(readFileSync(join(workDir, '.claude/skills/agent-handoff/SKILL.md'), 'utf8')).toContain('.trinoris/handoff/TEMPLATE.md');
    expect(readFileSync(join(workDir, '.claude/skills/agent-handoff/SKILL.md'), 'utf8')).toContain('At each new agent session cold start, run `trinoris-agent doctor --runtime` once when the installed CLI is available.');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('locks_released: true');
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toContain('.trinoris/handoff/TEMPLATE.md');
    const config = JSON.parse(readFileSync(join(workDir, '.trinoris/config.json'), 'utf8'));
    expect(config.protocol_version).toBe('3'); expect(config.heartbeat.enabled).toBe(false);
    expect(config.agent_classes).toContain('cursor');
    expect(readFileSync(join(workDir, '.gitignore'), 'utf8')).toContain('/.trinoris/');
    expect(existsSync(join(workDir, '.kiro'))).toBe(false);
    expect(existsSync(join(workDir, '.trinoris/handoff/drafts'))).toBe(true);
    expect(existsSync(join(workDir, '.trinoris/handoff/for-cursor'))).toBe(true);
    const template = readFileSync(join(workDir, '.trinoris/handoff/TEMPLATE.md'), 'utf8');
    expect(template).toContain('from_class: codex');
    expect(template).toContain('## Blockers and Unknowns');
    expect(template).toContain('## Resume Instructions');
    const filled = template
      .replace('YYYY-MM-DD HH:MM', '2026-10-26 12:00')
      .replace('Task: Replace with a short task name', 'Task: Example handoff')
      .replace('Branch: replace-with-branch', 'Branch: main')
      .replace('Base commit: replace-with-commit-sha', 'Base commit: abc1234');
    expect(parseHandoff(filled)).not.toBeNull();
    expect(existsSync(join(workDir, '.trinoris/published'))).toBe(true);
  });
  it('refreshes an intact generated protocol and digest without replacing local config', () => {
    const workDir = fixture(); setup({ workDir });
    const protocolPath = join(workDir, '.trinoris/PROTOCOL.md');
    const metadataPath = join(workDir, '.trinoris/protocol.json');
    const configPath = join(workDir, '.trinoris/config.json');
    const oldProtocol = '# Previous generated contract';
    writeFileSync(protocolPath, oldProtocol);
    writeFileSync(metadataPath, JSON.stringify({ version: '3', sha256: createHash('sha256').update(oldProtocol).digest('hex') }));
    const localConfig = JSON.parse(readFileSync(configPath, 'utf8')); localConfig.scopes.registry.push('custom-local');
    writeFileSync(configPath, JSON.stringify(localConfig));
    const result = setup({ workDir });
    expect(readFileSync(protocolPath, 'utf8')).toContain('trinoris-agent log');
    expect(JSON.parse(readFileSync(metadataPath, 'utf8')).sha256).toBe(createHash('sha256').update(readFileSync(protocolPath)).digest('hex'));
    expect(JSON.parse(readFileSync(configPath, 'utf8')).scopes.registry).toContain('custom-local');
    expect(result.replaced).toContain(protocolPath);
    expect(result.skipped).toContain(configPath);
  });
  it('ships all four load-bearing rules to an empty external consumer', () => {
    const workDir = fixture(); setup({ workDir });
    const contract = readFileSync(join(workDir, '.trinoris/PROTOCOL.md'), 'utf8');
    expect(contract).toContain('exit 3'); expect(contract).toContain('Grace delays takeover');
    expect(contract).toContain('mv -n'); expect(contract).toContain('locks/<scope>.breaking');
    expect(contract).toContain('21/100'); expect(contract).toContain('25/60');
  });
  it('preserves existing Claude instructions and adds one managed handoff pointer', () => {
    const workDir = fixture(); const original = '# Project instructions\n\nKeep the existing review workflow.\nThe text <!-- TRINORIS AGENT HANDOFF START --> is documentation, not a managed block.\n';
    writeFileSync(join(workDir, 'CLAUDE.md'), original);
    const originalAgents = '# Existing agent rules\n\nKeep the required review step.\n';
    writeFileSync(join(workDir, 'AGENTS.md'), originalAgents);
    setup({ workDir }); setup({ workDir });
    const claude = readFileSync(join(workDir, 'CLAUDE.md'), 'utf8');
    expect(claude.startsWith(original)).toBe(true);
    expect(claude).toContain('.claude/skills/agent-handoff/SKILL.md');
    expect(claude).toContain('.trinoris/PROTOCOL.md');
    expect(claude.match(/^<!-- TRINORIS AGENT HANDOFF START -->$/gm)).toHaveLength(1);
    expect(claude.match(/^<!-- TRINORIS AGENT HANDOFF END -->$/gm)).toHaveLength(1);
    const agents = readFileSync(join(workDir, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith(originalAgents)).toBe(true);
    expect(agents).toContain('.trinoris/handoff/TEMPLATE.md');
    expect(agents.match(/TRINORIS AGENT INSTRUCTIONS START/g)).toHaveLength(1);
    expect(agents.match(/TRINORIS AGENT INSTRUCTIONS END/g)).toHaveLength(1);
  });
  it('refuses an incomplete managed instruction block before setup writes state', () => {
    const workDir = fixture();
    writeFileSync(join(workDir, 'CLAUDE.md'), '# Existing notes\n<!-- TRINORIS AGENT HANDOFF START -->\n');
    expect(() => setup({ workDir })).toThrow(/malformed managed Trinoris block/i);
    expect(readdirSync(workDir)).toEqual(['CLAUDE.md']);
  });
  it('adds the ignore rule without replacing user rules and remains idempotent', () => {
    const workDir = fixture(); writeFileSync(join(workDir, '.gitignore'), 'build/\n');
    setup({ workDir }); setup({ workDir });
    const ignore = readFileSync(join(workDir, '.gitignore'), 'utf8');
    expect(ignore.startsWith('build/\n')).toBe(true);
    expect(ignore.split('\n').filter(line => line === '/.trinoris/')).toHaveLength(1);
  });
  it('preserves archived handoff history when force-refreshing generated files', () => {
    const workDir = fixture(); setup({ workDir });
    const indexPath = join(workDir, '.trinoris/archive/INDEX.md');
    const archivedHistory = '# Handoff archive\n\nExisting audit history must remain.\n';
    writeFileSync(indexPath, archivedHistory);

    setup({ workDir, force: true, leaseMinutes: 30 });

    expect(readFileSync(indexPath, 'utf8')).toBe(archivedHistory);
  });
});
