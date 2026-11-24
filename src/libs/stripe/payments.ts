import "server-only";
import { randomUUID } from "node:crypto";
import type { Order, Prisma, PrismaClient } from "../../generated/prisma/client";
import { pricing } from "../../config/pricing";
import { ApiError, checkOrigin, failure, readJson, success } from "../api/http";
import { createDistributedLimiter } from "../api/distributed-limit";
import { createRequestLimiter } from "../rateLimit";
import { getVisitor, withVisitorCookie } from "../visitor";
import { getAccount } from "../auth/session";
import { createStripeClient, verifyStripeEvent, type StripeClient, type StripeEvent } from "./client";
import { atomicD1, getD1, statement, type SqlStatement } from "../db/d1";

type Dependencies = { database: PrismaClient; stripe?: StripeClient; webhookSecret?: string; clock?: () => number };
type Transaction = Prisma.TransactionClient;
const paidPlans = ["SINGLE", "TRIPLE", "PACK20"] as const;
type Plan = (typeof paidPlans)[number];
const mismatch = () => new ApiError(400, "PAYMENT_MISMATCH", "Payment details do not match this order.");
const retryOrder = () => new ApiError(409, "ORDER_NOT_READY", "Order is not ready. Retry this event later.");

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function identifier(value: unknown): string | undefined {
  if (typeof value === "string" && value.length <= 255) return value;
  const id = object(value).id;
  return typeof id === "string" && id.length <= 255 ? id : undefined;
}
function expiration(paidAt: Date): Date {
  const expires = new Date(paidAt);
  const day = expires.getUTCDate();
  expires.setUTCDate(1);
  expires.setUTCMonth(expires.getUTCMonth() + pricing.paid.validityMonths);
  const end = new Date(expires);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  expires.setUTCDate(Math.min(day, end.getUTCDate()));
  return expires;
}

