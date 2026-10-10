ALTER TABLE "SpreadsheetSyncOutbox"
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "SpreadsheetSyncOutbox_status_createdAt_idx";

CREATE INDEX "SpreadsheetSyncOutbox_status_nextAttemptAt_createdAt_idx"
ON "SpreadsheetSyncOutbox"("status", "nextAttemptAt", "createdAt");
