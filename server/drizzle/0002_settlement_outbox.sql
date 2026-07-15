CREATE TYPE "public"."settlement_status" AS ENUM('PREPARED', 'READY', 'SUBMITTED', 'AMBIGUOUS', 'CONFIRMED', 'APPLIED', 'FAILED');--> statement-breakpoint
CREATE TABLE "settlement_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_call_id" text NOT NULL,
	"onchain_call_id" text NOT NULL,
	"builder_address" text NOT NULL,
	"gross_amount" numeric(20, 6) NOT NULL,
	"builder_amount" numeric(20, 6) NOT NULL,
	"platform_amount" numeric(20, 6) NOT NULL,
	"status" "settlement_status" DEFAULT 'PREPARED' NOT NULL,
	"tx_hash" text,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"block_number" bigint,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp,
	"confirmed_at" timestamp,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_attempts_agent_call_id_unique" UNIQUE("agent_call_id"),
	CONSTRAINT "settlement_attempts_onchain_call_id_unique" UNIQUE("onchain_call_id"),
	CONSTRAINT "settlement_attempts_tx_hash_unique" UNIQUE("tx_hash"),
	CONSTRAINT "settlement_gross_positive" CHECK (gross_amount > 0),
	CONSTRAINT "settlement_builder_nonnegative" CHECK (builder_amount >= 0),
	CONSTRAINT "settlement_platform_nonnegative" CHECK (platform_amount >= 0),
	CONSTRAINT "settlement_amounts_balance" CHECK (gross_amount = builder_amount + platform_amount)
);
--> statement-breakpoint
ALTER TABLE "agent_calls" ALTER COLUMN "price_charged" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "agent_calls" ALTER COLUMN "builder_earned" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "agent_calls" ALTER COLUMN "platform_earned" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "total_revenue" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "builder_earnings" ALTER COLUMN "total_earned" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "builder_earnings" ALTER COLUMN "available" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "builder_earnings" ALTER COLUMN "total_claimed" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "credit_balances" ALTER COLUMN "balance_usd" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "platform_stats" ALTER COLUMN "total_revenue" SET DEFAULT '0.000000';--> statement-breakpoint
ALTER TABLE "credit_balances" ADD COLUMN "reserved_usd" numeric(20, 6) DEFAULT '0.000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_attempts" ADD CONSTRAINT "settlement_attempts_agent_call_id_agent_calls_id_fk" FOREIGN KEY ("agent_call_id") REFERENCES "public"."agent_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_attempt_status_updated_idx" ON "settlement_attempts" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balance_nonnegative" CHECK (balance_usd >= 0);--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_reservation_nonnegative" CHECK (reserved_usd >= 0);--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_reservation_within_balance" CHECK (reserved_usd <= balance_usd);