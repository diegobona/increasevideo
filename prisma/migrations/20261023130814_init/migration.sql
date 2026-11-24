-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "originalUrl" TEXT NOT NULL,
    "resultUrl" TEXT,
    "originalDurationSec" REAL NOT NULL,
    "originalWidth" INTEGER NOT NULL,
    "originalHeight" INTEGER NOT NULL,
    "scale" INTEGER NOT NULL,
    "denoise" BOOLEAN NOT NULL DEFAULT false,
    "providerJobId" TEXT,
    "errorMessage" TEXT,
    "isFreeTier" BOOLEAN NOT NULL DEFAULT true,
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "ownerToken" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    -- Prisma's SQLite enum types are represented as TEXT, so enforce them here.
    CONSTRAINT "VideoJob_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT "VideoJob_scale_check" CHECK ("scale" IN (2, 4))
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "plan" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "creditsGranted" INTEGER NOT NULL,
    "visitorId" TEXT NOT NULL,
    CONSTRAINT "Order_plan_check" CHECK ("plan" IN ('SINGLE', 'TRIPLE', 'PACK20')),
    CONSTRAINT "Order_status_check" CHECK ("status" IN ('PENDING', 'PAID', 'REFUNDED'))
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitorId" TEXT NOT NULL,
    "orderId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitorId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "utmSource" TEXT,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoJob_ownerToken_key" ON "VideoJob"("ownerToken");

-- CreateIndex
CREATE INDEX "VideoJob_visitorId_createdAt_idx" ON "VideoJob"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoJob_providerJobId_idx" ON "VideoJob"("providerJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");

-- CreateIndex
CREATE INDEX "Order_visitorId_createdAt_idx" ON "Order"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_stripePaymentIntentId_idx" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "CreditLedger_visitorId_createdAt_idx" ON "CreditLedger"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedger_orderId_idx" ON "CreditLedger"("orderId");

-- CreateIndex
CREATE INDEX "UsageEvent_visitorId_createdAt_idx" ON "UsageEvent"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_jobId_idx" ON "UsageEvent"("jobId");

-- CreateIndex
CREATE INDEX "UsageEvent_utmSource_createdAt_idx" ON "UsageEvent"("utmSource", "createdAt");
