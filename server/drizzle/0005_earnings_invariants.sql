ALTER TABLE "builder_earnings" ADD CONSTRAINT "builder_earnings_total_nonnegative" CHECK (total_earned >= 0);--> statement-breakpoint
ALTER TABLE "builder_earnings" ADD CONSTRAINT "builder_earnings_available_nonnegative" CHECK (available >= 0);--> statement-breakpoint
ALTER TABLE "builder_earnings" ADD CONSTRAINT "builder_earnings_claimed_nonnegative" CHECK (total_claimed >= 0);--> statement-breakpoint
ALTER TABLE "earnings_claims" ADD CONSTRAINT "earnings_claim_amount_positive" CHECK (amount > 0);