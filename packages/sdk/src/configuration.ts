/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import { join, resolve } from 'node:path';
import { defaultConfig, validateConfig } from '@trinoris/agent-core';
import { readText } from './filesystem.js';

export function loadConfiguration(paths: { root: string }, required = false) {
  const root = resolve(paths.root);
  const canonical = readText(root, join(root, 'config.json'));
  if (canonical === null) {
    if (required) throw new Error('Missing coordination configuration; run setup');
    return defaultConfig();
  }
  return validateConfig(JSON.parse(canonical));
}
