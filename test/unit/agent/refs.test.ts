import { describe, expect, it } from 'vitest';

import { RefMap } from '../../../src/agent/refs.ts';
import { DomainError } from '../../../src/domain/errors.ts';

describe('RefMap', () => {
  it('numbers plants and notes separately and keeps a ref per id', () => {
    const refs = new RefMap();
    expect(refs.add('plant', 'a')).toBe('p1');
    expect(refs.add('note', 'b')).toBe('n1');
    expect(refs.add('plant', 'c')).toBe('p2');
    expect(refs.add('plant', 'a')).toBe('p1');
    expect(refs.refOf('c')).toBe('p2');
  });

  it('resolves refs, forgiving case and brackets', () => {
    const refs = new RefMap();
    refs.add('plant', 'a');
    expect(refs.resolve('plant', 'p1')).toBe('a');
    expect(refs.resolve('plant', ' [P1] ')).toBe('a');
  });

  it('refuses unknown refs and refs of the other kind', () => {
    const refs = new RefMap();
    refs.add('note', 'b');
    expect(() => refs.resolve('plant', 'p1')).toThrow(DomainError);
    expect(() => refs.resolve('plant', 'n1')).toThrow(/unknown plant ref "n1"/);
  });
});
