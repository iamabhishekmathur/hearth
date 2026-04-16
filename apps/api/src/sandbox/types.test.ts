import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, SANDBOX_IMAGES } from './types.js';

describe('DEFAULT_CONFIG', () => {
  it('has correct memory limit', () => {
    expect(DEFAULT_CONFIG.memoryLimit).toBe('512m');
  });

  it('has correct timeout', () => {
    expect(DEFAULT_CONFIG.timeoutMs).toBe(60000);
  });

  it('has correct CPU limit', () => {
    expect(DEFAULT_CONFIG.cpuLimit).toBe(1.0);
  });

  it('has network set to none', () => {
    expect(DEFAULT_CONFIG.network).toBe('none');
  });

  it('has the default sandbox image', () => {
    expect(DEFAULT_CONFIG.image).toBe('hearth-sandbox:python');
  });
});

describe('SANDBOX_IMAGES', () => {
  it('has correct python image', () => {
    expect(SANDBOX_IMAGES.python).toBe('python:3.12-slim');
  });

  it('has correct node image', () => {
    expect(SANDBOX_IMAGES.node).toBe('node:22-alpine');
  });
});
