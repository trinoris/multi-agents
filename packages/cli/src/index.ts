/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * @trinoris/agent-cli — CLI over @trinoris/agent-sdk.
 *
 * The lock engine lives in the SDK, not here: agents that drive the protocol in-process
 * should not have to shell out, and a CLI is the wrong place to own the only
 * implementation of the primitives verification proved are load-bearing.
 */

export { setup, type SetupOptions, type SetupResult } from './commands/setup.js';
export { verify, type VerifyResult } from './commands/verify.js';
export * from '@trinoris/agent-sdk';
