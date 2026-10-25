/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
export interface ReleasePackageSpec { directory: string; name: string; dependencies: Record<string, string>; devDependencies: Record<string, string> }
export const RELEASE_PACKAGE_SPECS: ReleasePackageSpec[];
export function validatePackageManifest(pkg: Record<string, any>, spec: ReleasePackageSpec, label?: string): string[];
export function validateReleaseInputs(root: string): string[];
export function createSbom(root: string): { bomFormat: string; specVersion: string; version: number; metadata: { timestamp: string }; components: Array<{ name: string; version: string; hashes?: Array<{ alg: string; content: string }> }> };
