import "server-only";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";
import { statement, type SqlStatement } from "../db/d1";

type CreditDatabase = Pick<PrismaClient, "creditLedger" | "order" | "$executeRaw"> | Prisma.TransactionClient;
const insufficient = () => new ApiError(402, "INSUFFICIENT_CREDITS", "额度不足，请购买时长包后继续处理");

export async function ensureFreeGrant(database: CreditDatabase, visitorId: string) {
  const grantId = `free_grant:${visitorId}`;
  await database.$executeRaw`
    INSERT INTO "CreditLedger" ("id", "visitorId", "delta", "reason")
    SELECT ${grantId}, ${visitorId}, ${pricing.free.initialCredits}, 'FREE_GRANT'
    WHERE EXISTS (SELECT 1 FROM "Account" WHERE "id" = ${visitorId})
    AND NOT EXISTS (SELECT 1 FROM "CreditLedger" WHERE "visitorId" = ${visitorId} AND "orderId" IS NULL)
    ON CONFLICT("id") DO NOTHING`;
}

async function paidPools(database: CreditDatabase, visitorId: string, now: Date) {
  const orders = await database.order.findMany({ where: { visitorId }, orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, status: true, expiresAt: true } });
  const totals = await database.creditLedger.groupBy({ by: ["orderId"], where: { visitorId, orderId: { not: null } }, _sum: { delta: true } });
  const sums = new Map(totals.map((entry) => [entry.orderId, entry._sum.delta ?? 0]));
  // Refund debts remain payable even when the order is refunded or its grant expires.
  // Expired positive grants never become spendable again through a job refund.
  return orders.map((order) => ({ id: order.id, balance: sums.get(order.id) ?? 0,
    active: order.status === "PAID" && order.expiresAt !== null && order.expiresAt > now }));
}

export async function readCreditBalances(database: CreditDatabase, visitorId: string, now = new Date()) {
  const [free, pools] = await Promise.all([
    database.creditLedger.aggregate({ where: { visitorId, orderId: null }, _sum: { delta: true }, _count: { _all: true } }),
    paidPools(database, visitorId, now),
  ]);
  const freeCredits = Math.max(0, free._sum.delta ?? 0);
  const paidCredits = Math.max(0, pools.reduce((sum, pool) => sum + (pool.active || pool.balance < 0 ? pool.balance : 0), 0));
  return { freeCredits, paidCredits };
}

// Call only inside the transaction that first creates the job: its write holds
// SQLite's writer lock so concurrent requests cannot reserve the same balance.
export async function reserveJobCredits(database: Prisma.TransactionClient, visitorId: string, jobId: string, cost: number, paid: boolean, now = new Date(), pending?: SqlStatement[]) {
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error("Invalid credit reservation");
  const write = async (data: { id: string; visitorId: string; orderId: string; delta: number; reason: string }[]) => {
    if (pending) for (const row of data) pending.push(statement('INSERT INTO CreditLedger (id, visitorId, orderId, delta, reason) VALUES (?, ?, ?, ?, ?)', row.id, row.visitorId, row.orderId, row.delta, row.reason));
    else await database.creditLedger.createMany({ data });
  };
  if (!paid) {
    const debitId = `job_debit:${jobId}`;
    if (pending) {
      const balance = await database.creditLedger.aggregate({ where: { visitorId, orderId: null }, _sum: { delta: true } });
      if ((balance._sum.delta ?? 0) < cost) throw insufficient();
      pending.push(statement('INSERT INTO CreditLedger (id, visitorId, delta, reason) VALUES (?, ?, ?, ?)', debitId, visitorId, -cost, `JOB_DEBIT:${jobId}`));
      return;
    }
    const reserved = await database.$executeRaw`
      INSERT INTO "CreditLedger" ("id", "visitorId", "delta", "reason")
      SELECT ${debitId}, ${visitorId}, ${-cost}, ${`JOB_DEBIT:${jobId}`}
      WHERE (SELECT COALESCE(SUM("delta"), 0) FROM "CreditLedger" WHERE "visitorId" = ${visitorId} AND "orderId" IS NULL) >= ${cost}`;
    if (!reserved) throw insufficient();
    return;
  }
  const pools = await paidPools(database, visitorId, now);
  const available = pools.reduce((sum, pool) => sum + (pool.active || pool.balance < 0 ? pool.balance : 0), 0);
  if (available < cost) throw insufficient();
  // Transfer the withheld part into the debt's original pool before spending.
  // Otherwise expiry of a positive pool would make the same old debt reappear.
  // Both sides are immutable ledger entries and their sum is always zero.
  for (const debtor of pools.filter((pool) => pool.balance < 0)) {
    for (const payer of pools) {
      if (!payer.active || payer.balance <= 0) continue;
      const repayment = Math.min(-debtor.balance, payer.balance);
      const transferId = `${jobId}:${debtor.id}:${payer.id}`;
      await write([
        { id: `debt_offset:${transferId}`, visitorId, orderId: payer.id, delta: -repayment, reason: `DEBT_OFFSET:${jobId}` },
        { id: `debt_settlement:${transferId}`, visitorId, orderId: debtor.id, delta: repayment, reason: `DEBT_SETTLEMENT:${jobId}` },
      ]);
      payer.balance -= repayment;
      debtor.balance += repayment;
      if (debtor.balance === 0) break;
    }
  }
  let remaining = cost;
  for (const pool of pools) {
    if (!pool.active || pool.balance <= 0) continue;
    const delta = Math.min(remaining, pool.balance);
    await write([{
      id: `job_debit:${jobId}:${pool.id}`, visitorId, orderId: pool.id, delta: -delta, reason: `JOB_DEBIT:${jobId}`,
    }]);
    remaining -= delta;
    if (remaining === 0) return;
  }
  throw insufficient();
}

export async function refundJobCredits(database: Prisma.TransactionClient, visitorId: string, jobId: string, pending?: SqlStatement[]) {
  const debits = await database.creditLedger.findMany({ where: { visitorId, delta: { lt: 0 }, OR: [{ reason: `JOB_DEBIT:${jobId}` }, { id: `job_debit:${jobId}` }] } });
  for (const debit of debits) {
    if (pending) {
      pending.push(statement('INSERT INTO CreditLedger (id, visitorId, orderId, delta, reason) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', debit.orderId ? `job_refund:${jobId}:${debit.orderId}` : `job_refund:${jobId}`, visitorId, debit.orderId, -debit.delta, `JOB_REFUND:${jobId}`));
      continue;
    }
    await database.creditLedger.upsert({
    where: { id: debit.orderId ? `job_refund:${jobId}:${debit.orderId}` : `job_refund:${jobId}` }, update: {},
    create: { id: debit.orderId ? `job_refund:${jobId}:${debit.orderId}` : `job_refund:${jobId}`, visitorId, orderId: debit.orderId, delta: -debit.delta, reason: `JOB_REFUND:${jobId}` },
    });
  }
}
