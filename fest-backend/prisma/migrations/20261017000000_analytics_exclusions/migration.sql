-- Super-admin rules that keep test registrations out of the analytics. Additive only.
CREATE TYPE "AnalyticsExclusionKind" AS ENUM ('REGISTRATION', 'ACCOUNT');

CREATE TABLE "AnalyticsExclusion" (
    "id" TEXT NOT NULL,
    "kind" "AnalyticsExclusionKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsExclusion_kind_value_key" ON "AnalyticsExclusion"("kind", "value");

ALTER TABLE "AnalyticsExclusion" ADD CONSTRAINT "AnalyticsExclusion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
