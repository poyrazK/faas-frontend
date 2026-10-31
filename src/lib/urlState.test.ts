import { describe, expect, it } from 'vitest';
import { intParam, pickParam, withSearch } from './urlState';

describe('withSearch', () => {
  it('sets, replaces and removes keys, keeping the rest', () => {
    expect(withSearch('?a=1&b=2', { b: '3', c: 'x y' })).toBe('?a=1&b=3&c=x+y');
    expect(withSearch('?a=1&b=2', { a: null, b: '' })).toBe('');
    expect(withSearch('', { deleted: true, operator: false, offset: 50 })).toBe('?deleted=1&offset=50');
    expect(withSearch('?keep=1', { gone: undefined })).toBe('?keep=1');
  });
});

describe('param readers', () => {
  it('accepts only known values and non-negative integers', () => {
    expect(pickParam('failed', ['failed', 'live'] as const, 'live')).toBe('failed');
    expect(pickParam('bogus', ['failed', 'live'] as const, 'live')).toBe('live');
    expect(pickParam(null, ['failed', 'live'] as const, 'live')).toBe('live');
    expect(intParam('50')).toBe(50);
    expect(intParam('-1')).toBe(0);
    expect(intParam('1.5', 7)).toBe(7);
    expect(intParam(null, 3)).toBe(3);
  });
});
