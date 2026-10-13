-- Read-only, event-scoped analytics access for normal accounts. Additive only.
CREATE TABLE "EventAnalyticsAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventAnalyticsAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventAnalyticsAccess_userId_eventId_key" ON "EventAnalyticsAccess"("userId", "eventId");
ALTER TABLE "EventAnalyticsAccess" ADD CONSTRAINT "EventAnalyticsAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAnalyticsAccess" ADD CONSTRAINT "EventAnalyticsAccess_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
