-- Tracks adding approved registrations to Luma, which sends the confirmation and ticket emails.
ALTER TABLE "Registration" ADD COLUMN "lumaSyncedAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "lumaAttemptAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "lumaError" TEXT;
CREATE INDEX "Registration_status_lumaSyncedAt_idx" ON "Registration"("status", "lumaSyncedAt");
