-- Per-member entrance tickets: a random ticket code (shown as a QR), ticket email status,
-- and the entrance check-in. The default is volatile, so existing members each get their own code.
ALTER TABLE "Participant" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "checkedInById" TEXT,
ADD COLUMN     "ticketCode" TEXT NOT NULL DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text),
ADD COLUMN     "ticketEmailAttemptAt" TIMESTAMP(3),
ADD COLUMN     "ticketEmailError" TEXT,
ADD COLUMN     "ticketEmailedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_ticketCode_key" ON "Participant"("ticketCode");

-- CreateIndex
CREATE INDEX "Participant_ticketEmailedAt_idx" ON "Participant"("ticketEmailedAt");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
