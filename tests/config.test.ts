import { describe, expect, it } from 'vitest';
import { listenHost } from '../server/config';

describe('server listen address', () => {
  it('keeps native runs bound to loopback by default', () => {
    expect(listenHost({})).toBe('127.0.0.1');
  });
  it('allows an explicit container listen address', () => {
    expect(listenHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });
});
