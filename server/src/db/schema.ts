import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  doublePrecision,
  numeric,
  integer,
  bigint,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

// ─────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────

export const builderStatusEnum = pgEnum('builder_status', ['ACTIVE', 'SUSPENDED', 'BANNED'])
export const claimStatusEnum = pgEnum('claim_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
export const agentCategoryEnum = pgEnum('agent_category', [
  'CRYPTO_DEFI',
  'WALLET_ANALYSIS',
  'TOKEN_RESEARCH',
  'TRADING',
  'WRITING',
  'RESEARCH',
  'PRODUCTIVITY',
  'DATA_ANALYSIS',
  'CODE',
  'OTHER',
])
export const agentStatusEnum = pgEnum('agent_status', ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REMOVED'])
export const priceTierEnum = pgEnum('price_tier', ['BASIC', 'STANDARD', 'PRO', 'PREMIUM'])
export const callStatusEnum = pgEnum('call_status', ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT'])
export const transactionTypeEnum = pgEnum('transaction_type', [
  'TOPUP',
  'AGENT_CALL',
  'BUILDER_CLAIM',
  'REFUND',
  'PLATFORM_WITHDRAWAL',
])
export const txStatusEnum = pgEnum('tx_status', ['PENDING', 'CONFIRMED', 'FAILED'])
export const settlementStatusEnum = pgEnum('settlement_status', [
  'PREPARED',
  'READY',
  'SUBMITTED',
  'AMBIGUOUS',
  'CONFIRMED',
  'APPLIED',
  'FAILED',
])
export const reportReasonEnum = pgEnum('report_reason', [
  'HARMFUL_CONTENT',
  'MISLEADING',
  'NOT_WORKING',
  'SPAM',
  'INAPPROPRIATE',
  'OTHER',
])
export const reportStatusEnum = pgEnum('report_status', ['PENDING', 'REVIEWED', 'WARNING_SENT', 'SUSPENDED', 'REMOVED'])
export const chainEventTypeEnum = pgEnum('chain_event_type', [
  'DEPOSIT',
  'EARNINGS_CREDITED',
  'CLAIMED',
  'PLATFORM_REVENUE_WITHDRAWN',
])
export const adminRoleEnum = pgEnum('admin_role', [
  'SUPER_ADMIN',
  'AGENT_REVIEWER',
  'REPORT_MODERATOR',
  'FINANCE_VIEWER',
  'AUDITOR',
])

export const agentRevisionStatusEnum = pgEnum('agent_revision_status', [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
])
export const idempotencyStatusEnum = pgEnum('idempotency_status', [
  'PROCESSING',
  'COMPLETED',
  'FAILED',
])
export const webhookSubscriptionStatusEnum = pgEnum('webhook_subscription_status', [
  'ACTIVE',
  'PAUSED',
  'REVOKED',
])
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'PENDING',
  'RETRYING',
  'DELIVERED',
  'DEAD_LETTER',
  'CANCELLED',
])
export const privacyRequestTypeEnum = pgEnum('privacy_request_type', ['EXPORT', 'DELETE'])
export const privacyRequestStatusEnum = pgEnum('privacy_request_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
])
export const telemetryClassificationEnum = pgEnum('telemetry_classification', [
  'PUBLIC',
  'OPERATIONAL',
  'SENSITIVE',
  'FINANCIAL',
  'PROHIBITED',
])
const id = () => text('id').primaryKey().$defaultFn(() => createId())

// ─────────────────────────────────────────
// USER
// ─────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  wallet_address: text('wallet_address').notNull().unique(), // EVM address (0x…), checksummed
  display_name: text('display_name'),
  avatar_url: text('avatar_url'),
  email: text('email').unique(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
})

