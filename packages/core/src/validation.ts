/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import { DEFAULT_AGENT_CLASSES, DEFAULT_SCOPE_REGISTRY, type CoordinationConfig, type Lock } from './types.js';

export class ValidationError extends Error { constructor(message: string) { super(message); this.name = 'ValidationError'; } }
export function identifier(value: unknown, label = 'identifier', max = 96): string {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || /[.]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new ValidationError(`Invalid ${label}: use a bounded plain identifier without path separators or device names`);
  }
  return value;
}
export function boundedText(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new ValidationError(`Invalid ${label}: empty, oversized, or control characters`);
  return value;
}
export function duration(value: unknown, label = 'lease', min = 1, max = 1440): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ValidationError(`Invalid ${label}: expected ${min}..${max} minutes`);
  return value;
}
export function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ValidationError('Invalid clock');
  return value;
}
export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ValidationError('Invalid ISO timestamp');
  return value;
}
export function object(value: unknown, keys: string[], label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(k => !keys.includes(k))) throw new ValidationError(`Invalid ${label} fields`);
  return value as Record<string, any>;
}
export function validateLock(value: unknown, expectedScope: string): Lock {
  const r = object(value, ['schema_version', 'generation', 'agent_instance', 'agent_class', 'scope', 'acquired_at', 'renewed_at', 'expires_at', 'task'], 'holder');
  identifier(r.agent_instance, 'instance'); identifier(r.agent_class, 'class'); identifier(r.scope, 'scope');
  if (r.scope !== expectedScope || Date.parse(timestamp(r.expires_at)) <= Date.parse(timestamp(r.acquired_at))) throw new ValidationError('Invalid holder scope or expiry ordering');
  const base = r.renewed_at === undefined ? Date.parse(r.acquired_at) : Date.parse(timestamp(r.renewed_at));
  if (base < Date.parse(r.acquired_at)) throw new ValidationError('Renewal precedes acquisition');
  duration((Date.parse(r.expires_at) - base) / 60_000, 'recorded lease');
  if (r.schema_version !== undefined && r.schema_version !== 2) throw new ValidationError('Unsupported holder version');
  if (r.generation !== undefined) identifier(r.generation, 'generation');
  if ((r.schema_version === 2) !== (r.generation !== undefined)) throw new ValidationError('Holder generation/version mismatch');
  if (r.task !== undefined) boundedText(r.task, 'task');
  return r as Lock;
}
export function uniqueIdentifiers(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new ValidationError(`Invalid ${label}`);
  const result = value.map(v => identifier(v, label));
  if (new Set(result).size !== result.length) throw new ValidationError(`Duplicate ${label}`);
  return result;
}
export function defaultConfig(now = new Date()): CoordinationConfig {
  return { version: '0.2.0', protocol_version: '3', created_at: validDate(now).toISOString(), scopes: { registry: [...DEFAULT_SCOPE_REGISTRY], lease_duration_minutes: 15, renewal_threshold_minutes: 5, grace_period_minutes: 5 }, agent_classes: [...DEFAULT_AGENT_CLASSES], heartbeat: { enabled: false, interval_seconds: 60 }, incidents: { check_window_hours: 24 } };
}
export function validateConfig(value: unknown): CoordinationConfig {
  const r = object(value, ['version', 'protocol_version', 'created_at', 'scopes', 'agent_classes', 'heartbeat', 'incidents'], 'configuration');
  if (r.version !== '0.2.0' || r.protocol_version !== '3') throw new ValidationError('Unsupported configuration version; migrate to protocol 3 with setup --force after stopping agents');
  timestamp(r.created_at);
  const s = object(r.scopes, ['registry', 'lease_duration_minutes', 'renewal_threshold_minutes', 'grace_period_minutes'], 'scopes');
  uniqueIdentifiers(s.registry, 'registry'); duration(s.lease_duration_minutes); duration(s.grace_period_minutes, 'grace', 0, 60); duration(s.renewal_threshold_minutes, 'renewal threshold', 0.01, s.lease_duration_minutes);
  uniqueIdentifiers(r.agent_classes, 'agent classes');
  const h = object(r.heartbeat, ['enabled', 'interval_seconds'], 'heartbeat');
  if (h.enabled !== false || h.interval_seconds !== 60) throw new ValidationError('Heartbeats are unsupported in protocol 3; enabled must be false');
  const i = object(r.incidents, ['check_window_hours'], 'incidents');
  if (!Number.isInteger(i.check_window_hours) || i.check_window_hours < 1 || i.check_window_hours > 720) throw new ValidationError('Invalid incident window');
  return r as CoordinationConfig;
}
export function terminalText(value: unknown): string {
  return String(value).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 4096);
}
