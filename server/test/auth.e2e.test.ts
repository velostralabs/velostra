/**
 * Auth crypto and multi-instance nonce proof. No database or real Redis needed:
 * two service instances share one store with the same atomic consume contract.
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import {
  AuthNonceService,
  MemoryAuthNonceStore,
  generateAuthNonce,
  setAuthNonceServiceForTests,
  verifyWalletSignature,
} from '../src/lib/auth.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('FAILED: ' + message)
  console.log('✅', message)
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test'
  process.env.WEB_ORIGIN = 'https://app.velostra.test'
  process.env.AUTH_PUBLIC_URI = 'https://app.velostra.test'
  process.env.AUTH_NONCE_STORE = 'memory'
  process.env.ROBINHOOD_CHAIN_ID = '46630'

  const sharedStore = new MemoryAuthNonceStore()
  const instanceA = new AuthNonceService(sharedStore)
  const instanceB = new AuthNonceService(sharedStore)
  setAuthNonceServiceForTests(instanceA)

  const account = privateKeyToAccount(generatePrivateKey())
  console.log('Test wallet:', account.address)

  const { message } = await generateAuthNonce(account.address)
  assert(message.startsWith('app.velostra.test wants you to sign in'), 'challenge is bound to the configured public domain')
  assert(message.includes('URI: https://app.velostra.test'), 'challenge is bound to the configured URI')
  assert(message.includes('Chain ID: 46630'), 'challenge is bound to the configured staging chain')
  assert(message.includes('Expiration Time:'), 'challenge carries an explicit expiry')

  process.env.ROBINHOOD_CHAIN_ID = 'not-a-chain'
  let invalidChainRejected = false
  try {
    await instanceA.generate(account.address)
  } catch (error) {
    invalidChainRejected = error instanceof Error && error.message.includes('positive integer')
  }
  assert(invalidChainRejected, 'invalid runtime chain configuration fails closed')
  process.env.ROBINHOOD_CHAIN_ID = '46630'

  const signature = await account.signMessage({ message })
  assert(await instanceB.verify(account.address, signature), 'a second API instance verifies the shared challenge')
  assert(!(await verifyWalletSignature(account.address, signature)), 'signature cannot replay on the issuing instance')

  const { message: attackerMessage } = await instanceA.generate(account.address)
  const attacker = privateKeyToAccount(generatePrivateKey())
  const attackerSignature = await attacker.signMessage({ message: attackerMessage })
  assert(!(await instanceB.verify(account.address, attackerSignature)), 'attacker signature cannot consume the victim challenge')
  const victimSignature = await account.signMessage({ message: attackerMessage })
  assert(await instanceB.verify(account.address, victimSignature), 'invalid attempts do not consume a valid challenge')

  const randomAccount = privateKeyToAccount(generatePrivateKey())
  const bogusSignature = await randomAccount.signMessage({ message: 'not a real challenge' })
  assert(!(await instanceA.verify(randomAccount.address, bogusSignature)), 'verification with no stored challenge fails closed')

  const { message: concurrentMessage } = await instanceA.generate(account.address)
  const concurrentSignature = await account.signMessage({ message: concurrentMessage })
  const concurrentResults = await Promise.all([
    instanceA.verify(account.address, concurrentSignature),
    instanceB.verify(account.address, concurrentSignature),
  ])
  assert(concurrentResults.filter(Boolean).length === 1, 'concurrent multi-instance verification has exactly one winner')

  const { message: supersededMessage } = await instanceA.generate(account.address)
  const supersededSignature = await account.signMessage({ message: supersededMessage })
  const { message: replacementMessage } = await instanceB.generate(account.address)
  const replacementSignature = await account.signMessage({ message: replacementMessage })
  assert(!(await instanceA.verify(account.address, supersededSignature)), 'issuing a new challenge invalidates the previous challenge')
  assert(await instanceA.verify(account.address, replacementSignature), 'replacement challenge remains valid across instances')

  console.log('\n🎉 AUTH CRYPTO AND ATOMIC MULTI-INSTANCE NONCE FLOW VERIFIED\n')
}

main().catch((error) => {
  console.error('💥', error)
  process.exit(1)
})