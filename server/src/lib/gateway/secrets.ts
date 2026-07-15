import crypto from 'node:crypto'
import { AppError } from '../errors.js'

const FORMAT_VERSION = 'v1'

export class AgentSecretError extends AppError {
  constructor(code: string, message: string, cause?: unknown) {
    super(500, code, message, { expose: false, cause })
    this.name = 'AgentSecretError'
  }
}

function decodeKey(raw: string, name: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error(`${name} must encode exactly 32 bytes`)
  return key
}

function currentKeyId(): string {
  const id = process.env.AGENT_SECRET_ENCRYPTION_KEY_ID ?? 'primary'
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    throw new Error('AGENT_SECRET_ENCRYPTION_KEY_ID contains invalid characters')
  }
  return id
}

function keyring(): Map<string, Buffer> {
  const current = process.env.AGENT_SECRET_ENCRYPTION_KEY
  if (!current) throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required')

  const keys = new Map<string, Buffer>([
    [currentKeyId(), decodeKey(current, 'AGENT_SECRET_ENCRYPTION_KEY')],
  ])
  const previous = process.env.AGENT_SECRET_DECRYPTION_KEYS
  if (!previous) return keys

  let parsed: unknown
  try {
    parsed = JSON.parse(previous)
  } catch (error) {
    throw new Error('AGENT_SECRET_DECRYPTION_KEYS must be a JSON object', { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AGENT_SECRET_DECRYPTION_KEYS must be a JSON object')
  }
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof value !== 'string') {
      throw new Error('AGENT_SECRET_DECRYPTION_KEYS contains an invalid key entry')
    }
    keys.set(id, decodeKey(value, `AGENT_SECRET_DECRYPTION_KEYS.${id}`))
  }
  return keys
}

export function generateAgentSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function isEncryptedAgentSecret(value: string): boolean {
  return value.startsWith(`${FORMAT_VERSION}.`)
}

export function encryptAgentSecret(plaintext: string): string {
  if (plaintext.length < 32) throw new Error('Agent HMAC secret must contain at least 32 characters')
  const id = currentKeyId()
  const key = keyring().get(id)
  if (!key) throw new Error('Current agent-secret key is not available')

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    FORMAT_VERSION,
    id,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptAgentSecret(envelope: string): string {
  const [version, id, encodedIv, encodedTag, encodedCiphertext, ...extra] = envelope.split('.')
  if (
    version !== FORMAT_VERSION ||
    !id ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra.length > 0
  ) {
    throw new AgentSecretError(
      'AGENT_SECRET_MIGRATION_REQUIRED',
      'Agent secret is not stored in the supported encrypted format'
    )
  }

  const key = keyring().get(id)
  if (!key) {
    throw new AgentSecretError('AGENT_SECRET_KEY_UNAVAILABLE', 'Agent secret encryption key is unavailable')
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(encodedIv, 'base64url')
    )
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    throw new AgentSecretError('AGENT_SECRET_DECRYPT_FAILED', 'Agent secret could not be decrypted', error)
  }
}

export function omitAgentSecret<T extends { secret_key_ciphertext: string }>(
  agent: T
): Omit<T, 'secret_key_ciphertext'> {
  const { secret_key_ciphertext: _secret, ...safe } = agent
  return safe
}