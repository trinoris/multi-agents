/**
 * © 2026 TRINORIS. All rights reserved.
 * Proprietary and confidential.
 *
 * @trinoris/agent-sdk — the filesystem lock engine, for agents and tools that need the
 * protocol programmatically rather than through the CLI.
 *
 * Layering: agent-core holds pure predicates with no Node dependencies; this package
 * adds the filesystem operations; agent-cli is a thin shell over this.
 */

export * from './lock.js';
