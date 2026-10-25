import { describe, expect, it } from 'vitest';
import {
  calculateExpiration,
  formatDuration,
  formatTimestamp,
  generateInstanceId,
  isInGracePeriod,
  isLockExpired,
  parseFrontmatter,
  parseHandoff,
  sortScopesByRegistry,
  timeUntilExpiry,
  validateScope,
} from './utils.js';
import type { Lock } from './types.js';

const now = new Date('2026-10-25T12:00:00.000Z');
const lock: Lock = {
  agent_instance: 'codex-a',
  agent_class: 'codex-gpt-6',
  scope: 'api',
  acquired_at: '2026-10-25T11:45:00.000Z',
  expires_at: '2026-10-25T12:15:00.000Z',
};

describe('lease and duration utilities', () => {
  it('calculates expiration from the supplied start time', () => {
    expect(calculateExpiration(15, now).toISOString()).toBe('2026-10-25T12:15:00.000Z');
  });

  it('treats the exact expiration instant as live and later instants as expired', () => {
    expect(isLockExpired(lock, new Date(lock.expires_at))).toBe(false);
    expect(isLockExpired(lock, new Date('2026-10-25T12:15:00.001Z'))).toBe(true);
  });

  it('detects only times after expiry and through the grace-period boundary', () => {
    expect(isInGracePeriod(lock, 5, new Date(lock.expires_at))).toBe(false);
    expect(isInGracePeriod(lock, 5, new Date('2026-10-25T12:19:59.999Z'))).toBe(true);
    expect(isInGracePeriod(lock, 5, new Date('2026-10-25T12:20:00.000Z'))).toBe(true);
    expect(isInGracePeriod(lock, 5, new Date('2026-10-25T12:20:00.001Z'))).toBe(false);
  });

  it('clamps remaining lease time at zero', () => {
    expect(timeUntilExpiry(lock, now)).toBe(15 * 60_000);
    expect(timeUntilExpiry(lock, new Date('2026-10-25T12:16:00.000Z'))).toBe(0);
  });

  it.each([
    [999, '999ms'],
    [1_000, '1s'],
    [61_000, '1m 1s'],
    [3_661_000, '1h 1m'],
  ])('formats %s milliseconds as %s', (ms, expected) => {
    expect(formatDuration(Number(ms))).toBe(expected);
  });

  it('formats timestamps as ISO strings and generated IDs include the agent class', () => {
    expect(formatTimestamp(now)).toBe('2026-10-25T12:00:00.000Z');
    expect(generateInstanceId('codex-gpt-6', 'session-a')).toMatch(/^codex-gpt-6-[a-f0-9-]{36}-session-a$/);
  });
});

describe('handoff and scope utilities', () => {
  const handoffText = `---
from_class: claude-opus-5
from_instance: claude-a
to_class: codex-gpt-6
to_instance: any
scopes: api,tests
status: ready
priority: high
created: 2026-10-25T11:00:00.000Z
---

# Add API validation

## Context

The request boundary needs validation.

## Task

Add the missing checks.

## What I Verified

- Existing routes use the shared middleware.
- Tests currently cover invalid IDs.

## What I Assumed

- The schema remains backward compatible.

## Instructions

Run the targeted tests.
`;

  it('parses handoff frontmatter fields and rejects content without frontmatter', () => {
    expect(parseFrontmatter(handoffText)).toMatchObject({
      from_class: 'claude-opus-5',
      to_instance: 'any',
      scopes: 'api,tests',
      status: 'ready',
      priority: 'high',
    });
    expect(parseFrontmatter('# no metadata')).toBeNull();
  });

  it('extracts handoff sections and verified/assumed bullets', () => {
    expect(parseHandoff(handoffText)).toMatchObject({
      title: 'Add API validation',
      context: 'The request boundary needs validation.',
      task: 'Add the missing checks.',
      verified: ['Existing routes use the shared middleware.', 'Tests currently cover invalid IDs.'],
      assumed: ['The schema remains backward compatible.'],
      instructions: 'Run the targeted tests.',
    });
    expect(parseHandoff('No frontmatter')).toBeNull();
  });

  it('validates exact scope names and sorts scopes by registry order without mutating input', () => {
    const scopes = ['tests', 'unknown', 'api'];
    expect(validateScope('api', ['api', 'tests'])).toBe(true);
    expect(validateScope('API', ['api', 'tests'])).toBe(false);
    expect(sortScopesByRegistry(scopes, ['api', 'tests'])).toEqual(['api', 'tests', 'unknown']);
    expect(scopes).toEqual(['tests', 'unknown', 'api']);
  });
});
