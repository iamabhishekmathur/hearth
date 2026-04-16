import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  env: {
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
}));

import { encrypt, decrypt } from './token-store.js';

describe('token-store encryption', () => {
  it('encrypt then decrypt returns original string', () => {
    const plaintext = 'my-secret-token';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('different plaintexts produce different ciphertexts', () => {
    const c1 = encrypt('alpha');
    const c2 = encrypt('beta');
    expect(c1).not.toBe(c2);
  });

  it('encrypting same plaintext twice produces different ciphertexts (random IV)', () => {
    const c1 = encrypt('same-value');
    const c2 = encrypt('same-value');
    expect(c1).not.toBe(c2);
    // Both should still decrypt to the same value
    expect(decrypt(c1)).toBe('same-value');
    expect(decrypt(c2)).toBe('same-value');
  });

  it('decrypt with corrupted ciphertext fails', () => {
    const ciphertext = encrypt('test-data');
    // Corrupt the ciphertext by flipping characters in the middle
    const corrupted =
      ciphertext.slice(0, 30) +
      (ciphertext[30] === 'a' ? 'b' : 'a') +
      ciphertext.slice(31);
    expect(() => decrypt(corrupted)).toThrow();
  });

  it('handles empty string encrypt/decrypt', () => {
    const ciphertext = encrypt('');
    expect(decrypt(ciphertext)).toBe('');
  });

  it('handles unicode string encrypt/decrypt', () => {
    const unicode = '你好世界 🌍 café';
    const ciphertext = encrypt(unicode);
    expect(decrypt(ciphertext)).toBe(unicode);
  });
});