export const apiIdempotencyRecords = pgTable(
  'api_idempotency_records',
  {
    id: id(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    request_hash: text('request_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull().default('PROCESSING'),
    response_status: integer('response_status'),
    response_body: jsonb('response_body'),
    locked_until: timestamp('locked_until', { withTimezone: true }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_idempotency_actor_operation_key_unique').on(
      table.user_id,
      table.operation,
      table.idempotency_key
    ),
    index('api_idempotency_expiry_idx').on(table.expires_at),
    check('api_idempotency_key_length_check', sql.raw("length(idempotency_key) between 8 and 128")),
    check('api_idempotency_request_hash_check', sql.raw("request_hash ~ '^[0-9a-f]{64}$'")),
  ]
)
export const adminRoleAssignments = pgTable(
  'admin_role_assignments',
  {
    id: id(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: adminRoleEnum('role').notNull(),
    granted_by: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    granted_at: timestamp('granted_at').notNull().defaultNow(),
    revoked_at: timestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('admin_role_user_role_unique').on(table.user_id, table.role),
    index('admin_role_active_user_idx').on(table.user_id, table.revoked_at),
  ]
)

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: id(),
    actor_user_id: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target_type: text('target_type').notNull(),
    target_id: text('target_id'),
    request_id: text('request_id').notNull(),
    ip_address: text('ip_address'),
    metadata: jsonb('metadata').notNull().default({}),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_actor_time_idx').on(table.actor_user_id, table.created_at),
    index('admin_audit_action_time_idx').on(table.action, table.created_at),
  ]
)

// ─────────────────────────────────────────
// CREDIT BALANCE
// ─────────────────────────────────────────

export const creditBalances = pgTable(
  'credit_balances',
  {
    id: id(),
    user_id: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance_usd: numeric('balance_usd', { precision: 20, scale: 6 })
      .notNull()
      .default('0.000000'),
    reserved_usd: numeric('reserved_usd', { precision: 20, scale: 6 })
      .notNull()
      .default('0.000000'),
    free_tier_used: integer('free_tier_used').notNull().default(0),
    free_tier_reset_date: timestamp('free_tier_reset_date').notNull().defaultNow(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (_table) => [
    check('credit_balance_nonnegative', sql.raw('balance_usd >= 0')),
    check('credit_reservation_nonnegative', sql.raw('reserved_usd >= 0')),
    check('credit_reservation_within_balance', sql.raw('reserved_usd <= balance_usd')),
  ]
)

// ─────────────────────────────────────────
// BUILDER
// ─────────────────────────────────────────

export const builders = pgTable('builders', {
  id: id(),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  wallet_address: text('wallet_address').notNull().unique(),
  display_name: text('display_name').notNull(),
  bio: text('bio'),
  website_url: text('website_url'),
  twitter_url: text('twitter_url'),
  github_url: text('github_url'),
  verified: boolean('verified').notNull().default(false),
  status: builderStatusEnum('status').notNull().default('ACTIVE'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
},
  (table) => [
    index('builder_status_created_idx').on(table.status, table.created_at),
  ]
)

// ─────────────────────────────────────────
// BUILDER EARNINGS
// ─────────────────────────────────────────

export const builderEarnings = pgTable(
  'builder_earnings',
  {
    id: id(),
    builder_id: text('builder_id')
      .notNull()
      .unique()
      .references(() => builders.id, { onDelete: 'cascade' }),
    total_earned: numeric('total_earned', { precision: 20, scale: 6 })
      .notNull()
      .default('0.000000'),
    available: numeric('available', { precision: 20, scale: 6 })
      .notNull()
      .default('0.000000'),
    total_claimed: numeric('total_claimed', { precision: 20, scale: 6 })
      .notNull()
      .default('0.000000'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (_table) => [
    check('builder_earnings_total_nonnegative', sql.raw('total_earned >= 0')),
    check('builder_earnings_available_nonnegative', sql.raw('available >= 0')),
    check('builder_earnings_claimed_nonnegative', sql.raw('total_claimed >= 0')),
  ]
)
// ─────────────────────────────────────────
// EARNINGS CLAIM
// ─────────────────────────────────────────

export const earningsClaims = pgTable('earnings_claims', {
  id: id(),
  builder_id: text('builder_id')
    .notNull()
    .references(() => builders.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
  status: claimStatusEnum('status').notNull().default('PENDING'),
  tx_hash: text('tx_hash').unique(), // Robinhood Chain (EVM) transaction hash; unique prevents replay
  wallet_address: text('wallet_address').notNull(),
  chain_id: integer('chain_id'),
  contract_address: text('contract_address'),
  block_number: bigint('block_number', { mode: 'bigint' }),
  log_index: integer('log_index'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
},
  (table) => [
    index('earnings_claim_builder_created_idx').on(table.builder_id, table.created_at),
    index('earnings_claim_status_created_idx').on(table.status, table.created_at),
    check('earnings_claim_amount_positive', sql.raw('amount > 0')),
  ]
)

// ─────────────────────────────────────────
// AGENT
// ─────────────────────────────────────────

export const agents = pgTable('agents', {
  id: id(),
  builder_id: text('builder_id')
    .notNull()
    .references(() => builders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull(),
  long_description: text('long_description'),
  category: agentCategoryEnum('category').notNull(),
  endpoint_url: text('endpoint_url').notNull(),
  secret_key_ciphertext: text('secret_key').notNull(),
  secret_version: integer('secret_version').notNull().default(1),
  secret_rotated_at: timestamp('secret_rotated_at').notNull().defaultNow(),
  secret_revoked_at: timestamp('secret_revoked_at'),
  price_per_call: numeric('price_per_call', { precision: 20, scale: 6 }).notNull(),
  price_tier: priceTierEnum('price_tier').notNull().default('BASIC'),
  logo_url: text('logo_url'),
  status: agentStatusEnum('status').notNull().default('PENDING'),
  featured: boolean('featured').notNull().default(false),
  total_calls: integer('total_calls').notNull().default(0),
  total_revenue: numeric('total_revenue', { precision: 20, scale: 6 })
    .notNull()
    .default('0.000000'),
  avg_rating: doublePrecision('avg_rating'),
  review_count: integer('review_count').notNull().default(0),
  active_revision_id: text('active_revision_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
},
  (table) => [
    index('agent_marketplace_idx').on(table.status, table.featured, table.created_at),
    index('agent_builder_created_idx').on(table.builder_id, table.created_at),
    index('agent_status_category_idx').on(table.status, table.category),
  ]
)

export const agentTags = pgTable(
  'agent_tags',
  {
    id: id(),
    agent_id: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [uniqueIndex('agent_tag_unique').on(t.agent_id, t.tag)]
)

// ─────────────────────────────────────────
// AGENT CALL
// ─────────────────────────────────────────

export const agentRevisions = pgTable(
  'agent_revisions',
  {
    id: id(),
    agent_id: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    revision_number: integer('revision_number').notNull(),
    status: agentRevisionStatusEnum('status').notNull().default('DRAFT'),
    name: text('name').notNull(),
    description: text('description').notNull(),
    long_description: text('long_description'),
    category: agentCategoryEnum('category').notNull(),
    endpoint_url: text('endpoint_url').notNull(),
    price_per_call: numeric('price_per_call', { precision: 20, scale: 6 }).notNull(),
    price_tier: priceTierEnum('price_tier').notNull(),
    logo_url: text('logo_url'),
    change_summary: text('change_summary'),
    created_by_user_id: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    published_at: timestamp('published_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_revision_number_unique').on(table.agent_id, table.revision_number),
    index('agent_revision_status_created_idx').on(table.agent_id, table.status, table.created_at),
    check('agent_revision_number_positive', sql.raw('revision_number > 0')),
    check('agent_revision_price_positive', sql.raw('price_per_call > 0')),
  ]
)
export const agentCalls = pgTable('agent_calls', {
  id: id(),
  agent_id: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  agent_revision_id: text('agent_revision_id'),
  input: text('input').notNull(),
  output: jsonb('output'),
  status: callStatusEnum('status').notNull().default('PENDING'),
  is_free_tier: boolean('is_free_tier').notNull().default(false),
  onchain_call_id: text('onchain_call_id').unique(),
  price_charged: numeric('price_charged', { precision: 20, scale: 6 })
    .notNull()
    .default('0.000000'),
  builder_earned: numeric('builder_earned', { precision: 20, scale: 6 })
    .notNull()
    .default('0.000000'),
  platform_earned: numeric('platform_earned', { precision: 20, scale: 6 })
    .notNull()
    .default('0.000000'),
  execution_ms: integer('execution_ms'),
  tokens_used: integer('tokens_used'),
  error_message: text('error_message'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
},
  (table) => [
    index('agent_call_user_created_idx').on(table.user_id, table.created_at),
    index('agent_call_agent_created_idx').on(table.agent_id, table.created_at),
    index('agent_call_status_created_idx').on(table.status, table.created_at),
  ]
)

// ─────────────────────────────────────────
// TRANSACTION
// ─────────────────────────────────────────

export const releaseCanaryAdmissions = pgTable(
  'release_canary_admissions',
  {
    agent_call_id: text('agent_call_id')
      .primaryKey()
      .references(() => agentCalls.id, { onDelete: 'cascade' }),
    release: text('release').notNull(),
    manifest_sha256: text('manifest_sha256').notNull(),
    policy_sha256: text('policy_sha256').notNull(),
    wallet_address: text('wallet_address').notNull(),
    agent_id: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    builder_address: text('builder_address').notNull(),
    gross_amount: numeric('gross_amount', { precision: 20, scale: 6 }).notNull(),
    status: text('status').notNull().default('ADMITTED'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('release_canary_release_policy_idx').on(table.release, table.policy_sha256),
    index('release_canary_wallet_idx').on(table.release, table.policy_sha256, table.wallet_address),
    index('release_canary_status_updated_idx').on(table.status, table.updated_at),
    check('release_canary_release_check', sql.raw("release ~ '^[0-9a-fA-F]{40}$'")),
    check('release_canary_manifest_hash_check', sql.raw("manifest_sha256 ~ '^[0-9a-f]{64}$'")),
    check('release_canary_policy_hash_check', sql.raw("policy_sha256 ~ '^[0-9a-f]{64}$'")),
    check('release_canary_gross_positive', sql.raw('gross_amount > 0')),
    check(
      'release_canary_status_check',
      sql.raw("status IN ('ADMITTED', 'SETTLED', 'FAILED')")
    ),
  ]
)
export const transactions = pgTable('transactions', {
  id: id(),
  credit_balance_id: text('credit_balance_id').references(() => creditBalances.id, {
    onDelete: 'set null',
  }),
  agent_call_id: text('agent_call_id')
    .unique()
    .references(() => agentCalls.id, { onDelete: 'set null' }),
  type: transactionTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
  currency: text('currency').notNull().default('USDG'), // Robinhood Chain stablecoin
  tx_hash: text('tx_hash').unique(), // Robinhood Chain (EVM) tx hash; unique prevents replay
  wallet_address: text('wallet_address'),
  chain_id: integer('chain_id'),
  contract_address: text('contract_address'),
  event_name: text('event_name'),
  block_number: bigint('block_number', { mode: 'bigint' }),
  log_index: integer('log_index'),
  status: txStatusEnum('status').notNull().default('PENDING'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  confirmed_at: timestamp('confirmed_at'),
},
  (table) => [
    index('transaction_credit_created_idx').on(table.credit_balance_id, table.created_at),
    index('transaction_chain_ledger_idx').on(
      table.chain_id,
      table.contract_address,
      table.type,
      table.status
    ),
  ]
)

// ─────────────────────────────────────────
// REVIEW
// ─────────────────────────────────────────

// Durable intent/outbox for the backend-signed EarningsCredited transaction.
// A row exists before broadcast, and the tx hash is persisted before waiting
// for a receipt. The chain event remains the recovery source of truth.
export const settlementAttempts = pgTable(
  'settlement_attempts',
  {
    id: id(),
    agent_call_id: text('agent_call_id')
      .notNull()
      .unique()
      .references(() => agentCalls.id, { onDelete: 'cascade' }),
    onchain_call_id: text('onchain_call_id').notNull().unique(),
    builder_address: text('builder_address').notNull(),
    gross_amount: numeric('gross_amount', { precision: 20, scale: 6 }).notNull(),
    builder_amount: numeric('builder_amount', { precision: 20, scale: 6 }).notNull(),
    platform_amount: numeric('platform_amount', { precision: 20, scale: 6 }).notNull(),
    status: settlementStatusEnum('status').notNull().default('PREPARED'),
    tx_hash: text('tx_hash').unique(),
    chain_id: integer('chain_id').notNull(),
    contract_address: text('contract_address').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }),
    attempt_count: integer('attempt_count').notNull().default(0),
    last_error: text('last_error'),
    submitted_at: timestamp('submitted_at'),
    confirmed_at: timestamp('confirmed_at'),
    applied_at: timestamp('applied_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('settlement_attempt_status_updated_idx').on(table.status, table.updated_at),
    check('settlement_gross_positive', sql.raw('gross_amount > 0')),
    check('settlement_builder_nonnegative', sql.raw('builder_amount >= 0')),
    check('settlement_platform_nonnegative', sql.raw('platform_amount >= 0')),
    check('settlement_amounts_balance', sql.raw('gross_amount = builder_amount + platform_amount')),
  ]
)
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    agent_id: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('review_agent_user_unique').on(t.agent_id, t.user_id)]
)

// ─────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────

export const reports = pgTable('reports', {
  id: id(),
  agent_id: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reason: reportReasonEnum('reason').notNull(),
  description: text('description').notNull(),
  evidence: jsonb('evidence').notNull().default({}),
  status: reportStatusEnum('status').notNull().default('PENDING'),
  assigned_to_user_id: text('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  admin_note: text('admin_note'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  resolved_at: timestamp('resolved_at'),
},
  (table) => [
    index('report_status_created_idx').on(table.status, table.created_at),
    index('report_agent_created_idx').on(table.agent_id, table.created_at),
  ]
)

// ─────────────────────────────────────────
// PLATFORM STATS
// ─────────────────────────────────────────

export const userNotifications = pgTable(
  'user_notifications',
  {
    id: id(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    read_at: timestamp('read_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notification_user_created_idx').on(table.user_id, table.created_at)]
)

export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: id(),
    builder_id: text('builder_id')
      .notNull()
      .references(() => builders.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    event_types: text('event_types').array().notNull(),
    secret_ciphertext: text('secret_ciphertext').notNull(),
    secret_hint: text('secret_hint').notNull(),
    status: webhookSubscriptionStatusEnum('status').notNull().default('ACTIVE'),
    last_delivery_at: timestamp('last_delivery_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('webhook_subscription_builder_status_idx').on(table.builder_id, table.status),
    check('webhook_subscription_event_types_check', sql.raw('cardinality(event_types) between 1 and 32')),
  ]
)

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    event_type: text('event_type').notNull(),
    aggregate_type: text('aggregate_type').notNull(),
    aggregate_id: text('aggregate_id').notNull(),
    dedupe_key: text('dedupe_key').notNull().unique(),
    payload: jsonb('payload').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('webhook_event_created_idx').on(table.created_at)]
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    event_id: text('event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    subscription_id: text('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    status: webhookDeliveryStatusEnum('status').notNull().default('PENDING'),
    attempt_count: integer('attempt_count').notNull().default(0),
    next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    locked_until: timestamp('locked_until', { withTimezone: true }),
    last_status_code: integer('last_status_code'),
    last_error: text('last_error'),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_delivery_event_subscription_unique').on(table.event_id, table.subscription_id),
    index('webhook_delivery_ready_idx').on(table.status, table.next_attempt_at),
    check('webhook_delivery_attempt_count_check', sql.raw('attempt_count >= 0')),
  ]
)

export const webhookDeliveryAttempts = pgTable(
  'webhook_delivery_attempts',
  {
    id: id(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: 'cascade' }),
    attempt_number: integer('attempt_number').notNull(),
    request_timestamp: text('request_timestamp').notNull(),
    signature: text('signature').notNull(),
    response_status: integer('response_status'),
    error_code: text('error_code'),
    duration_ms: integer('duration_ms').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_attempt_delivery_number_unique').on(table.delivery_id, table.attempt_number),
    index('webhook_attempt_created_idx').on(table.created_at),
    check('webhook_attempt_number_positive', sql.raw('attempt_number > 0')),
    check('webhook_attempt_duration_nonnegative', sql.raw('duration_ms >= 0')),
  ]
)

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: id(),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    actor_user_id: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    previous_status: reportStatusEnum('previous_status'),
    next_status: reportStatusEnum('next_status').notNull(),
    note: text('note'),
    metadata: jsonb('metadata').notNull().default({}),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('moderation_action_report_created_idx').on(table.report_id, table.created_at)]
)

export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: id(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: privacyRequestTypeEnum('type').notNull(),
    status: privacyRequestStatusEnum('status').notNull().default('PENDING'),
    request_reason: text('request_reason'),
    result_manifest: jsonb('result_manifest'),
    rejection_reason: text('rejection_reason'),
    requested_at: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    processed_by_user_id: text('processed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('privacy_request_user_created_idx').on(table.user_id, table.created_at),
    index('privacy_request_status_created_idx').on(table.status, table.created_at),
  ]
)

export const telemetryFieldRegistry = pgTable(
  'telemetry_field_registry',
  {
    field_name: text('field_name').primaryKey(),
    classification: telemetryClassificationEnum('classification').notNull(),
    purpose: text('purpose').notNull(),
    owner: text('owner').notNull(),
    retention_days: integer('retention_days').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('telemetry_retention_nonnegative', sql.raw('retention_days >= 0')),
    check(
      'telemetry_prohibited_disabled',
      sql.raw("classification <> 'PROHIBITED' OR enabled = false")
    ),
  ]
)
export const platformStats = pgTable('platform_stats', {
  id: id(),
  date: timestamp('date').notNull().unique(),
  total_calls: integer('total_calls').notNull().default(0),
  total_revenue: numeric('total_revenue', { precision: 20, scale: 6 })
    .notNull()
    .default('0.000000'),
  active_users: integer('active_users').notNull().default(0),
  active_builders: integer('active_builders').notNull().default(0),
  new_agents: integer('new_agents').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
})


// Durable chain cursor plus raw event ledger. The raw ledger is intentionally
// separate from business tables: (tx_hash, log_index) is the EVM event identity,
// while one transaction can emit more than one log.
export const chainSyncState = pgTable(
  'chain_sync_state',
  {
    id: text('id').primaryKey(),
    chain_id: integer('chain_id').notNull(),
    contract_address: text('contract_address').notNull(),
    last_processed_block: bigint('last_processed_block', { mode: 'bigint' }).notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('chain_sync_chain_contract_unique').on(t.chain_id, t.contract_address)]
)

export const chainEvents = pgTable(
  'chain_events',
  {
    id: id(),
    sync_state_id: text('sync_state_id')
      .notNull()
      .references(() => chainSyncState.id, { onDelete: 'cascade' }),
    event_type: chainEventTypeEnum('event_type').notNull(),
    tx_hash: text('tx_hash').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp').notNull(),
    actor_address: text('actor_address').notNull(),
    correlation_id: text('correlation_id'),
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    secondary_amount: numeric('secondary_amount', {
      precision: 20,
      scale: 6,
    }),
    reconciled: boolean('reconciled').notNull().default(false),
    reconciliation_error: text('reconciliation_error'),
    reconciled_at: timestamp('reconciled_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chain_event_tx_log_unique').on(t.tx_hash, t.log_index),
    index('chain_event_sync_block_idx').on(t.sync_state_id, t.block_number),
    index('chain_event_pending_block_idx').on(t.reconciled, t.block_number),
  ]
)

// Durable Phase 2 operator state. Heartbeats make process/backup freshness observable
// across instances; alert lifecycle preserves dedupe, acknowledgement, and resolution.
export const operationalAlertStatusEnum = pgEnum('operational_alert_status', [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
])

export const operationalHeartbeats = pgTable(
  'operational_heartbeats',
  {
    service_name: text('service_name').primaryKey(),
    instance_id: text('instance_id').notNull(),
    release: text('release').notNull(),
    status: text('status').notNull(),
    details: jsonb('details').notNull().default({}),
    last_seen_at: timestamp('', { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp('', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('operational_heartbeat_seen_idx').on(table.last_seen_at),
    check('operational_heartbeat_status_check', sql.raw("status in ('ok', 'degraded', 'failed')")),
  ]
)

export const operationalAlerts = pgTable(
  'operational_alerts',
  {
    id: id(),
    fingerprint: text('fingerprint').notNull().unique(),
    rule: text('rule').notNull(),
    severity: text('severity').notNull(),
    status: operationalAlertStatusEnum('status').notNull().default('OPEN'),
    summary: text('summary').notNull(),
    details: jsonb('details').notNull().default({}),
    occurrences: integer('occurrences').notNull().default(1),
    first_seen_at: timestamp('', { withTimezone: true }).notNull().defaultNow(),
    last_seen_at: timestamp('', { withTimezone: true }).notNull().defaultNow(),
    last_notified_at: timestamp('', { withTimezone: true }),
    acknowledged_at: timestamp('', { withTimezone: true }),
    acknowledged_by: text('acknowledged_by'),
    resolved_at: timestamp('', { withTimezone: true }),
    created_at: timestamp('', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('operational_alert_status_seen_idx').on(table.status, table.last_seen_at),
    index('operational_alert_rule_seen_idx').on(table.rule, table.last_seen_at),
    check('operational_alert_severity_check', sql.raw("severity in ('warning', 'critical')")),
    check('operational_alert_occurrences_positive', sql.raw('occurrences > 0')),
  ]
)
