/**
 * © 2026 TRINORIS. MIT licensed — see LICENSE.
 */

import type { Lock, HandoffMetadata, Handoff } from './types.js';

/**
 * Parse lease duration and calculate expiration time
 */
export function calculateExpiration(
  durationMinutes: number,
  from: Date = new Date()
): Date {
  return new Date(from.getTime() + durationMinutes * 60 * 1000);
}

/**
 * Check if a lock has expired
 */
export function isLockExpired(lock: Lock, now: Date = new Date()): boolean {
  const expiresAt = new Date(lock.expires_at);
  return now > expiresAt;
}

/**
 * Check if a lock is within grace period after expiration
 */
export function isInGracePeriod(
  lock: Lock,
  gracePeriodMinutes: number,
  now: Date = new Date()
): boolean {
  const expiresAt = new Date(lock.expires_at);
  const gracePeriodEnd = new Date(expiresAt.getTime() + gracePeriodMinutes * 60 * 1000);
  return now > expiresAt && now <= gracePeriodEnd;
}

/**
 * Calculate time until lock expires
 */
export function timeUntilExpiry(lock: Lock, now: Date = new Date()): number {
  const expiresAt = new Date(lock.expires_at);
  return Math.max(0, expiresAt.getTime() - now.getTime());
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
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const metadata: Partial<HandoffMetadata> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      (metadata as any)[key] = value.trim();
    }
  }

  return metadata as HandoffMetadata;
}

/**
 * Parse full handoff note
 */
export function parseHandoff(content: string): Handoff | null {
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
export function generateInstanceId(agentClass: string, suffix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const parts = [agentClass, timestamp, random];
  if (suffix) parts.push(suffix);
  return parts.join('-');
}

/**
 * Format ISO 8601 timestamp
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}
