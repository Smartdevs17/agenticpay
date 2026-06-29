/**
 * DI container tests — Issue #485
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DIContainer } from '../container.js';

let c: DIContainer;

beforeEach(() => {
  c = DIContainer.createFresh();
});

describe('DIContainer – lifecycle: singleton', () => {
  it('returns the same instance on every resolve', () => {
    c.register('svc', () => ({ id: Math.random() }), 'singleton');
    const a = c.get<{ id: number }>('svc');
    const b = c.get<{ id: number }>('svc');
    expect(a).toBe(b);
  });
});

describe('DIContainer – lifecycle: transient', () => {
  it('returns a new instance on every resolve', () => {
    c.register('svc', () => ({ id: Math.random() }), 'transient');
    const a = c.get<{ id: number }>('svc');
    const b = c.get<{ id: number }>('svc');
    expect(a).not.toBe(b);
  });
});

describe('DIContainer – lifecycle: scoped', () => {
  it('returns the same instance within a scope', () => {
    c.register('svc', () => ({ id: Math.random() }), 'scoped');
    const scope = c.createScope();
    const a = c.get<{ id: number }>('svc', scope);
    const b = c.get<{ id: number }>('svc', scope);
    expect(a).toBe(b);
  });

  it('returns different instances across scopes', () => {
    c.register('svc', () => ({ id: Math.random() }), 'scoped');
    const s1 = c.createScope();
    const s2 = c.createScope();
    const a = c.get<{ id: number }>('svc', s1);
    const b = c.get<{ id: number }>('svc', s2);
    expect(a).not.toBe(b);
  });
});

describe('DIContainer – set / has / get', () => {
  it('set registers a pre-built instance', () => {
    const mock = { value: 42 };
    c.set('mock', mock);
    expect(c.get('mock')).toBe(mock);
  });

  it('has returns true for registered token', () => {
    c.register('x', () => 1);
    expect(c.has('x')).toBe(true);
  });

  it('has returns false for unknown token', () => {
    expect(c.has('unknown')).toBe(false);
  });

  it('throws on unregistered token', () => {
    expect(() => c.get('missing')).toThrow('[DI] Token not registered: "missing"');
  });
});

describe('DIContainer – mock injection', () => {
  it('allows overriding a service with a mock', () => {
    c.register('RealService', () => ({ greet: () => 'real' }), 'singleton');
    // Override with mock
    c.set('RealService', { greet: () => 'mock' });
    const svc = c.get<{ greet(): string }>('RealService');
    expect(svc.greet()).toBe('mock');
  });
});

describe('DIContainer – dependency graph', () => {
  it('resolves transitive dependencies', () => {
    c.register('dep', () => ({ value: 10 }), 'singleton');
    c.register('svc', (c) => ({ doubled: c.get<{ value: number }>('dep').value * 2 }), 'singleton');
    expect(c.get<{ doubled: number }>('svc').doubled).toBe(20);
  });
});

describe('DIContainer – validate', () => {
  it('returns registered tokens on success', () => {
    c.register('a', () => 1);
    c.register('b', () => 2);
    const tokens = c.validate();
    expect(tokens).toContain('a');
    expect(tokens).toContain('b');
  });

  it('throws on factory that errors', () => {
    c.register('bad', () => { throw new Error('init fail'); }, 'transient');
    expect(() => c.validate()).toThrow('init fail');
  });
});

describe('DIContainer – reset', () => {
  it('clears singleton cache so next get re-creates instance', () => {
    let calls = 0;
    c.register('counter', () => ({ n: ++calls }), 'singleton');
    const a = c.get<{ n: number }>('counter');
    c.reset();
    const b = c.get<{ n: number }>('counter');
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
  });
});

describe('DIContainer – performance', () => {
  it('resolves singleton in under 1ms', () => {
    c.register('fast', () => ({}), 'singleton');
    c.get('fast'); // warm up
    const start = performance.now();
    c.get('fast');
    expect(performance.now() - start).toBeLessThan(1);
  });
});
