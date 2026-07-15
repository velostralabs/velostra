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

export const creditBalances = pgTable('credit_balances', {
  id: id(),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  balance_usd: numeric('balance_usd', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  free_tier_used: integer('free_tier_used').notNull().default(0),
  free_tier_reset_date: timestamp('free_tier_reset_date').notNull().defaultNow(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
})

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
})

// ─────────────────────────────────────────
// BUILDER EARNINGS
// ─────────────────────────────────────────

export const builderEarnings = pgTable('builder_earnings', {
  id: id(),
  builder_id: text('builder_id')
    .notNull()
    .unique()
    .references(() => builders.id, { onDelete: 'cascade' }),
  total_earned: numeric('total_earned', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  available: numeric('available', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  total_claimed: numeric('total_claimed', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────
// EARNINGS CLAIM
// ─────────────────────────────────────────

export const earningsClaims = pgTable('earnings_claims', {
  id: id(),
  builder_id: text('builder_id')
    .notNull()
    .references(() => builders.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 20, scale: 6, mode: 'number' }).notNull(),
  status: claimStatusEnum('status').notNull().default('PENDING'),
  tx_hash: text('tx_hash').unique(), // Robinhood Chain (EVM) transaction hash; unique prevents replay
  wallet_address: text('wallet_address').notNull(),
  chain_id: integer('chain_id'),
  contract_address: text('contract_address'),
  block_number: bigint('block_number', { mode: 'bigint' }),
  log_index: integer('log_index'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
})

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
  price_per_call: numeric('price_per_call', { precision: 20, scale: 6, mode: 'number' }).notNull(),
  price_tier: priceTierEnum('price_tier').notNull().default('BASIC'),
  logo_url: text('logo_url'),
  status: agentStatusEnum('status').notNull().default('PENDING'),
  featured: boolean('featured').notNull().default(false),
  total_calls: integer('total_calls').notNull().default(0),
  total_revenue: numeric('total_revenue', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  avg_rating: doublePrecision('avg_rating'),
  review_count: integer('review_count').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
})

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

export const agentCalls = pgTable('agent_calls', {
  id: id(),
  agent_id: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  input: text('input').notNull(),
  output: jsonb('output'),
  status: callStatusEnum('status').notNull().default('PENDING'),
  is_free_tier: boolean('is_free_tier').notNull().default(false),
  onchain_call_id: text('onchain_call_id').unique(),
  price_charged: numeric('price_charged', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  builder_earned: numeric('builder_earned', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  platform_earned: numeric('platform_earned', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
  execution_ms: integer('execution_ms'),
  tokens_used: integer('tokens_used'),
  error_message: text('error_message'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
})

// ─────────────────────────────────────────
// TRANSACTION
// ─────────────────────────────────────────

export const transactions = pgTable('transactions', {
  id: id(),
  credit_balance_id: text('credit_balance_id').references(() => creditBalances.id, {
    onDelete: 'set null',
  }),
  agent_call_id: text('agent_call_id')
    .unique()
    .references(() => agentCalls.id, { onDelete: 'set null' }),
  type: transactionTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 20, scale: 6, mode: 'number' }).notNull(),
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
})

// ─────────────────────────────────────────
// REVIEW
// ─────────────────────────────────────────

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
  status: reportStatusEnum('status').notNull().default('PENDING'),
  admin_note: text('admin_note'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  resolved_at: timestamp('resolved_at'),
})

// ─────────────────────────────────────────
// PLATFORM STATS
// ─────────────────────────────────────────

export const platformStats = pgTable('platform_stats', {
  id: id(),
  date: timestamp('date').notNull().unique(),
  total_calls: integer('total_calls').notNull().default(0),
  total_revenue: numeric('total_revenue', { precision: 20, scale: 6, mode: 'number' })
    .notNull()
    .default(0),
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
    amount: numeric('amount', { precision: 20, scale: 6, mode: 'number' }).notNull(),
    secondary_amount: numeric('secondary_amount', {
      precision: 20,
      scale: 6,
      mode: 'number',
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
