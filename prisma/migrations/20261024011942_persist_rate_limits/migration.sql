-- CreateTable
CREATE TABLE "RateLimitEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "createdAtMs" BIGINT NOT NULL,
    "expiresAtMs" BIGINT NOT NULL
);

-- CreateIndex
CREATE INDEX "RateLimitEvent_scope_ipHash_createdAtMs_idx" ON "RateLimitEvent"("scope", "ipHash", "createdAtMs");

-- CreateIndex
CREATE INDEX "RateLimitEvent_scope_visitorId_createdAtMs_idx" ON "RateLimitEvent"("scope", "visitorId", "createdAtMs");

-- CreateIndex
CREATE INDEX "RateLimitEvent_expiresAtMs_idx" ON "RateLimitEvent"("expiresAtMs");
