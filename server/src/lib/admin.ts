import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { adminRoleAssignments, adminRoleEnum } from '../db/schema.js'

export type AdminRole = (typeof adminRoleEnum.enumValues)[number]
export type AdminPermission =
  | 'agent:read'
  | 'agent:decide'
  | 'report:read'
  | 'report:resolve'
  | 'stats:read'
  | 'rbac:manage'
  | 'audit:read'
  | 'webhook:operate'
  | 'privacy:operate'
  | 'telemetry:manage'

const permissions: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: [
    'agent:read',
    'agent:decide',
    'report:read',
    'report:resolve',
    'stats:read',
    'rbac:manage',
    'audit:read',
    'webhook:operate',
    'privacy:operate',
    'telemetry:manage',
  ],
  AGENT_REVIEWER: ['agent:read', 'agent:decide'],
  REPORT_MODERATOR: ['report:read', 'report:resolve'],
  FINANCE_VIEWER: ['stats:read'],
  AUDITOR: ['agent:read', 'report:read', 'stats:read', 'audit:read'],
}

export async function activeAdminRoles(userId: string): Promise<AdminRole[]> {
  const rows = await db
    .select({ role: adminRoleAssignments.role })
    .from(adminRoleAssignments)
    .where(
      and(
        eq(adminRoleAssignments.user_id, userId),
        isNull(adminRoleAssignments.revoked_at)
      )
    )
  return rows.map((row) => row.role)
}

export function rolesAllow(roles: readonly AdminRole[], permission: AdminPermission): boolean {
  return roles.some((role) => permissions[role].includes(permission))
}

function bootstrapWallets(): Set<string> {
  const configured = [
    ...(process.env.ADMIN_BOOTSTRAP_WALLETS ?? '').split(','),
    process.env.ADMIN_WALLET ?? '',
  ]
    .map((wallet) => wallet.trim().toLowerCase())
    .filter(Boolean)
  return new Set(configured)
}

export async function bootstrapAdminRole(userId: string, walletAddress: string): Promise<void> {
  if (!bootstrapWallets().has(walletAddress.toLowerCase())) return
  await db
    .insert(adminRoleAssignments)
    .values({ user_id: userId, role: 'SUPER_ADMIN' })
    .onConflictDoNothing({
      target: [adminRoleAssignments.user_id, adminRoleAssignments.role],
    })
}