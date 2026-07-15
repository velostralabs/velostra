import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { adminRoleAssignments, agents } from '../db/schema.js'

export async function assertSecurityReadiness(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return

  const [[plaintext], [superAdmins]] = await Promise.all([
    db
      .select({ value: count() })
      .from(agents)
      .where(sql`${agents.secret_key_ciphertext} not like 'v1.%'`),
    db
      .select({ value: count() })
      .from(adminRoleAssignments)
      .where(
        and(
          eq(adminRoleAssignments.role, 'SUPER_ADMIN'),
          isNull(adminRoleAssignments.revoked_at)
        )
      ),
  ])

  if ((plaintext?.value ?? 0) > 0) {
    throw new Error('Production startup blocked: plaintext agent secrets require secrets:reencrypt')
  }
  if (
    (superAdmins?.value ?? 0) === 0 &&
    !(process.env.ADMIN_BOOTSTRAP_WALLETS ?? '').trim()
  ) {
    throw new Error('Production startup blocked: configure a bootstrap wallet or active SUPER_ADMIN')
  }
}