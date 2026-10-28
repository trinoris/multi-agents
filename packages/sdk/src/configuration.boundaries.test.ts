import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfiguration } from './configuration.js';

const roots: string[] = [];
function fixture() { const root = fs.mkdtempSync(join(tmpdir(), 'agent-sdk-config-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('configuration loading boundaries', () => {
  it('uses defaults when optional config is missing and reports required config clearly', () => {
    const root = fixture();
    expect(loadConfiguration({ root }).scopes.registry).toContain('api');
    expect(() => loadConfiguration({ root }, true)).toThrow(/run setup/i);
  });

  it('rejects malformed JSON and invalid config instead of silently using defaults', () => {
    const root = fixture(); const file = join(root, 'config.json');
    fs.writeFileSync(file, '{');
    expect(() => loadConfiguration({ root })).toThrow(SyntaxError);
    fs.writeFileSync(file, JSON.stringify({ version: 999 }));
    expect(() => loadConfiguration({ root })).toThrow();
  });
});
