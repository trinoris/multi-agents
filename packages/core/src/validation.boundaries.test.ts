import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  boundedText,
  defaultConfig,
  duration,
  identifier,
  object,
  timestamp,
  uniqueIdentifiers,
  validDate,
  validateConfig,
  validateLock,
} from './validation.js';

const acquiredAt = '2026-10-25T12:00:00.000Z';
const validHolder = () => ({
  schema_version: 2,
  generation: 'generation-1',
  agent_instance: 'cursor-session-1',
  agent_class: 'cursor',
  scope: 'api',
  acquired_at: acquiredAt,
  expires_at: '2026-10-25T12:15:00.000Z',
});

describe('validation boundary decisions', () => {
  it('covers accepted and rejected identifier shapes', () => {
    expect(identifier('cursor-session_1')).toBe('cursor-session_1');
    for (const value of [undefined, 'x'.repeat(97), '../escape', 'trailing.', 'CON']) {
      expect(() => identifier(value)).toThrow(ValidationError);
    }
  });

  it('covers each bounded text rejection and the default limit', () => {
    expect(boundedText('reason text', 'reason')).toBe('reason text');
    expect(() => boundedText(null, 'reason')).toThrow(ValidationError);
    expect(() => boundedText('  ', 'reason')).toThrow(ValidationError);
    expect(() => boundedText('x'.repeat(9), 'reason', 8)).toThrow(ValidationError);
    expect(() => boundedText('bad\u001btext', 'reason')).toThrow(ValidationError);
  });

  it('covers duration types, finite bounds, and valid boundary values', () => {
    expect(duration(1, 'lease', 1, 10)).toBe(1);
    expect(duration(10, 'lease', 1, 10)).toBe(10);
    for (const value of ['1', Number.NaN, Number.POSITIVE_INFINITY, 0, 11]) {
      expect(() => duration(value, 'lease', 1, 10)).toThrow(ValidationError);
    }
  });

  it('accepts valid clocks and timestamps and rejects malformed values', () => {
    const date = new Date(acquiredAt);
    expect(validDate(date)).toBe(date);
    expect(() => validDate('2026-10-25' as unknown as Date)).toThrow('Invalid clock');
    expect(() => validDate(new Date(Number.NaN))).toThrow('Invalid clock');
    expect(timestamp(acquiredAt)).toBe(acquiredAt);
    for (const value of [null, 'not a date', '2026-10-25']) {
      expect(() => timestamp(value)).toThrow('Invalid ISO timestamp');
    }
  });

  it('rejects non-plain objects, arrays, and unknown fields', () => {
    expect(object({ value: 1 }, ['value'], 'record')).toEqual({ value: 1 });
    for (const value of [null, [], Object.create({ inherited: true }), { value: 1, extra: 2 }]) {
      expect(() => object(value, ['value'], 'record')).toThrow('Invalid record fields');
    }
  });

  it('validates complete v2 holders and each holder invariant', () => {
    expect(validateLock(validHolder(), 'api').generation).toBe('generation-1');
    const legacy = validHolder();
    delete (legacy as Partial<typeof legacy>).schema_version;
    delete (legacy as Partial<typeof legacy>).generation;
    expect(validateLock(legacy, 'api').agent_class).toBe('cursor');

    const wrongScope = validHolder(); wrongScope.scope = 'engine';
    expect(() => validateLock(wrongScope, 'api')).toThrow(/scope or expiry ordering/);
    const reversedExpiry = validHolder(); reversedExpiry.expires_at = acquiredAt;
    expect(() => validateLock(reversedExpiry, 'api')).toThrow(/scope or expiry ordering/);
    const renewed = validHolder(); renewed.renewed_at = '2026-10-25T12:05:00.000Z';
    expect(validateLock(renewed, 'api').renewed_at).toBe(renewed.renewed_at);
    const earlyRenewal = validHolder(); earlyRenewal.renewed_at = '2026-10-25T11:59:59.000Z';
    expect(() => validateLock(earlyRenewal, 'api')).toThrow(/Renewal precedes acquisition/);
    const unsupported = validHolder(); unsupported.schema_version = 3;
    expect(() => validateLock(unsupported, 'api')).toThrow(/Unsupported holder version/);
    const badGeneration = validHolder(); badGeneration.generation = '../bad';
    expect(() => validateLock(badGeneration, 'api')).toThrow(/Invalid generation/);
    const missingGeneration = validHolder(); delete (missingGeneration as Partial<typeof missingGeneration>).generation;
    expect(() => validateLock(missingGeneration, 'api')).toThrow(/generation\/version mismatch/);
    const invalidTask = { ...validHolder(), task: '  ' };
    expect(() => validateLock(invalidTask, 'api')).toThrow(/Invalid task/);
  });

  it('covers unique identifier collection constraints', () => {
    expect(uniqueIdentifiers(['cursor', 'codex'], 'agents')).toEqual(['cursor', 'codex']);
    for (const value of [null, [], Array.from({ length: 65 }, (_, i) => `agent-${i}`), ['bad/name'], ['same', 'same']]) {
      expect(() => uniqueIdentifiers(value, 'agents')).toThrow(ValidationError);
    }
  });

  it('accepts a complete current configuration and rejects invalid sections', () => {
    expect(validateConfig(defaultConfig(new Date(acquiredAt))).agent_classes).toContain('cursor');

    const unsupported = defaultConfig(); unsupported.version = '9.0.0';
    expect(() => validateConfig(unsupported)).toThrow(/Unsupported configuration version/);
    const badDate = defaultConfig(); badDate.created_at = 'not-a-date';
    expect(() => validateConfig(badDate)).toThrow(/Invalid ISO timestamp/);
    const badScopes = defaultConfig(); (badScopes as any).scopes.extra = true;
    expect(() => validateConfig(badScopes)).toThrow(/Invalid scopes fields/);
    const badClasses = defaultConfig(); badClasses.agent_classes = [];
    expect(() => validateConfig(badClasses)).toThrow(/Invalid agent classes/);
    for (const heartbeat of [
      { enabled: true, interval_seconds: 60 },
      { enabled: false, interval_seconds: 61 },
    ]) {
      const config = defaultConfig(); config.heartbeat = heartbeat;
      expect(() => validateConfig(config)).toThrow(/Heartbeats are unsupported/);
    }
    for (const hours of [0, 1.5, 721]) {
      const config = defaultConfig(); config.incidents.check_window_hours = hours;
      expect(() => validateConfig(config)).toThrow(/Invalid incident window/);
    }
  });
});
