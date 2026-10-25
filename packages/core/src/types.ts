/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 */

/**
 * Scope lock holder information
 */
export interface Lock {
  agent_instance: string;
  agent_class: string;
  scope: string;
  acquired_at: string; // ISO 8601
  expires_at: string;  // ISO 8601
  task?: string;
}

/**
 * Handoff frontmatter metadata
 */
export interface HandoffMetadata {
  from_class: string;
  from_instance: string;
  to_class: string;
  to_instance: string; // 'any' or specific instance ID
  scopes: string;      // comma-separated
  status: 'ready' | 'claimed' | 'completed' | 'failed';
  priority?: 'low' | 'normal' | 'high';
  created: string;     // ISO 8601
}

/**
 * Parsed handoff note
 */
export interface Handoff {
  metadata: HandoffMetadata;
  title: string;
  context: string;
  task: string;
  verified: string[];
  assumed: string[];
  instructions?: string;
  outcome?: string;
}

/**
 * Coordination configuration
 */
export interface CoordinationConfig {
  version: string;
  protocol_version: string;
  created_at: string;
  scopes: {
    registry: string[];
    lease_duration_minutes: number;
    renewal_threshold_minutes: number;
    grace_period_minutes: number;
  };
  agent_classes: string[];
  heartbeat: {
    enabled: boolean;
    interval_seconds: number;
  };
  incidents: {
    check_window_hours: number;
  };
}

/**
 * Incident record
 */
export interface Incident {
  timestamp: string;
  type: 'broken_lock' | 'expired_lease' | 'aba_detected' | 'other';
  scope: string;
  breaker?: string;
  evicted?: string;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Archive entry
 */
export interface ArchiveEntry {
  filename: string;
  from_class: string;
  to_class: string;
  claimed_by?: string;
  scopes: string[];
  status: string;
  created: string;
  completed: string;
  summary: string;
}

/**
 * Agent identity
 */
export interface AgentIdentity {
  agent_class: string;
  agent_instance: string;
}

/**
 * Scope registry with ordering
 */
export const DEFAULT_SCOPE_REGISTRY = [
  'engine',
  'webapp',
  'api',
  'agents',
  'infra',
  'specs',
  'tests',
  'root',
  'git',
] as const;

export type Scope = typeof DEFAULT_SCOPE_REGISTRY[number];

/**
 * Agent classes
 */
export const DEFAULT_AGENT_CLASSES = [
  'codex-gpt-6',
  'claude-opus-5',
  'claude-sonnet-4',
  'kiro',
] as const;

export type AgentClass = typeof DEFAULT_AGENT_CLASSES[number];