async function webhookBody(request: Request): Promise<string> {
  const maxBytes = 1_048_576;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ApiError(413, "REQUEST_TOO_LARGE", "Webhook body is too large.");
  if (!request.body) throw new ApiError(400, "INVALID_WEBHOOK", "Missing webhook body.");
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new ApiError(413, "REQUEST_TOO_LARGE", "Webhook body is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Only cumulative refund differences are recorded, including refunds after credits were spent. */
async function reconcileRefund(tx: Transaction, order: Order, pending?: SqlStatement[], newGrant = false) {
  const grant = await tx.creditLedger.findUnique({ where: { id: `order_grant:${order.id}` } });
  if ((!grant && !newGrant) || !order.refundedAmountCents) return;
  const revoked = await tx.creditLedger.aggregate({ where: { orderId: order.id, reason: "ORDER_REFUND" }, _sum: { delta: true } });
  const desired = Math.ceil(order.creditsGranted * order.refundedAmountCents / order.amountCents);
  const difference = desired + (revoked._sum.delta ?? 0);
  if (difference <= 0) return;
  if (pending) {
    pending.push(statement('INSERT INTO CreditLedger (id, visitorId, orderId, delta, reason) VALUES (?, ?, ?, ?, ?)', `order_refund:${order.id}:${desired}`, order.visitorId, order.id, -difference, "ORDER_REFUND"));
    return;
  }
  await tx.creditLedger.create({ data: {
    id: `order_refund:${order.id}:${desired}`, visitorId: order.visitorId, orderId: order.id, delta: -difference, reason: "ORDER_REFUND",
  } });
}

export function createPaymentHandlers({ database, stripe = createStripeClient(), webhookSecret, clock = Date.now }: Dependencies) {
  async function mutateBilling(mutate: (tx: Transaction, pending?: SqlStatement[]) => Promise<void>) {
    if (!getD1(database)) return database.$transaction((tx) => mutate(tx));
    return atomicD1(database, async () => {
      const statements: SqlStatement[] = [];
      await mutate(database, statements);
      return { statements, result: undefined };
    });
  }
  const checkoutLimit = createRequestLimiter(database, {
    scope: "payments:checkout", windowMs: 60_000,
    visitorLimit: pricing.api.checkoutPerVisitorPerMinute, ipLimit: pricing.api.checkoutPerIpPerMinute,
  }, clock);
  const webhookLimit = createDistributedLimiter(database, "stripe:webhook", pricing.api.webhookPerMinute);

  async function checkout(request: Request): Promise<Response> {
    const visitor = getVisitor(request);
    const reply = (response: Response) => withVisitorCookie(response, request, visitor, true);
    try {
      const account = await getAccount(database, request);
      const limited = await checkoutLimit(request, account?.id ?? visitor.id);
      if (limited) return reply(limited);
      checkOrigin(request);
      if (!account) throw new ApiError(401, "AUTH_REQUIRED", "请先使用 Google 登录，再购买时长包");
      const input = await readJson(request);
      if (typeof input.plan !== "string" || !paidPlans.includes(input.plan as Plan)) throw new ApiError(400, "INVALID_PLAN", "Choose a valid paid plan.");
      stripe.assertConfigured();
      if (!(webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET)) throw new ApiError(503, "STRIPE_NOT_CONFIGURED", "Stripe webhook is not configured yet. Please try again later.");
      const plan = input.plan as Plan;
      const offer = pricing.plans[plan];
      const placeholder = `pending:${randomUUID()}`;
      const order = await database.order.create({ data: {
        stripeSessionId: placeholder, plan, amountCents: offer.priceCents, currency: pricing.currency,
        creditsGranted: offer.credits, visitorId: account.id,
      } });
      const session = await stripe.createCheckout({ orderId: order.id, plan, priceCents: order.amountCents, credits: order.creditsGranted });
      // A webhook can arrive before this HTTP response. Never reset payment state here.
      await database.order.updateMany({ where: { id: order.id, stripeSessionId: placeholder }, data: {
        stripeSessionId: session.id, ...(session.paymentIntentId ? { stripePaymentIntentId: session.paymentIntentId } : {}),
      } });
      return reply(success({ url: session.url, orderId: order.id }));
    } catch (error) { return reply(failure(error)); }
  }

  async function paid(event: StripeEvent): Promise<void> {
    const session = event.data.object;
    if (session.payment_status !== "paid") return;
    const metadataOrderId = identifier(object(session.metadata).orderId);
    const referenceOrderId = identifier(session.client_reference_id);
    if (!metadataOrderId || metadataOrderId !== referenceOrderId || session.mode !== "payment") throw mismatch();
    const sessionId = identifier(session.id);
    const paymentIntentId = identifier(session.payment_intent);
    if (!sessionId?.startsWith("cs_") || !paymentIntentId?.startsWith("pi_")) throw mismatch();
    await mutateBilling(async (tx, pending) => {
      // Acquire the SQLite writer lock before checking grant/refund state so duplicate deliveries serialize.
      if (!pending) await tx.order.updateMany({ where: { id: metadataOrderId }, data: { refundedAmountCents: { increment: 0 } } });
      const order = await tx.order.findUnique({ where: { id: metadataOrderId } });
      if (!order) throw retryOrder();
      if (session.amount_total !== order.amountCents || typeof session.currency !== "string" || session.currency.toUpperCase() !== order.currency.toUpperCase() ||
        (!order.stripeSessionId.startsWith("pending:") && order.stripeSessionId !== sessionId) ||
        (order.stripePaymentIntentId && order.stripePaymentIntentId !== paymentIntentId)) throw mismatch();
      const paidAt = order.paidAt ?? new Date(Math.min(event.created * 1000, clock()));
      const refunded = order.refundedAmountCents >= order.amountCents;
      const update = {
        stripeSessionId: sessionId, stripePaymentIntentId: paymentIntentId, paidAt, expiresAt: order.expiresAt ?? expiration(paidAt),
        status: refunded ? "REFUNDED" as const : "PAID" as const,
      };
      const updated = pending ? { ...order, ...update } : await tx.order.update({ where: { id: order.id }, data: update });
      if (pending) pending.push(statement('UPDATE "Order" SET stripeSessionId = ?, stripePaymentIntentId = ?, paidAt = ?, expiresAt = ?, status = ? WHERE id = ?', sessionId, paymentIntentId, paidAt.toISOString(), update.expiresAt.toISOString(), update.status, order.id));
      // A full refund seen before the paid event must never issue usable credits.
      if (refunded) { await reconcileRefund(tx, updated, pending); return; }
      if (pending) pending.push(statement('INSERT INTO CreditLedger (id, visitorId, orderId, delta, reason) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', `order_grant:${order.id}`, order.visitorId, order.id, order.creditsGranted, "ORDER_GRANT"));
      else await tx.creditLedger.upsert({ where: { id: `order_grant:${order.id}` }, update: {}, create: {
        id: `order_grant:${order.id}`, visitorId: order.visitorId, orderId: order.id, delta: order.creditsGranted, reason: "ORDER_GRANT",
      } });
      await reconcileRefund(tx, updated, pending, true);
    });
  }

  async function refunded(event: StripeEvent): Promise<void> {
    const charge = event.data.object;
    const orderId = identifier(object(charge.metadata).orderId);
    const paymentIntentId = identifier(charge.payment_intent);
    if (!paymentIntentId?.startsWith("pi_")) throw mismatch();
    const refundAmount = charge.amount_refunded;
    if (typeof refundAmount !== "number" || !Number.isSafeInteger(refundAmount) || refundAmount < 0 || charge.paid !== true) throw mismatch();
    // Do not interfere with refunds from other products on the same Stripe account.
    const candidate = orderId ? await database.order.findUnique({ where: { id: orderId } }) :
      await database.order.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!candidate) { if (orderId) throw retryOrder(); return; }
    await mutateBilling(async (tx, pending) => {
      if (!pending) await tx.order.updateMany({ where: { id: candidate.id }, data: { refundedAmountCents: { increment: 0 } } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: candidate.id } });
      if (charge.amount !== order.amountCents || typeof charge.currency !== "string" || charge.currency.toUpperCase() !== order.currency.toUpperCase() ||
        refundAmount > order.amountCents || (order.stripePaymentIntentId && order.stripePaymentIntentId !== paymentIntentId)) throw mismatch();
      const cumulative = Math.max(order.refundedAmountCents, refundAmount);
      const update = {
        stripePaymentIntentId: paymentIntentId, refundedAmountCents: cumulative,
        ...(cumulative >= order.amountCents ? { status: "REFUNDED" as const } : {}),
      };
      const updated = pending ? { ...order, ...update } : await tx.order.update({ where: { id: order.id }, data: update });
      if (pending) pending.push(statement('UPDATE "Order" SET stripePaymentIntentId = ?, refundedAmountCents = ?, status = ? WHERE id = ?', paymentIntentId, cumulative, updated.status, order.id));
      await reconcileRefund(tx, updated, pending);
    });
  }

  async function webhook(request: Request): Promise<Response> {
    const limited = await webhookLimit(request);
    if (limited) return limited;
    try {
      const secret = webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new ApiError(503, "STRIPE_NOT_CONFIGURED", "Stripe webhook is not configured yet.");
      const event = verifyStripeEvent(await webhookBody(request), request.headers.get("stripe-signature"), secret, clock());
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") await paid(event);
      else if (event.type === "charge.refunded") await refunded(event);
      return success({ received: true });
    } catch (error) { return failure(error); }
  }
  return { checkout, webhook };
}
