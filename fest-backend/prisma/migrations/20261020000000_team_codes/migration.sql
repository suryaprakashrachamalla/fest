-- Team codes (Rs 50 off one registration of one event). Additive only.
ALTER TABLE "Registration" ADD COLUMN "discountCode" TEXT;
ALTER TABLE "Registration" ADD COLUMN "discountPaise" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "usedByRegistrationId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");
CREATE UNIQUE INDEX "DiscountCode_usedByRegistrationId_key" ON "DiscountCode"("usedByRegistrationId");
CREATE INDEX "DiscountCode_eventId_idx" ON "DiscountCode"("eventId");

ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
