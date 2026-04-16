import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a hex-encoded string: iv + authTag + ciphertext.
 */
export function encrypt(data: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Concatenate iv + authTag + ciphertext, encode as hex
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

/**
 * Decrypts a hex-encoded AES-256-GCM ciphertext string.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'hex');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
