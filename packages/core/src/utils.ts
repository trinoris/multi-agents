/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 */

import type { Lock, HandoffMetadata, Handoff } from './types.js';
import { boundedText, duration, identifier, timestamp, validDate } from './validation.js';

/**
 * Parse lease duration and calculate expiration time
 */
export function calculateExpiration(
  durationMinutes: number,
  from: Date = new Date()
): Date {
  return validDate(new Date(validDate(from).getTime() + duration(durationMinutes) * 60 * 1000));
}

/**
 * Check if a lock has expired
 */
export function isLockExpired(lock: Lock, now: Date = new Date()): boolean {
  const expiresAt = new Date(timestamp(lock.expires_at));
  return validDate(now) > expiresAt;
}

/**
 * Check if a lock is within grace period after expiration
 */
export function isInGracePeriod(
  lock: Lock,
  gracePeriodMinutes: number,
  now: Date = new Date()
): boolean {
  const expiresAt = new Date(timestamp(lock.expires_at));
  duration(gracePeriodMinutes, 'grace', 0, 60); validDate(now);
  const gracePeriodEnd = new Date(expiresAt.getTime() + gracePeriodMinutes * 60 * 1000);
  return now > expiresAt && now <= gracePeriodEnd;
}

/**
 * Calculate time until lock expires
 */
export function timeUntilExpiry(lock: Lock, now: Date = new Date()): number {
  const expiresAt = new Date(timestamp(lock.expires_at));
  return Math.max(0, expiresAt.getTime() - validDate(now).getTime());
}

/**
 * Format milliseconds to human-readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Parse handoff frontmatter from markdown
 */
export function parseFrontmatter(content: string): HandoffMetadata | null {
  if (typeof content !== 'string' || content.length > 262144) return null;
  const frontmatterMatch = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]+?)\n---(?:\n|$)/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const metadata: Record<string, string> = Object.create(null);
  const allowed = ['from_class', 'from_instance', 'to_class', 'to_instance', 'scopes', 'status', 'priority', 'created'];

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (!allowed.includes(key) || Object.hasOwn(metadata, key)) return null;
      metadata[key] = value.trim();
    } else if (line.trim()) return null;
  }
  try {
    for (const field of ['from_class', 'from_instance', 'to_class', 'to_instance']) identifier(metadata[field], field);
    timestamp(metadata.created);
    const scopes = metadata.scopes?.split(',').map(v => v.trim());
    if (!scopes?.length || scopes.length > 64 || new Set(scopes).size !== scopes.length) return null;
    scopes.forEach(s => identifier(s, 'scope'));
    if (!['ready', 'claimed', 'completed', 'failed'].includes(metadata.status) || (metadata.priority !== undefined && !['low', 'normal', 'high'].includes(metadata.priority))) return null;
    return metadata as unknown as HandoffMetadata;
  } catch { return null; }
}

/**
 * Parse full handoff note
 */
export function parseHandoff(content: string): Handoff | null {
  content = content.replace(/\r\n/g, '\n');
  const metadata = parseFrontmatter(content);
  if (!metadata) return null;

  // Remove frontmatter
  const body = content.replace(/^---\n[\s\S]+?\n---\n/, '');

  // Extract sections
  const titleMatch = body.match(/^# (.+)/m);
  const contextMatch = body.match(/## Context\n\n([\s\S]+?)(?=\n##|$)/);
  const taskMatch = body.match(/## Task\n\n([\s\S]+?)(?=\n##|$)/);
  const verifiedMatch = body.match(/## What I Verified\n\n([\s\S]+?)(?=\n##|$)/);
  const assumedMatch = body.match(/## What I Assumed\n\n([\s\S]+?)(?=\n##|$)/);
  const instructionsMatch = body.match(/## Instructions\n\n([\s\S]+?)(?=\n##|$)/);
  const outcomeMatch = body.match(/## Outcome\n\n([\s\S]+?)$/);
  if (!titleMatch || !contextMatch || !taskMatch || !verifiedMatch || !assumedMatch) return null;

  const extractBullets = (text: string): string[] => {
    return text
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().startsWith('✅') || line.trim().startsWith('⚠️'))
      .map(line => line.trim().replace(/^[-•✅⚠️]\s*/, ''));
  };

  return {
    metadata,
    title: titleMatch?.[1]?.trim() || '',
    context: contextMatch?.[1]?.trim() || '',
    task: taskMatch?.[1]?.trim() || '',
    verified: verifiedMatch ? extractBullets(verifiedMatch[1]) : [],
    assumed: assumedMatch ? extractBullets(assumedMatch[1]) : [],
    instructions: instructionsMatch?.[1]?.trim(),
    outcome: outcomeMatch?.[1]?.trim(),
  };
}

/**
 * Validate scope against registry
 */
export function validateScope(scope: string, registry: string[]): boolean {
  return registry.includes(scope);
}

/**
 * Sort scopes by registry ordering (for deadlock prevention)
 */
export function sortScopesByRegistry(scopes: string[], registry: string[]): string[] {
  const indexMap = new Map(registry.map((scope, i) => [scope, i]));
  return [...scopes].sort((a, b) => {
    const aIndex = indexMap.get(a) ?? Infinity;
    const bIndex = indexMap.get(b) ?? Infinity;
    return aIndex - bIndex;
  });
}

/**
 * Generate agent instance ID
 */
export function generateInstanceId(agentClass: string, suffix?: string, random?: () => string): string {
  identifier(agentClass, 'class');
  // Injected by the Node CLI; core retains no Node imports.
  const crypto = (globalThis as unknown as { crypto?: { randomUUID(): string } }).crypto;
  const entropy = random ? random() : crypto?.randomUUID();
  if (!entropy) throw new Error('A secure instance ID generator is required');
  identifier(entropy, 'random ID'); if (suffix) identifier(suffix, 'suffix');
  return identifier([agentClass, entropy, suffix].filter(Boolean).join('-'), 'instance');
}

/**
 * Format ISO 8601 timestamp
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}
