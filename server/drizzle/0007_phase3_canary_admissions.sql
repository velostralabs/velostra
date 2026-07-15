CREATE TABLE "release_canary_admissions" (
	"agent_call_id" text PRIMARY KEY NOT NULL,
	"release" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"policy_sha256" text NOT NULL,
	"wallet_address" text NOT NULL,
	"agent_id" text NOT NULL,
	"builder_address" text NOT NULL,
	"gross_amount" numeric(20, 6) NOT NULL,
	"status" text DEFAULT 'ADMITTED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "release_canary_release_check" CHECK (release ~ '^[0-9a-fA-F]{40}$'),
	CONSTRAINT "release_canary_manifest_hash_check" CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "release_canary_policy_hash_check" CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "release_canary_gross_positive" CHECK (gross_amount > 0),
	CONSTRAINT "release_canary_status_check" CHECK (status IN ('ADMITTED', 'SETTLED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "release_canary_admissions" ADD CONSTRAINT "release_canary_admissions_agent_call_id_agent_calls_id_fk" FOREIGN KEY ("agent_call_id") REFERENCES "public"."agent_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_canary_admissions" ADD CONSTRAINT "release_canary_admissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_canary_release_policy_idx" ON "release_canary_admissions" USING btree ("release","policy_sha256");--> statement-breakpoint
CREATE INDEX "release_canary_wallet_idx" ON "release_canary_admissions" USING btree ("release","policy_sha256","wallet_address");--> statement-breakpoint
CREATE INDEX "release_canary_status_updated_idx" ON "release_canary_admissions" USING btree ("status","updated_at");