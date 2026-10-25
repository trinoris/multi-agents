import { describe, expect, it } from 'vitest';
import { calculateExpiration, isLockExpired, parseFrontmatter, generateInstanceId } from './utils.js';
import { defaultConfig, terminalText, validateConfig, validateLock } from './validation.js';

const note = (extra = '') => `---\nfrom_class: codex\nfrom_instance: sender\nto_class: claude\nto_instance: any\nscopes: api,tests\nstatus: ready\ncreated: 2026-10-25T10:00:00.000Z\n${extra}---\n`;

describe('SG-04 bounded dates and routing metadata', () => {
  it.each([NaN, Infinity, -1, 0, 1441])('rejects invalid lease duration %s', value => {
    expect(() => calculateExpiration(value)).toThrow();
  });
  it('rejects invalid expiry instead of classifying it live', () => {
    expect(() => isLockExpired({ expires_at: 'not-a-date' } as any)).toThrow();
  });
  it('rejects a forged holder duration above the configured maximum', () => {
    expect(() => validateLock({ agent_class: 'codex', agent_instance: 'actor', scope: 'api', acquired_at: '2026-10-25T00:00:00.000Z', expires_at: '2026-10-28T00:00:00.000Z' }, 'api')).toThrow();
  });
  it.each(['to_class: attacker\n', '__proto__: attacker\n', 'status: impossible\n', 'unknown: value\n'])('rejects ambiguous metadata %s', extra => {
    expect(parseFrontmatter(note(extra))).toBeNull();
  });
  it('rejects missing required recipient fields and oversized input', () => {
    expect(parseFrontmatter('---\nstatus: ready\n---')).toBeNull();
    expect(parseFrontmatter(note() + 'x'.repeat(262145))).toBeNull();
  });
  it('supports a strong injected generator without a Node dependency', () => {
    const generate = generateInstanceId as (...args: any[]) => string;
    expect(generate('codex', undefined, () => '01234567-89ab-4cde-8fab-0123456789ab')).toContain('01234567-89ab');
  });
  it('SG-07 encodes terminal controls and rejects unbounded configuration policies', () => {
    const text = terminalText('actor\u001b[2J\nforged status');
    expect(text).not.toMatch(/[\x00-\x1f]/); expect(text).toContain('\\u001b'); expect(text).toContain('\\u000a');
    const config = defaultConfig(); config.scopes.grace_period_minutes = Infinity;
    expect(() => validateConfig(config)).toThrow();
    config.scopes.grace_period_minutes = 5; config.scopes.registry = ['api', 'api'];
    expect(() => validateConfig(config)).toThrow();
  });
});
