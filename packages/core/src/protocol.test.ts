import { describe, expect, it } from 'vitest';
import { PROTOCOL_TEXT } from './protocol.js';

describe('MA-T04 / MA-T12 shipped contract safety rules', () => {
  it('gives adopters an explicit no-spin and expiry/grace contract', () => {
    expect(PROTOCOL_TEXT).toMatch(/exit 3 means choose other work/);
    expect(PROTOCOL_TEXT).toMatch(/No retries or polling/);
    expect(PROTOCOL_TEXT).toMatch(/Grace delays takeover, it does not permit expired edits/);
  });
  it('explains the measured unsafe alternatives instead of leaving adopters to invent them', () => {
    expect(PROTOCOL_TEXT).toContain('mv -n');
    expect(PROTOCOL_TEXT).toContain('21/100');
    expect(PROTOCOL_TEXT).toContain('25/60');
    expect(PROTOCOL_TEXT).toContain('59/60');
    expect(PROTOCOL_TEXT).toContain('locks/<scope>.breaking');
    expect(PROTOCOL_TEXT).toMatch(/historical/i);
  });
});
