-- Payment screenshots can move to Google Drive: the bytes become optional and the Drive copy is
-- tracked. Additive only; existing screenshots stay where they are until copied.
ALTER TABLE "PaymentProof" ALTER COLUMN "screenshotBytes" DROP NOT NULL;
ALTER TABLE "PaymentProof" ADD COLUMN "driveFileId" TEXT;
ALTER TABLE "PaymentProof" ADD COLUMN "driveUploadedAt" TIMESTAMP(3);
ALTER TABLE "PaymentProof" ADD COLUMN "driveAttemptAt" TIMESTAMP(3);
ALTER TABLE "PaymentProof" ADD COLUMN "driveError" TEXT;
