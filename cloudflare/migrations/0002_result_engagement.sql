ALTER TABLE "UsageEvent" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'page_view';
ALTER TABLE "UsageEvent" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "target" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "durationMs" INTEGER;
CREATE INDEX "UsageEvent_eventType_createdAt_idx" ON "UsageEvent"("eventType", "createdAt");
CREATE INDEX "UsageEvent_sessionId_idx" ON "UsageEvent"("sessionId");
