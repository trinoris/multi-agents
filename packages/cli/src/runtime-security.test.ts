import { describe, expect, it } from 'vitest';
import {
  getRuntimeSecurityReport,
  RUNTIME_ADVISORIES,
  shouldBlockStartup,
  type RuntimeAdvisory,
} from './runtime-security.js';

const critical: RuntimeAdvisory = {
  id: 'CVE-2099-00001',
  title: 'Critical Node runtime issue',
  severity: 'critical',
  cvss: 9.2,
  cvssVersion: '4.0',
  fixed: { '22': '22.23.4', '24': '24.22.1' },
  source: 'https://example.test/advisory',
};

describe('CLI runtime security gate', () => {
  it('blocks normal commands when an exact runtime version is below the fixed patch', () => {
    const report = getRuntimeSecurityReport('v24.22.0', [critical]);
    expect(report).toMatchObject({
      status: 'blocked',
      nodeVersion: 'v24.22.0',
      criticalAdvisories: [{ id: critical.id, fixedVersion: '24.22.1' }],
    });
    expect(shouldBlockStartup(['status'], report)).toBe(true);
  });

  it('allows exact fixed versions and does not confuse adjacent major lines', () => {
    expect(getRuntimeSecurityReport('v24.22.1', [critical]).status).toBe('no-known-critical');
    expect(getRuntimeSecurityReport('v24.22.2', [critical]).status).toBe('no-known-critical');
    expect(getRuntimeSecurityReport('v24.23.1', [critical]).status).toBe('no-known-critical');
    expect(getRuntimeSecurityReport('v22.23.4', [critical]).status).toBe('no-known-critical');
    expect(getRuntimeSecurityReport('v23.0.0', [critical]).status).toBe('no-known-critical');
    expect(getRuntimeSecurityReport('v24.22.1-rc.1', [critical]).status).toBe('blocked');
  });

  it('does not block for high severity advisories', () => {
    const high = { ...critical, id: 'CVE-2099-00002', severity: 'high' as const };
    expect(getRuntimeSecurityReport('v24.0.0', [high]).status).toBe('no-known-critical');
  });

  it('keeps diagnostics and help available when the runtime is blocked', () => {
    const report = getRuntimeSecurityReport('v24.22.0', [critical]);
    expect(shouldBlockStartup(['acquire', '--scope', 'api'], report)).toBe(true);
    expect(shouldBlockStartup(['doctor', '--runtime'], report)).toBe(false);
    expect(shouldBlockStartup(['--help'], report)).toBe(false);
    expect(shouldBlockStartup(['--version'], report)).toBe(false);
  });

  it('reports an unparseable runtime as unknown rather than claiming it is clean', () => {
    expect(getRuntimeSecurityReport('unknown', [critical])).toMatchObject({ status: 'unknown' });
  });

  it('ships the reviewed Node Brotli advisory with fixed patch versions for affected majors', () => {
    expect(getRuntimeSecurityReport('v22.23.3').criticalAdvisories).toEqual([
      expect.objectContaining({ id: 'CVE-2026-111497', fixedVersion: '22.23.4' }),
    ]);
    expect(getRuntimeSecurityReport('v24.22.0').criticalAdvisories).toEqual([
      expect.objectContaining({ id: 'CVE-2026-111497', fixedVersion: '24.22.1' }),
    ]);
    expect(getRuntimeSecurityReport('v26.12.0').criticalAdvisories).toEqual([
      expect.objectContaining({ id: 'CVE-2026-111497', fixedVersion: '26.12.1' }),
    ]);
    expect(RUNTIME_ADVISORIES[0].source).toContain('GHSA-9v8h-qqgm-4m35');
  });
});
