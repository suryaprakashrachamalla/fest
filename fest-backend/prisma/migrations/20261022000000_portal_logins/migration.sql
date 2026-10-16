-- Hackathon portal logins emailed to teams at the gate. Additive only.
ALTER TABLE "Registration" ADD COLUMN "portalLogin" TEXT;
ALTER TABLE "Registration" ADD COLUMN "portalTeamId" INTEGER;
ALTER TABLE "Registration" ADD COLUMN "portalPassword" TEXT;
ALTER TABLE "Registration" ADD COLUMN "portalSyncedAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "portalAttemptAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "portalError" TEXT;
ALTER TABLE "Participant" ADD COLUMN "portalEmailedAt" TIMESTAMP(3);
