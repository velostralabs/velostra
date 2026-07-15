import { z } from 'zod'

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => !/^0x0{40}$/i.test(value), 'principal must be non-zero')

const requiredRoles = [
  'DEFAULT_ADMIN',
  'PAUSER',
  'FEE_MANAGER',
  'SETTLER',
  'TREASURY',
] as const

const authorityPolicySchema = z.object({
  policy_version: z.literal(1),
  environment: z.literal('staging'),
  change_ticket: z.string().min(3).max(128),
  roles: z
    .array(
      z.object({
        role: z.enum(requiredRoles),
        principal_type: z.enum(['multisig', 'restricted-signer']),
        principal: address,
        owner: z.string().min(3).max(128),
        approval_threshold: z.number().int().min(1),
        escalation: z.string().min(3).max(256),
      })
    )
    .length(requiredRoles.length),
})

export type AuthorityPolicy = z.infer<typeof authorityPolicySchema>

export function validateAuthorityPolicy(input: unknown): AuthorityPolicy {
  const policy = authorityPolicySchema.parse(input)
  const roles = new Set(policy.roles.map((entry) => entry.role))
  if (roles.size !== requiredRoles.length || requiredRoles.some((role) => !roles.has(role))) {
    throw new Error('Authority policy must contain every required role exactly once')
  }
  for (const entry of policy.roles) {
    if (entry.role === 'SETTLER' && entry.principal_type !== 'restricted-signer') {
      throw new Error('SETTLER must use a restricted-signer principal')
    }
    if (entry.role !== 'SETTLER' && entry.principal_type !== 'multisig') {
      throw new Error(entry.role + ' must use a multisig principal')
    }
    if (entry.principal_type === 'multisig' && entry.approval_threshold < 2) {
      throw new Error(entry.role + ' multisig approval_threshold must be at least 2')
    }
  }
  return policy
}
