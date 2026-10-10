-- Registration flow: statuses, team contact details, per-head pricing, per-student emails and an audit log.
-- Existing rows are backfilled so this migration also applies to databases that already hold registrations.

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_VERIFIED', 'APPROVED', 'TICKET_ISSUED', 'PAYMENT_REJECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('FLAT', 'PER_HEAD');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "feeMode" "FeeMode" NOT NULL DEFAULT 'FLAT';

-- AlterTable
ALTER TABLE "PaymentProof" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'UPI';

-- AlterTable: add nullable first, backfill, then enforce NOT NULL.
ALTER TABLE "Registration" ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" TEXT,
ADD COLUMN "code" TEXT,
ADD COLUMN "college" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING_PAYMENT';

UPDATE "Registration" r SET
    "code" = 'SG26-' || upper(substr(md5(r."id"), 1, 8)),
    "college" = COALESCE((SELECT p."college" FROM "Participant" p WHERE p."registrationId" = r."id" ORDER BY p."createdAt" LIMIT 1), ''),
    "phone" = '',
    "status" = CASE
        WHEN r."verified" THEN 'PAYMENT_VERIFIED'::"RegistrationStatus"
        WHEN EXISTS (SELECT 1 FROM "PaymentProof" pp WHERE pp."registrationId" = r."id" AND pp."status" = 'PENDING') THEN 'PAYMENT_REVIEW'::"RegistrationStatus"
        WHEN EXISTS (SELECT 1 FROM "PaymentProof" pp WHERE pp."registrationId" = r."id" AND pp."status" = 'REJECTED') THEN 'PAYMENT_REJECTED'::"RegistrationStatus"
        ELSE 'PENDING_PAYMENT'::"RegistrationStatus"
    END;

ALTER TABLE "Registration" ALTER COLUMN "code" SET NOT NULL,
ALTER COLUMN "college" SET NOT NULL,
ALTER COLUMN "phone" SET NOT NULL;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN "email" TEXT,
ADD COLUMN "eventId" TEXT;

UPDATE "Participant" p SET
    "eventId" = r."eventId",
    "email" = 'legacy-' || p."id" || '@invalid.local'
FROM "Registration" r
WHERE r."id" = p."registrationId";

ALTER TABLE "Participant" ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "eventId" SET NOT NULL;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "RegistrationStatus",
    "toStatus" "RegistrationStatus",
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_registrationId_createdAt_idx" ON "AuditLog"("registrationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_eventId_email_key" ON "Participant"("eventId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_code_key" ON "Registration"("code");

-- CreateIndex
CREATE INDEX "Registration_status_createdAt_idx" ON "Registration"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
