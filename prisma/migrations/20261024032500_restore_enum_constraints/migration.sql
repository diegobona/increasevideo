-- Preserve the custom enum and scale CHECK constraints across Prisma table rebuilds.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "plan" TEXT NOT NULL CHECK ("plan" IN ('SINGLE', 'TRIPLE', 'PACK20')),
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PAID', 'REFUNDED')),
    "creditsGranted" INTEGER NOT NULL,
    "paidAt" DATETIME,
    "expiresAt" DATETIME,
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "visitorId" TEXT NOT NULL
);
INSERT INTO "new_Order" ("amountCents", "createdAt", "creditsGranted", "currency", "id", "plan", "status", "stripePaymentIntentId", "stripeSessionId", "visitorId", "paidAt", "expiresAt", "refundedAmountCents") SELECT "amountCents", "createdAt", "creditsGranted", "currency", "id", "plan", "status", "stripePaymentIntentId", "stripeSessionId", "visitorId", "paidAt", "expiresAt", "refundedAmountCents" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");
CREATE INDEX "Order_visitorId_createdAt_idx" ON "Order"("visitorId", "createdAt");
CREATE INDEX "Order_stripePaymentIntentId_idx" ON "Order"("stripePaymentIntentId");
CREATE TABLE "new_VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    "originalUrl" TEXT NOT NULL,
    "resultUrl" TEXT,
    "originalDurationSec" REAL NOT NULL,
    "originalWidth" INTEGER NOT NULL,
    "originalHeight" INTEGER NOT NULL,
    "originalFps" REAL,
    "billingVersion" INTEGER NOT NULL DEFAULT 0,
    "resultWidth" INTEGER,
    "resultHeight" INTEGER,
    "scale" INTEGER NOT NULL CHECK ("scale" IN (2,4)),
    "denoise" BOOLEAN NOT NULL DEFAULT false,
    "providerJobId" TEXT,
    "errorMessage" TEXT,
    "isFreeTier" BOOLEAN NOT NULL DEFAULT true,
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "ownerToken" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL
);
INSERT INTO "new_VideoJob" ("createdAt", "denoise", "errorMessage", "id", "isFreeTier", "originalDurationSec", "originalHeight", "originalUrl", "originalWidth", "ownerToken", "providerJobId", "resultHeight", "resultUrl", "resultWidth", "scale", "status", "updatedAt", "visitorId", "watermark", "originalFps", "billingVersion") SELECT "createdAt", "denoise", "errorMessage", "id", "isFreeTier", "originalDurationSec", "originalHeight", "originalUrl", "originalWidth", "ownerToken", "providerJobId", "resultHeight", "resultUrl", "resultWidth", "scale", "status", "updatedAt", "visitorId", "watermark", "originalFps", "billingVersion" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE UNIQUE INDEX "VideoJob_ownerToken_key" ON "VideoJob"("ownerToken");
CREATE INDEX "VideoJob_visitorId_createdAt_idx" ON "VideoJob"("visitorId", "createdAt");
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
CREATE INDEX "VideoJob_providerJobId_idx" ON "VideoJob"("providerJobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
