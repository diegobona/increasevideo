PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    "originalUrl" TEXT NOT NULL,
    "resultUrl" TEXT,
    "originalDurationSec" REAL NOT NULL,
    "processedDurationSec" REAL,
    "originalWidth" INTEGER NOT NULL,
    "originalHeight" INTEGER NOT NULL,
    "originalFps" REAL,
    "billingVersion" INTEGER NOT NULL DEFAULT 0,
    "resultWidth" INTEGER,
    "resultHeight" INTEGER,
    "scale" REAL NOT NULL CHECK ("scale" >= 1 AND "scale" <= 4),
    "denoise" BOOLEAN NOT NULL DEFAULT false,
    "providerJobId" TEXT,
    "pollToken" TEXT,
    "pollLeaseUntil" DATETIME,
    "errorMessage" TEXT,
    "isFreeTier" BOOLEAN NOT NULL DEFAULT true,
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "ownerToken" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL
);
INSERT INTO "new_VideoJob" ("id", "createdAt", "updatedAt", "status", "originalUrl", "resultUrl", "originalDurationSec", "processedDurationSec", "originalWidth", "originalHeight", "originalFps", "billingVersion", "resultWidth", "resultHeight", "scale", "denoise", "providerJobId", "pollToken", "pollLeaseUntil", "errorMessage", "isFreeTier", "watermark", "ownerToken", "visitorId") SELECT "id", "createdAt", "updatedAt", "status", "originalUrl", "resultUrl", "originalDurationSec", "processedDurationSec", "originalWidth", "originalHeight", "originalFps", "billingVersion", "resultWidth", "resultHeight", "scale", "denoise", "providerJobId", "pollToken", "pollLeaseUntil", "errorMessage", "isFreeTier", "watermark", "ownerToken", "visitorId" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE UNIQUE INDEX "VideoJob_ownerToken_key" ON "VideoJob"("ownerToken");
CREATE INDEX "VideoJob_visitorId_createdAt_idx" ON "VideoJob"("visitorId", "createdAt");
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
CREATE INDEX "VideoJob_providerJobId_idx" ON "VideoJob"("providerJobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
