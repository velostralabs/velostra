/**
 * Auth crypto E2E test — proves the nonce -> sign -> verify flow works with
 * real EVM keypairs, replay protection holds, and spoofed signatures fail.
 * No database or network needed.
 *
 * Run: npx tsx test/auth.e2e.test.ts
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { generateAuthNonce, verifyWalletSignature } from '../src/lib/auth.js'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAILED: ' + msg)
  console.log('✅', msg)
}

async function main() {
  const account = privateKeyToAccount(generatePrivateKey())
  console.log('Test wallet:', account.address)

  const { message } = generateAuthNonce(account.address)
  const signature = await account.signMessage({ message })
  assert(await verifyWalletSignature(account.address, signature), 'valid signature from the correct wallet verifies')
  assert((await verifyWalletSignature(account.address, signature)) === false, 'signature cannot be replayed (nonce is single-use)')

  const { message: msg2 } = generateAuthNonce(account.address)
  const attacker = privateKeyToAccount(generatePrivateKey())
  const attackerSig = await attacker.signMessage({ message: msg2 })
  assert((await verifyWalletSignature(account.address, attackerSig)) === false, "attacker's signature does not verify against the victim's address")

  const randomAccount = privateKeyToAccount(generatePrivateKey())
  const bogusSig = await randomAccount.signMessage({ message: 'not a real challenge' })
  assert((await verifyWalletSignature(randomAccount.address, bogusSig)) === false, 'verifying with no prior nonce fails closed')

  console.log('\n🎉 AUTH CRYPTO FLOW VERIFIED\n')
}

main().catch((e) => {
  console.error('💥', e)
  process.exit(1)
})
