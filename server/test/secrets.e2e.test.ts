import {
  AgentSecretError,
  agentSecretNeedsReencryption,
  decryptAgentSecret,
  encryptAgentSecret,
  generateAgentSecret,
  isEncryptedAgentSecret,
  omitAgentSecret,
} from '../src/lib/gateway/secrets.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('FAILED: ' + message)
  console.log('✅', message)
}

function assertThrows(action: () => unknown, code: string, message: string): void {
  try {
    action()
  } catch (error) {
    assert(error instanceof AgentSecretError, `${message} returns a typed secret error`)
    assert(error.code === code, `${message} returns ${code}`)
    return
  }
  throw new Error('FAILED: ' + message + ' did not throw')
}

async function main(): Promise<void> {
  process.env.AGENT_SECRET_ENCRYPTION_KEY_ID = 'primary'
  process.env.AGENT_SECRET_ENCRYPTION_KEY = '11'.repeat(32)
  delete process.env.AGENT_SECRET_DECRYPTION_KEYS

  const plaintext = generateAgentSecret()
  assert(plaintext.length >= 32, 'generated HMAC secret has at least 256 bits of source entropy')
  const encrypted = encryptAgentSecret(plaintext)
  assert(isEncryptedAgentSecret(encrypted), 'secret is stored in a versioned envelope')
  assert(!encrypted.includes(plaintext), 'ciphertext does not contain plaintext')
  assert(decryptAgentSecret(encrypted) === plaintext, 'AES-256-GCM envelope decrypts exactly')

  const parts = encrypted.split('.')
  const ciphertext = parts[4]
  parts[4] = (ciphertext.startsWith('A') ? 'B' : 'A') + ciphertext.slice(1)
  assertThrows(
    () => decryptAgentSecret(parts.join('.')),
    'AGENT_SECRET_DECRYPT_FAILED',
    'tampered ciphertext'
  )

  process.env.AGENT_SECRET_ENCRYPTION_KEY_ID = 'old'
  process.env.AGENT_SECRET_ENCRYPTION_KEY = '22'.repeat(32)
  const oldEnvelope = encryptAgentSecret('old-secret-material-that-is-long-enough')
  process.env.AGENT_SECRET_ENCRYPTION_KEY_ID = 'primary'
  process.env.AGENT_SECRET_ENCRYPTION_KEY = '33'.repeat(32)
  process.env.AGENT_SECRET_DECRYPTION_KEYS = JSON.stringify({ old: '22'.repeat(32) })
  const oldPlaintext = decryptAgentSecret(oldEnvelope)
  assert(
    oldPlaintext === 'old-secret-material-that-is-long-enough',
    'previous master key remains available during rotation'
  )
  assert(agentSecretNeedsReencryption(oldEnvelope), 'historical envelope is selected for re-encryption')
  const rotatedEnvelope = encryptAgentSecret(oldPlaintext)
  assert(!agentSecretNeedsReencryption(rotatedEnvelope), 're-encryption moves the envelope to the active key id')
  assert(decryptAgentSecret(rotatedEnvelope) === oldPlaintext, 're-encryption preserves the exact secret')

  process.env.AGENT_SECRET_DECRYPTION_KEYS = JSON.stringify({ primary: '44'.repeat(32) })
  let duplicateRejected = false
  try {
    encryptAgentSecret('duplicate-key-id-must-never-shadow-current-key')
  } catch (error) {
    duplicateRejected =
      error instanceof Error &&
      error.message.includes('cannot redefine the active key id')
  }
  assert(duplicateRejected, 'historical keyring cannot shadow the active encryption key')

  delete process.env.AGENT_SECRET_DECRYPTION_KEYS
  assertThrows(
    () => decryptAgentSecret(oldEnvelope),
    'AGENT_SECRET_KEY_UNAVAILABLE',
    'missing historical master key'
  )

  const safe = omitAgentSecret({ id: 'agent-1', secret_key_ciphertext: encrypted, name: 'Safe Agent' })
  assert(!('secret_key_ciphertext' in safe), 'API serializer removes ciphertext')
  assert(safe.name === 'Safe Agent', 'API serializer preserves public agent fields')

  console.log('\n🎉 AGENT SECRET ENCRYPTION AND ROTATION VERIFIED\n')
}

main().catch((error) => {
  console.error('💥', error)
  process.exit(1)
})