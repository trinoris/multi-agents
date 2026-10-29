/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * @trinoris/agent-sdk — the filesystem lock engine, for agents and tools that need the
 * protocol programmatically rather than through the CLI.
 *
 * Layering: agent-core holds pure predicates with no Node dependencies; this package
 * adds the filesystem operations; agent-cli is a thin shell over this.
 */

export * from './lock.js';
export * from './configuration.js';
export * from './filesystem.js';
export * from './guard.js';
