import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '@trinoris/agent-core';
import { listIncidents } from './lock.js';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-incidents-')); roots.push(root);
  fs.mkdirSync(join(root, 'incidents'));
  fs.writeFileSync(join(root, 'config.json'), JSON.stringify(defaultConfig()));
  return { root, dir: join(root, 'incidents') };
}
function writeEvent(p: ReturnType<typeof fixture>, id: string, stage: string, event: Record<string, unknown>) {
  fs.writeFileSync(join(p.dir, `${id}.${stage}.json`), JSON.stringify(event));
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('bounded read-only incident listing', () => {
  it('lists newest valid events and filters by registered scope', () => {
    const p = fixture();
    writeEvent(p, '11111111-1111-4111-8111-111111111111', 'completed', {
      schema_version: 2, operation_id: '11111111-1111-4111-8111-111111111111', stage: 'completed',
      at: '2026-10-26T12:00:00.000Z', action: 'break', scope: 'api', reason: 'actor stopped', state_committed: true,
    });
    writeEvent(p, '22222222-2222-4222-8222-222222222222', 'failed', {
      schema_version: 2, operation_id: '22222222-2222-4222-8222-222222222222', stage: 'failed',
      at: '2026-10-26T13:00:00.000Z', action: 'break', scope: 'tests', reason: 'disk error', state_committed: false,
    });
    const all = listIncidents(p);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ stage: 'failed', scope: 'tests', valid: true });
    expect(listIncidents(p, 'api')).toMatchObject([{ stage: 'completed', scope: 'api', valid: true }]);
    expect(() => listIncidents(p, 'unknown')).toThrow();
  });

  it('reports malformed event files without exposing arbitrary contents', () => {
    const p = fixture(); const filename = '33333333-3333-4333-8333-333333333333.failed.json';
    fs.writeFileSync(join(p.dir, filename), '{secret: malformed');
    const [event] = listIncidents(p);
    expect(event).toEqual({ filename, valid: false });
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('bounds event count and field lengths', () => {
    const p = fixture(); const id = '44444444-4444-4444-8444-444444444444';
    writeEvent(p, id, 'failed', {
      schema_version: 2, operation_id: id, stage: 'failed', at: '2026-10-26T13:00:00.000Z',
      scope: 'api', reason: 'r'.repeat(5000), error: 'e'.repeat(5000),
    });
    expect(listIncidents(p)[0].reason).toHaveLength(256);
    for (let i = 0; i < 201; i++) {
      const serial = String(i).padStart(12, '0'); const value = `55555555-5555-4555-8555-${serial}`;
      writeEvent(p, value, 'failed', { schema_version: 2, operation_id: value, stage: 'failed', at: `2026-10-26T12:${String(i % 60).padStart(2, '0')}:00.000Z`, scope: 'api' });
    }
    expect(listIncidents(p)).toHaveLength(200);
  });
});
