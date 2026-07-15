CREATE INDEX "agent_call_user_created_idx" ON "agent_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_call_agent_created_idx" ON "agent_calls" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_call_status_created_idx" ON "agent_calls" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_marketplace_idx" ON "agents" USING btree ("status","featured","created_at");--> statement-breakpoint
CREATE INDEX "agent_builder_created_idx" ON "agents" USING btree ("builder_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_status_category_idx" ON "agents" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "builder_status_created_idx" ON "builders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "earnings_claim_builder_created_idx" ON "earnings_claims" USING btree ("builder_id","created_at");--> statement-breakpoint
CREATE INDEX "earnings_claim_status_created_idx" ON "earnings_claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_agent_created_idx" ON "reports" USING btree ("agent_id","created_at");