import 'dotenv/config'
import { db, pool } from '../src/db/client.js'
import { agents } from '../src/db/schema.js'
import {
  agentSecretNeedsReencryption,
  decryptAgentSecret,
  encryptAgentSecret,
  isEncryptedAgentSecret,
} from '../src/lib/gateway/secrets.js'
import { eq } from 'drizzle-orm'

async function main(): Promise<void> {
  const rows = await db
    .select({ id: agents.id, secret: agents.secret_key_ciphertext })
    .from(agents)
  let migrated = 0
  let verified = 0

  for (const row of rows) {
    const plaintext = isEncryptedAgentSecret(row.secret)
      ? decryptAgentSecret(row.secret)
      : row.secret
    if (!agentSecretNeedsReencryption(row.secret)) {
      verified += 1
      continue
    }

    const encrypted = encryptAgentSecret(plaintext)
    await db
      .update(agents)
      .set({
        secret_key_ciphertext: encrypted,
        updated_at: new Date(),
      })
      .where(eq(agents.id, row.id))
    migrated += 1
  }

  console.info('[secrets] migration complete', { migrated, verified, total: rows.length })
}

main()
  .catch((error) => {
    console.error('[secrets] migration failed', error)
    process.exitCode = 1
  })
  .finally(() => pool.end())