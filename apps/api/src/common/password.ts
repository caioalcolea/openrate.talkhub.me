import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Auth PRÓPRIA do OpenRate (o gotrue compartilhado tem email login desabilitado).
// Hash de senha com scrypt NATIVO do Node — sem dependência externa e sem build
// nativo (roda igual no Alpine). Formato: scrypt$<saltHex>$<hashHex>.
const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scryptAsync(plain, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const dk = (await scryptAsync(plain, Buffer.from(saltHex, 'hex'), expected.length || KEYLEN)) as Buffer;
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}
