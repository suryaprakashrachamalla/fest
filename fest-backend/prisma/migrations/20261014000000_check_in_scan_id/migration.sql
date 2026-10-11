-- Scan request ID recorded with a check-in, so network retries of the same scan are idempotent.
ALTER TABLE "Participant" ADD COLUMN "checkInScanId" TEXT;
