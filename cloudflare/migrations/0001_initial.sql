CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "AuthSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitorId" TEXT NOT NULL,
    "orderId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "GoogleAuthFlow" (
    "stateHash" TEXT NOT NULL PRIMARY KEY,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

CREATE TABLE "Order" (
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

CREATE TABLE "RateLimitEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "createdAtMs" BIGINT NOT NULL,
    "expiresAtMs" BIGINT NOT NULL
);

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

CREATE TABLE "VideoJob" (
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

CREATE UNIQUE INDEX "Account_googleSubject_key" ON "Account"("googleSubject");

CREATE INDEX "AuthSession_accountId_idx" ON "AuthSession"("accountId");

CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

CREATE INDEX "CreditLedger_orderId_idx" ON "CreditLedger"("orderId");

CREATE INDEX "CreditLedger_visitorId_createdAt_idx" ON "CreditLedger"("visitorId", "createdAt");

CREATE INDEX "GoogleAuthFlow_expiresAt_idx" ON "GoogleAuthFlow"("expiresAt");

CREATE INDEX "Order_stripePaymentIntentId_idx" ON "Order"("stripePaymentIntentId");

CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");

CREATE INDEX "Order_visitorId_createdAt_idx" ON "Order"("visitorId", "createdAt");

CREATE INDEX "RateLimitEvent_expiresAtMs_idx" ON "RateLimitEvent"("expiresAtMs");

CREATE INDEX "RateLimitEvent_scope_ipHash_createdAtMs_idx" ON "RateLimitEvent"("scope", "ipHash", "createdAtMs");

CREATE INDEX "RateLimitEvent_scope_visitorId_createdAtMs_idx" ON "RateLimitEvent"("scope", "visitorId", "createdAtMs");

CREATE INDEX "UsageEvent_jobId_idx" ON "UsageEvent"("jobId");

CREATE INDEX "UsageEvent_utmSource_createdAt_idx" ON "UsageEvent"("utmSource", "createdAt");

CREATE INDEX "UsageEvent_visitorId_createdAt_idx" ON "UsageEvent"("visitorId", "createdAt");

CREATE UNIQUE INDEX "VideoJob_ownerToken_key" ON "VideoJob"("ownerToken");

CREATE INDEX "VideoJob_providerJobId_idx" ON "VideoJob"("providerJobId");

CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");

CREATE INDEX "VideoJob_visitorId_createdAt_idx" ON "VideoJob"("visitorId", "createdAt");

CREATE TABLE AtomicGuard (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL CHECK (version >= 0));
INSERT INTO AtomicGuard (id, version) VALUES (1, 0);

CREATE TRIGGER "revision_Account_INSERT" AFTER INSERT ON "Account" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_Account_UPDATE" AFTER UPDATE ON "Account" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_Account_DELETE" AFTER DELETE ON "Account" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_VideoJob_INSERT" AFTER INSERT ON "VideoJob" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_VideoJob_UPDATE" AFTER UPDATE ON "VideoJob" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_VideoJob_DELETE" AFTER DELETE ON "VideoJob" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_Order_INSERT" AFTER INSERT ON "Order" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_Order_UPDATE" AFTER UPDATE ON "Order" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_Order_DELETE" AFTER DELETE ON "Order" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_CreditLedger_INSERT" AFTER INSERT ON "CreditLedger" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_CreditLedger_UPDATE" AFTER UPDATE ON "CreditLedger" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER "revision_CreditLedger_DELETE" AFTER DELETE ON "CreditLedger" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;
