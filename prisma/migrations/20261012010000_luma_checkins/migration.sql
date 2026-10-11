-- Per-member Luma guest IDs and entrance scan times, imported from Luma's guest list.
ALTER TABLE "Participant" ADD COLUMN "lumaGuestId" TEXT;
ALTER TABLE "Participant" ADD COLUMN "lumaCheckedInAt" TIMESTAMP(3);
