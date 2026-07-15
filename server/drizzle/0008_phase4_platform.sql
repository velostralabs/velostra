CREATE TYPE "public"."agent_revision_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('EXPORT', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."telemetry_classification" AS ENUM('PUBLIC', 'OPERATIONAL', 'SENSITIVE', 'FINANCIAL', 'PROHIBITED');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('PENDING', 'RETRYING', 'DELIVERED', 'DEAD_LETTER', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."webhook_subscription_status" AS ENUM('ACTIVE', 'PAUSED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "agent_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "agent_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"long_description" text,
	"category" "agent_category" NOT NULL,
	"endpoint_url" text NOT NULL,
	"price_per_call" numeric(20, 6) NOT NULL,
	"price_tier" "price_tier" NOT NULL,
	"logo_url" text,
	"change_summary" text,
	"created_by_user_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_revision_number_positive" CHECK (revision_number > 0),
	CONSTRAINT "agent_revision_price_positive" CHECK (price_per_call > 0)
);
--> statement-breakpoint
CREATE TABLE "api_idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'PROCESSING' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_key_length_check" CHECK (length(idempotency_key) between 8 and 128),
	CONSTRAINT "api_idempotency_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"previous_status" "report_status",
	"next_status" "report_status" NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "privacy_request_type" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'PENDING' NOT NULL,
	"request_reason" text,
	"result_manifest" jsonb,
	"rejection_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_field_registry" (
	"field_name" text PRIMARY KEY NOT NULL,
	"classification" "telemetry_classification" NOT NULL,
	"purpose" text NOT NULL,
	"owner" text NOT NULL,
	"retention_days" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_retention_nonnegative" CHECK (retention_days >= 0),
	CONSTRAINT "telemetry_prohibited_disabled" CHECK (classification <> 'PROHIBITED' OR enabled = false)
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_attempt_count_check" CHECK (attempt_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"request_timestamp" text NOT NULL,
	"signature" text NOT NULL,
	"response_status" integer,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_attempt_number_positive" CHECK (attempt_number > 0),
	CONSTRAINT "webhook_attempt_duration_nonnegative" CHECK (duration_ms >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"builder_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"event_types" text[] NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_hint" text NOT NULL,
	"status" "webhook_subscription_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_subscription_event_types_check" CHECK (cardinality(event_types) between 1 and 32)
);
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "agent_revision_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "active_revision_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "assigned_to_user_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency_records" ADD CONSTRAINT "api_idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_processed_by_user_id_users_id_fk" FOREIGN KEY ("processed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_revision_number_unique" ON "agent_revisions" USING btree ("agent_id","revision_number");--> statement-breakpoint
CREATE INDEX "agent_revision_status_created_idx" ON "agent_revisions" USING btree ("agent_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_actor_operation_key_unique" ON "api_idempotency_records" USING btree ("user_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "api_idempotency_expiry_idx" ON "api_idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "moderation_action_report_created_idx" ON "moderation_actions" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "privacy_request_user_created_idx" ON "privacy_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "privacy_request_status_created_idx" ON "privacy_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "user_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_event_subscription_unique" ON "webhook_deliveries" USING btree ("event_id","subscription_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_ready_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_attempt_delivery_number_unique" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "webhook_attempt_created_idx" ON "webhook_delivery_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_created_idx" ON "webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_subscription_builder_status_idx" ON "webhook_subscriptions" USING btree ("builder_id","status");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "agent_revisions" (
  "id", "agent_id", "revision_number", "status", "name", "description",
  "long_description", "category", "endpoint_url", "price_per_call", "price_tier",
  "logo_url", "created_by_user_id", "published_at", "created_at"
)
SELECT
  'rev_' || md5(a."id" || ':1'), a."id", 1, 'PUBLISHED', a."name", a."description",
  a."long_description", a."category", a."endpoint_url", a."price_per_call", a."price_tier",
  a."logo_url", b."user_id", a."created_at", a."created_at"
FROM "agents" a
JOIN "builders" b ON b."id" = a."builder_id"
ON CONFLICT ("agent_id", "revision_number") DO NOTHING;
--> statement-breakpoint
UPDATE "agents" a
SET "active_revision_id" = r."id"
FROM "agent_revisions" r
WHERE r."agent_id" = a."id" AND r."revision_number" = 1 AND a."active_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "agent_calls" c
SET "agent_revision_id" = a."active_revision_id"
FROM "agents" a
WHERE a."id" = c."agent_id" AND c."agent_revision_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_active_revision_id_agent_revisions_id_fk"
  FOREIGN KEY ("active_revision_id") REFERENCES "public"."agent_revisions"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_agent_revision_id_agent_revisions_id_fk"
  FOREIGN KEY ("agent_revision_id") REFERENCES "public"."agent_revisions"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION "public"."phase4_prevent_published_revision_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published agent revisions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "agent_revision_immutable_update"
BEFORE UPDATE ON "agent_revisions"
FOR EACH ROW EXECUTE FUNCTION "public"."phase4_prevent_published_revision_mutation"();
--> statement-breakpoint
CREATE TRIGGER "agent_revision_immutable_delete"
BEFORE DELETE ON "agent_revisions"
FOR EACH ROW EXECUTE FUNCTION "public"."phase4_prevent_published_revision_mutation"();
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "report_description_length_check"
  CHECK (length(description) between 10 and 4000);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "report_evidence_object_check"
  CHECK (jsonb_typeof(evidence) = 'object');
--> statement-breakpoint
INSERT INTO "telemetry_field_registry"
  ("field_name", "classification", "purpose", "owner", "retention_days", "enabled")
VALUES
  ('request_id', 'OPERATIONAL', 'Correlate request and audit events', 'platform', 30, true),
  ('route', 'OPERATIONAL', 'Measure endpoint reliability', 'platform', 30, true),
  ('status_code', 'OPERATIONAL', 'Measure endpoint outcomes', 'platform', 30, true),
  ('duration_ms', 'OPERATIONAL', 'Measure bounded latency', 'platform', 30, true),
  ('call_id', 'SENSITIVE', 'Correlate a user-visible execution', 'trust', 30, true),
  ('wallet_address', 'FINANCIAL', 'Reconcile authenticated financial activity', 'finance', 2555, false),
  ('raw_prompt', 'PROHIBITED', 'Private prompt bodies are never telemetry', 'privacy', 0, false),
  ('private_key', 'PROHIBITED', 'Secrets are never telemetry', 'security', 0, false),
  ('auth_token', 'PROHIBITED', 'Credentials are never telemetry', 'security', 0, false)
ON CONFLICT ("field_name") DO NOTHING;