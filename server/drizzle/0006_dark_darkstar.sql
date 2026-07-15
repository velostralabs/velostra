CREATE TYPE "public"."operational_alert_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "operational_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"status" "operational_alert_status" DEFAULT 'OPEN' NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_notified_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_alerts_fingerprint_unique" UNIQUE("fingerprint"),
	CONSTRAINT "operational_alert_severity_check" CHECK (severity in ('warning', 'critical')),
	CONSTRAINT "operational_alert_occurrences_positive" CHECK (occurrences > 0)
);
--> statement-breakpoint
CREATE TABLE "operational_heartbeats" (
	"service_name" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"release" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_heartbeat_status_check" CHECK (status in ('ok', 'degraded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "operational_alert_status_seen_idx" ON "operational_alerts" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "operational_alert_rule_seen_idx" ON "operational_alerts" USING btree ("rule","last_seen_at");--> statement-breakpoint
CREATE INDEX "operational_heartbeat_seen_idx" ON "operational_heartbeats" USING btree ("last_seen_at");