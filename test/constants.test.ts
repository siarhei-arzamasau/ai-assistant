import { describe, it, expect } from 'vitest';
import { COMMAND_REGEX, COMMANDS } from '../src/client/constants';

describe('COMMAND_REGEX', () => {
  it('matches a bare command and captures its name', () => {
    const m = COMMAND_REGEX.exec('/help');
    expect(m?.[1]).toBe('help');
    expect(m?.[2]).toBeUndefined();
  });

  it('captures the command name and its argument', () => {
    const m = COMMAND_REGEX.exec('/short-memory remember the milk');
    expect(m?.[1]).toBe('short-memory');
    expect(m?.[2]).toBe('remember the milk');
  });

  it('captures multi-line task descriptions', () => {
    const m = COMMAND_REGEX.exec('/task do a thing\nwith details');
    expect(m?.[1]).toBe('task');
    expect(m?.[2]).toBe('do a thing\nwith details');
  });

  it('does not match plain messages or unknown commands', () => {
    expect(COMMAND_REGEX.test('hello there')).toBe(false);
    expect(COMMAND_REGEX.test('/unknown-command x')).toBe(false);
    expect(COMMAND_REGEX.test('email me at a@b/help')).toBe(false);
  });

  it('matches every command documented in COMMANDS', () => {
    for (const { usage } of COMMANDS) {
      const name = usage.split(' ')[0]; // e.g. "/short-memory"
      const sample = usage.includes('<') ? `${name} sample arg` : name;
      const m = COMMAND_REGEX.exec(sample);
      expect(m, `expected ${name} to match`).not.toBeNull();
      expect(m?.[1]).toBe(name.slice(1));
    }
  });
});
