import { describe, expect, it } from 'vitest';

import { extractCode, generateCode, hashCode } from '../../../src/domain/activation.ts';

describe('activation codes', () => {
  it('look like XXX-XXX, without look-alike characters, with a digit and a letter', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/);
      expect(code).toMatch(/[2-9]/);
      expect(code).toMatch(/[A-Z]/);
    }
  });

  it('are random', () => {
    const codes = new Set(Array.from({ length: 200 }, generateCode));
    expect(codes.size).toBe(200);
  });

  it.each([
    ['@Ent K7P-42Q', 'K7P-42Q'],
    ['@Ent k7p-42q', 'K7P-42Q'],
    ['K7P42Q', 'K7P-42Q'],
    ['here it is: "K7P-42Q".', 'K7P-42Q'],
    ['@491701234567 K7P-42Q', 'K7P-42Q'],
  ])('are found in %j', (text, code) => {
    expect(extractCode(text)).toBe(code);
  });

  it.each(['@Ent hello', 'please help', 'what is 123456?', '@Ent K7P 42Q', ''])(
    'are not found in %j',
    (text) => {
      expect(extractCode(text)).toBeNull();
    },
  );

  it('hash to SHA-256 hex', () => {
    expect(hashCode('K7P-42Q')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode('K7P-42Q')).toBe(hashCode('K7P-42Q'));
    expect(hashCode('K7P-42Q')).not.toBe(hashCode('K7P-42R'));
  });
});
