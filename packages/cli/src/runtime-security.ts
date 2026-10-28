/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */

export type RuntimeAdvisory = {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cvss: number;
  cvssVersion: '4.0';
  fixed: Record<string, string>;
  source: string;
  vendorNotice?: string;
};

export type RuntimeSecurityReport = {
  status: 'no-known-critical' | 'blocked' | 'unknown';
  nodeVersion: string;
  supportedMinimum: '22.0.0';
  testedLtsMajors: number[];
  catalogUpdatedAt: string;
  catalogMode: 'bundled-offline-snapshot';
  criticalAdvisories: Array<RuntimeAdvisory & { fixedVersion: string }>;
};

// Reviewed advisory snapshot. Update this list when reviewing a published Node.js
// security notice; the CLI intentionally does not make a network request at startup.
export const RUNTIME_ADVISORY_CATALOG_UPDATED_AT = '2026-10-28';
export const RUNTIME_ADVISORIES: RuntimeAdvisory[] = [
  {
    id: 'CVE-2026-111497',
    title: 'Brotli decoder out-of-bounds write may permit remote code execution',
    severity: 'critical',
    cvss: 9.2,
    cvssVersion: '4.0',
    fixed: { '22': '22.23.4', '24': '24.22.1', '26': '26.12.1' },
    source: 'https://github.com/advisories/GHSA-9v8h-qqgm-4m35',
    vendorNotice: 'https://nodejs.org/en/blog/vulnerability/october-2026-security-releases',
  },
];

type ParsedVersion = { major: number; minor: number; patch: number; prerelease: boolean };
function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: Boolean(match[4]) };
}
function isBefore(left: ParsedVersion, right: ParsedVersion): boolean {
  return left.major !== right.major ? left.major < right.major
    : left.minor !== right.minor ? left.minor < right.minor
      : left.patch !== right.patch ? left.patch < right.patch
        : left.prerelease && !right.prerelease;
}

export function getRuntimeSecurityReport(
  nodeVersion: string,
  advisories: RuntimeAdvisory[] = RUNTIME_ADVISORIES,
): RuntimeSecurityReport {
  const parsed = parseVersion(nodeVersion);
  const criticalAdvisories = parsed ? advisories.flatMap(advisory => {
    if (advisory.severity !== 'critical') return [];
    const fixedVersion = advisory.fixed[String(parsed.major)];
    const fixed = fixedVersion && parseVersion(fixedVersion);
    return fixed && isBefore(parsed, fixed)
      ? [{ ...advisory, fixedVersion }]
      : [];
  }) : [];
  return {
    status: !parsed ? 'unknown' : criticalAdvisories.length ? 'blocked' : 'no-known-critical',
    nodeVersion,
    supportedMinimum: '22.0.0',
    testedLtsMajors: [22, 24],
    catalogUpdatedAt: RUNTIME_ADVISORY_CATALOG_UPDATED_AT,
    catalogMode: 'bundled-offline-snapshot',
    criticalAdvisories,
  };
}

export function shouldBlockStartup(args: string[], report: RuntimeSecurityReport): boolean {
  if (report.status !== 'blocked') return false;
  if (args.includes('--help') || args.includes('-h') || args.includes('--version') || args.includes('-v')) return false;
  return !(args[0] === 'doctor' && args[1] === '--runtime');
}
