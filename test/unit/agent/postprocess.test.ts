import { describe, expect, it } from 'vitest';

import { capLength, MAX_REPLY_LENGTH, toWhatsApp } from '../../../src/agent/postprocess.ts';

describe('toWhatsApp', () => {
  it.each([
    ['**Saved** the pothos', '*Saved* the pothos'],
    ['__Saved__ it', '*Saved* it'],
    ['## Due this week\n- Pothos\n* Monstera', '*Due this week*\n• Pothos\n• Monstera'],
    ['~~old~~ new', '~old~ new'],
    ['see [the label](https://example.com/x)', 'see the label (https://example.com/x)'],
    ['use `p1`', 'use p1'],
    ['a\n\n\n\nb  ', 'a\n\nb'],
    ['_already_ *fine* • ok', '_already_ *fine* • ok'],
  ])('%j → %j', (input, expected) => {
    expect(toWhatsApp(input)).toBe(expected);
  });

  it('caps the length', () => {
    const long = 'Water the pothos. '.repeat(60);
    const out = toWhatsApp(long);
    expect(out.length).toBeLessThanOrEqual(MAX_REPLY_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('capLength', () => {
  it('keeps short text', () => {
    expect(capLength('short', 10)).toBe('short');
  });

  it('cuts at a sentence end when one is late enough', () => {
    expect(capLength('One two three. Four five six seven', 20)).toBe('One two three. …');
  });

  it('cuts at a word otherwise', () => {
    expect(capLength('alpha beta gamma delta epsilon', 16)).toBe('alpha beta…');
  });
});
