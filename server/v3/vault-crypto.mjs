import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { canonicalPortable } from '../../shared/v3-portable.mjs'

export const VAULT_ITERATIONS = 600_000
export const VAULT_LIMIT = 3_000_000
const derive = promisify(pbkdf2)
export function vaultError(code, status = 400) {
  const e = new Error(code)
  e.code = code
  e.status = status
  throw e
}
export function b64(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) vaultError('invalid_ciphertext')
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length))
    vaultError('invalid_ciphertext')
  return bytes
}
export async function deriveVaultKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 256)
    vaultError('vault_passphrase_length')
  return derive(passphrase, b64(salt, 16), VAULT_ITERATIONS, 32, 'sha256')
}
export const newSalt = () => randomBytes(16).toString('base64url')
export function sealVault(value, key, binding) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(canonicalPortable(binding)))
  const raw = Buffer.from(JSON.stringify(value))
  if (raw.length > 2_200_000) vaultError('vault_too_large', 413)
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()])
  raw.fill(0)
  return {
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  }
}
export function openVault(sealed, key, binding) {
  if (
    !sealed ||
    Object.keys(sealed).sort().join(',') !== 'ciphertext,nonce,tag' ||
    JSON.stringify(sealed).length > VAULT_LIMIT
  )
    vaultError('invalid_ciphertext')
  const nonce = b64(sealed.nonce, 12),
    tag = b64(sealed.tag, 16),
    bytes = b64(sealed.ciphertext)
  if (bytes.length > 2_200_000) vaultError('vault_too_large', 413)
  let raw
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(Buffer.from(canonicalPortable(binding)))
    decipher.setAuthTag(tag)
    raw = Buffer.concat([decipher.update(bytes), decipher.final()])
    return JSON.parse(raw.toString('utf8'))
  } catch {
    vaultError('vault_authentication_failed', 403)
  } finally {
    raw?.fill(0)
  }
}
