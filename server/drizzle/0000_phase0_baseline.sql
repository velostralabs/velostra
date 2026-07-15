CREATE TYPE "public"."agent_category" AS ENUM('CRYPTO_DEFI', 'WALLET_ANALYSIS', 'TOKEN_RESEARCH', 'TRADING', 'WRITING', 'RESEARCH', 'PRODUCTIVITY', 'DATA_ANALYSIS', 'CODE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."builder_status" AS ENUM('ACTIVE', 'SUSPENDED', 'BANNED');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT');--> statement-breakpoint
CREATE TYPE "public"."chain_event_type" AS ENUM('DEPOSIT', 'EARNINGS_CREDITED', 'CLAIMED', 'PLATFORM_REVENUE_WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."price_tier" AS ENUM('BASIC', 'STANDARD', 'PRO', 'PREMIUM');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('HARMFUL_CONTENT', 'MISLEADING', 'NOT_WORKING', 'SPAM', 'INAPPROPRIATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('PENDING', 'REVIEWED', 'WARNING_SENT', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('TOPUP', 'AGENT_CALL', 'BUILDER_CLAIM', 'REFUND', 'PLATFORM_WITHDRAWAL');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TABLE "agent_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"input" text NOT NULL,
	"output" jsonb,
	"status" "call_status" DEFAULT 'PENDING' NOT NULL,
	"is_free_tier" boolean DEFAULT false NOT NULL,
	"onchain_call_id" text,
	"price_charged" numeric(20, 6) DEFAULT 0 NOT NULL,
	"builder_earned" numeric(20, 6) DEFAULT 0 NOT NULL,
	"platform_earned" numeric(20, 6) DEFAULT 0 NOT NULL,
	"execution_ms" integer,
	"tokens_used" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "agent_calls_onchain_call_id_unique" UNIQUE("onchain_call_id")
);
--> statement-breakpoint
CREATE TABLE "agent_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"builder_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"long_description" text,
	"category" "agent_category" NOT NULL,
	"endpoint_url" text NOT NULL,
	"secret_key" text NOT NULL,
	"price_per_call" numeric(20, 6) NOT NULL,
	"price_tier" "price_tier" DEFAULT 'BASIC' NOT NULL,
	"logo_url" text,
	"status" "agent_status" DEFAULT 'PENDING' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"total_revenue" numeric(20, 6) DEFAULT 0 NOT NULL,
	"avg_rating" double precision,
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "builder_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"builder_id" text NOT NULL,
	"total_earned" numeric(20, 6) DEFAULT 0 NOT NULL,
	"available" numeric(20, 6) DEFAULT 0 NOT NULL,
	"total_claimed" numeric(20, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "builder_earnings_builder_id_unique" UNIQUE("builder_id")
);
--> statement-breakpoint
CREATE TABLE "builders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"website_url" text,
	"twitter_url" text,
	"github_url" text,
	"verified" boolean DEFAULT false NOT NULL,
	"status" "builder_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "builders_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "builders_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_state_id" text NOT NULL,
	"event_type" "chain_event_type" NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"actor_address" text NOT NULL,
	"correlation_id" text,
	"amount" numeric(20, 6) NOT NULL,
	"secondary_amount" numeric(20, 6),
	"reconciled" boolean DEFAULT false NOT NULL,
	"reconciliation_error" text,
	"reconciled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance_usd" numeric(20, 6) DEFAULT 0 NOT NULL,
	"free_tier_used" integer DEFAULT 0 NOT NULL,
	"free_tier_reset_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "earnings_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"builder_id" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"status" "claim_status" DEFAULT 'PENDING' NOT NULL,
	"tx_hash" text,
	"wallet_address" text NOT NULL,
	"chain_id" integer,
	"contract_address" text,
	"block_number" bigint,
	"log_index" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "earnings_claims_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"total_revenue" numeric(20, 6) DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"active_builders" integer DEFAULT 0 NOT NULL,
	"new_agents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_stats_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" "report_reason" NOT NULL,
	"description" text NOT NULL,
	"status" "report_status" DEFAULT 'PENDING' NOT NULL,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_balance_id" text,
	"agent_call_id" text,
	"type" "transaction_type" NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'USDG' NOT NULL,
	"tx_hash" text,
	"wallet_address" text,
	"chain_id" integer,
	"contract_address" text,
	"event_name" text,
	"block_number" bigint,
	"log_index" integer,
	"status" "tx_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "transactions_agent_call_id_unique" UNIQUE("agent_call_id"),
	CONSTRAINT "transactions_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tags" ADD CONSTRAINT "agent_tags_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_earnings" ADD CONSTRAINT "builder_earnings_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builders" ADD CONSTRAINT "builders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_events" ADD CONSTRAINT "chain_events_sync_state_id_chain_sync_state_id_fk" FOREIGN KEY ("sync_state_id") REFERENCES "public"."chain_sync_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings_claims" ADD CONSTRAINT "earnings_claims_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_balance_id_credit_balances_id_fk" FOREIGN KEY ("credit_balance_id") REFERENCES "public"."credit_balances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_agent_call_id_agent_calls_id_fk" FOREIGN KEY ("agent_call_id") REFERENCES "public"."agent_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tag_unique" ON "agent_tags" USING btree ("agent_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_event_tx_log_unique" ON "chain_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_event_sync_block_idx" ON "chain_events" USING btree ("sync_state_id","block_number");--> statement-breakpoint
CREATE INDEX "chain_event_pending_block_idx" ON "chain_events" USING btree ("reconciled","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_sync_chain_contract_unique" ON "chain_sync_state" USING btree ("chain_id","contract_address");--> statement-breakpoint
CREATE UNIQUE INDEX "review_agent_user_unique" ON "reviews" USING btree ("agent_id","user_id");