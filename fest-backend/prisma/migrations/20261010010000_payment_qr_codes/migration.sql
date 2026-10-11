CREATE TABLE "PaymentQrCode" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "imageBytes" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentQrCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentQrCode_createdAt_idx" ON "PaymentQrCode"("createdAt");

CREATE UNIQUE INDEX "PaymentQrCode_only_one_active_key"
ON "PaymentQrCode" ("isActive")
WHERE "isActive" = true;
