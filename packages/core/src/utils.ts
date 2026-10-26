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
  const allowed = ['from_class', 'from_instance', 'to_class', 'to_instance', 'scopes', 'status', 'priority', 'created', 'locks_released'];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (match) {
      const [, key, raw] = match;
      if (!allowed.includes(key) || Object.hasOwn(metadata, key)) return null;
      metadata[key] = raw.trim().replace(/\s+#.*$/, '').trim();
    } else if (line.trim()) return null;
  }
  try {
    const protocol3 = Object.hasOwn(metadata, 'locks_released');
    const required = ['from_class', 'from_instance', 'to_class', 'to_instance', 'scopes', ...(protocol3 ? ['locks_released'] : ['status', 'created'])];
    if (required.some(field => !Object.hasOwn(metadata, field))) return null;
    for (const field of ['from_class', 'from_instance', 'to_class', 'to_instance']) identifier(metadata[field], field);
    if (protocol3) {
      if (Object.hasOwn(metadata, 'status') || Object.hasOwn(metadata, 'created') || Object.hasOwn(metadata, 'priority') || metadata.locks_released !== 'true') return null;
    } else {
      timestamp(metadata.created);
      if (!['ready', 'claimed', 'completed', 'failed'].includes(metadata.status) || (metadata.priority !== undefined && !['low', 'normal', 'high'].includes(metadata.priority))) return null;
    }
    const rawScopes = metadata.scopes;
    const scopes = rawScopes.startsWith('[') && rawScopes.endsWith(']')
      ? rawScopes.slice(1, -1).split(',').map(v => v.trim())
      : rawScopes.split(',').map(v => v.trim());
    if (!scopes?.length || scopes.length > 64 || new Set(scopes).size !== scopes.length) return null;
    scopes.forEach(s => identifier(s, 'scope'));
    if (scopes.some(s => !s)) return null;
    return {
      from_class: metadata.from_class, from_instance: metadata.from_instance,
      to_class: metadata.to_class, to_instance: metadata.to_instance,
      scopes: scopes.join(','), status: protocol3 ? 'ready' : metadata.status as HandoffMetadata['status'],
      protocol_version: protocol3 ? 3 : 2,
      ...(protocol3 ? { locks_released: true } : { created: metadata.created, ...(metadata.priority ? { priority: metadata.priority as HandoffMetadata['priority'] } : {}) }),
    };
  } catch { return null; }
}

/**
 * Parse full handoff note
 */
export function parseHandoff(content: string): Handoff | null {
  content = content.replace(/\r\n/g, '\n');
  const metadata = parseFrontmatter(content);
  if (!metadata) return null;
  if (metadata.protocol_version === 3) {
    const body = content.replace(/^---\n[\s\S]+?\n---\n/, '').replace(/^\n/, '');
    const firstSection = body.indexOf('\n## ');
    const headingStart = '# Context Handoff\n\n';
    if (firstSection < 0 || !body.startsWith(headingStart)) return null;
    const headerValues: Record<string, string> = Object.create(null);
    for (const line of body.slice(headingStart.length, firstSection).split('\n')) {
      const match = line.match(/^(Updated|Task|Status|Branch|Base commit):\s*(.+)$/);
      if (match) { if (Object.hasOwn(headerValues, match[1])) return null; headerValues[match[1]] = match[2].trim(); }
      else if (line.trim()) return null;
    }
    const status = headerValues.Status as Handoff['status'];
    const statuses: Handoff['status'][] = ['in-progress', 'blocked', 'ready-for-review', 'complete'];
    if (!headerValues.Updated || !headerValues.Task || !headerValues.Branch || !headerValues['Base commit'] || !statuses.includes(status)) return null;
    const updated = headerValues.Updated.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC$/);
    if (!updated) return null;
    try { timestamp(`${updated[1]}T${updated[2]}:00.000Z`); } catch { return null; }
    const requiredSections = ['Goal', 'User Constraints', 'Current State', 'Changes', 'Decisions', 'Verification', 'Failed Attempts', 'Blockers and Unknowns', 'Next Actions', 'Resume Instructions', 'References'];
    const allowedSections = new Set(requiredSections);
    const sections: Record<string, string> = Object.create(null);
    const pieces = body.split(/^## /m).slice(1);
    for (const piece of pieces) {
      const newline = piece.indexOf('\n'); if (newline < 0) return null;
      const name = piece.slice(0, newline).trim();
      if (!allowedSections.has(name) || Object.hasOwn(sections, name)) return null;
      sections[name] = piece.slice(newline + 1).trim();
    }
    if (requiredSections.some(name => !Object.hasOwn(sections, name) || !sections[name])) return null;
    const nextActions = sections['Next Actions'].split('\n').map(line => line.match(/^\d+\.\s+(.+)$/)?.[1]).filter((v): v is string => !!v);
    if (!nextActions.length) return null;
    const verified = sections.Verification.split('\n').filter(line => /^\|/.test(line) && !/^\|\s*:?-{2,}/.test(line) && !/\|\s*Check\s*\|/i.test(line));
    const assumed = sections['Blockers and Unknowns'].split('\n').filter(line => /not verified/i.test(line) || /^[-*]\s+/.test(line)).map(line => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
    metadata.status = status === 'complete' ? 'completed' : 'ready';
    return {
      metadata, format_version: 3, status, title: headerValues.Task, context: sections.Goal,
      task: sections['Next Actions'], verified, assumed, instructions: sections['Resume Instructions'],
      sections, next_actions: nextActions,
    };
  }

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
    metadata, format_version: 2,
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
