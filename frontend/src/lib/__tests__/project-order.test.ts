import { describe, expect, it } from 'vitest';
import {
  PROJECT_ORDER_STORAGE_KEY,
  applyProjectOrder,
  moveItem,
  moveItemToIndex,
  parseProjectOrder,
  resolveDropIndex,
  serializeProjectOrder,
} from '../project-order';

interface Project {
  id: string;
  title: string;
}

const getId = (project: Project) => project.id;
const projects: Project[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
  { id: 'c', title: 'Gamma' },
];

describe('parseProjectOrder', () => {
  it('parses a stored order', () => {
    expect(parseProjectOrder('["c","a","b"]')).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty order for null or empty input', () => {
    expect(parseProjectOrder(null)).toEqual([]);
    expect(parseProjectOrder('')).toEqual([]);
  });

  it('returns an empty order for malformed JSON', () => {
    expect(parseProjectOrder('{not json')).toEqual([]);
  });

  it('returns an empty order when the value is not an array', () => {
    expect(parseProjectOrder('{"a":1}')).toEqual([]);
    expect(parseProjectOrder('42')).toEqual([]);
  });

  it('drops non-string, empty and duplicate entries', () => {
    expect(parseProjectOrder('["a", 1, null, "", "a", "b"]')).toEqual(['a', 'b']);
  });
});

describe('serializeProjectOrder', () => {
  it('round-trips through parseProjectOrder', () => {
    expect(parseProjectOrder(serializeProjectOrder(['x', 'y']))).toEqual(['x', 'y']);
  });

  it('does not alias the caller array', () => {
    const order = ['x'];
    serializeProjectOrder(order);
    order.push('y');
    expect(parseProjectOrder(serializeProjectOrder(['x']))).toEqual(['x']);
  });
});

describe('applyProjectOrder', () => {
  it('returns the incoming order when nothing is stored', () => {
    const { ordered, nextOrder } = applyProjectOrder(projects, [], getId);
    expect(ordered.map(getId)).toEqual(['a', 'b', 'c']);
    expect(nextOrder).toEqual(['a', 'b', 'c']);
  });

  it('applies the stored order', () => {
    const { ordered, nextOrder } = applyProjectOrder(projects, ['c', 'a', 'b'], getId);
    expect(ordered.map(getId)).toEqual(['c', 'a', 'b']);
    expect(nextOrder).toEqual(['c', 'a', 'b']);
  });

  it('drops stored ids that no longer exist', () => {
    const { ordered, nextOrder } = applyProjectOrder(projects, ['gone', 'b', 'a'], getId);
    expect(ordered.map(getId)).toEqual(['b', 'a', 'c']);
    expect(nextOrder).toEqual(['b', 'a', 'c']);
  });

  it('appends unpositioned projects in their incoming order', () => {
    const extra = [...projects, { id: 'd', title: 'Delta' }];
    const { ordered, nextOrder } = applyProjectOrder(extra, ['c'], getId);
    expect(ordered.map(getId)).toEqual(['c', 'a', 'b', 'd']);
    expect(nextOrder).toEqual(['c', 'a', 'b', 'd']);
  });

  it('handles an empty collection', () => {
    expect(applyProjectOrder([], ['a'], getId).nextOrder).toEqual([]);
  });
});

describe('moveItem', () => {
  it('moves an item forwards', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an item backwards', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op when the indices are equal', () => {
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('ignores an out-of-range source', () => {
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });

  it('clamps an out-of-range target', () => {
    expect(moveItem(['a', 'b'], 0, 99)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'], 1, -5)).toEqual(['b', 'a']);
  });

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c'];
    moveItem(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('moveItemToIndex', () => {
  it('moves by id', () => {
    expect(moveItemToIndex(projects, 'c', 0, getId).map(getId)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an unknown id', () => {
    expect(moveItemToIndex(projects, 'zzz', 0, getId).map(getId)).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveDropIndex', () => {
  const rects = [
    { top: 0, height: 100 },
    { top: 100, height: 100 },
    { top: 200, height: 100 },
  ];

  it('inserts before the card whose midpoint is above the pointer', () => {
    expect(resolveDropIndex(10, rects)).toBe(0);
    expect(resolveDropIndex(120, rects)).toBe(1);
    expect(resolveDropIndex(220, rects)).toBe(2);
  });

  it('appends when the pointer is past the last midpoint', () => {
    expect(resolveDropIndex(260, rects)).toBe(3);
  });

  it('handles a boundary exactly on a midpoint', () => {
    expect(resolveDropIndex(50, rects)).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(resolveDropIndex(100, [])).toBe(0);
  });
});

describe('PROJECT_ORDER_STORAGE_KEY', () => {
  it('is namespaced to the app', () => {
    expect(PROJECT_ORDER_STORAGE_KEY).toBe('agenticpay-project-order');
  });
});
