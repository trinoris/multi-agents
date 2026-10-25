/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import type { Artifact, Executor } from './artifacts.mjs';
export function parseReleaseArgs(args: string[]): { dryRun: boolean };
export function cleanEnvironment(env: NodeJS.ProcessEnv, npmrc: string): NodeJS.ProcessEnv;
export function commandInvocation(command: string, args: string[], env?: NodeJS.ProcessEnv, platform?: string): { command: string; args: string[] };
export const execute: Executor;
export function runRelease(args: string[], root?: string, run?: Executor): { started_at: string; dry_run: boolean; source: string; artifacts: Artifact[]; published: string[] };
