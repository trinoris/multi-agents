/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
export interface Artifact { path: string; name: string; version: string; sha256: string; files: string[] }
export interface ExpectedPackage { name: string; version: string; dependencies: Record<string, string> }
export type Executor = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: string }) => string;
export function validatePackedFiles(files: Array<{ name: string; type: string; content: string }>, expected: ExpectedPackage): Record<string, any>;
export function parseTarListing(output: string): Array<{ name: string; rawName: string }>;
export function inspectTarball(path: string, expected: ExpectedPackage): Artifact;
export function smokeTarballs(artifacts: Artifact[], arena: string, env: NodeJS.ProcessEnv, run: Executor, consumerNode?: string): void;
