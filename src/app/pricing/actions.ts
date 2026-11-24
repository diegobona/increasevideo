"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { paymentHandlers } from "@/libs/stripe/handlers";
import { getVisitor } from "@/libs/visitor";
import { db } from "@/libs/db";
import { getAccount } from "@/libs/auth/session";

export async function purchaseTimePack(form: FormData): Promise<void> {
  const plan = form.get("plan");
  if (plan !== "SINGLE" && plan !== "TRIPLE" && plan !== "PACK20") redirect("/pricing?error=INVALID_PLAN");
  const incoming = await headers();
  if (!await getAccount(db, new Request("https://increasevideoquality.com", { headers: incoming }))) {
    redirect(`/login?next=${encodeURIComponent(`/pricing#pack-${plan}`)}`);
  }
  if (!process.env.APP_URL || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    redirect("/pricing?error=STRIPE_NOT_CONFIGURED");
  }
  const requestHeaders = new Headers({ "Content-Type": "application/json" });
  requestHeaders.set("cookie", incoming.get("cookie") ?? "");
  const origin = new URL(process.env.APP_URL).origin;
  requestHeaders.set("origin", origin);
  const connectingIp = incoming.get("cf-connecting-ip");
  if (connectingIp) requestHeaders.set("cf-connecting-ip", connectingIp);
  const request = new Request(new URL("/api/checkout", origin), {
    method: "POST", headers: requestHeaders, body: JSON.stringify({ plan }),
  });
  const visitor = getVisitor(request);
  const response = await paymentHandlers.checkout(request);
  const result = await response.json();
  // This action calls the handler internally, so its Set-Cookie needs to be
  // applied to the actual browser response as well. Preserve the same UUID.
  const renewed = response.headers.getSetCookie().find((cookie) => cookie.startsWith("visitorId="));
  if (renewed) (await cookies()).set("visitorId", visitor.id, {
    httpOnly: true, sameSite: "lax", path: "/", secure: origin.startsWith("https:"),
    maxAge: Number(renewed.match(/Max-Age=(\d+)/)?.[1]),
  });
  if (!response.ok || !result.ok) {
    const code = result.code === "RATE_LIMITED" ? "RATE_LIMITED" : result.code === "STRIPE_NOT_CONFIGURED" ? "STRIPE_NOT_CONFIGURED" : "CHECKOUT_FAILED";
    redirect(`/pricing?error=${code}`);
  }
  const checkoutUrl = result.data?.url;
  if (typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://checkout.stripe.com/")) {
    redirect("/pricing?error=CHECKOUT_FAILED");
  }
  redirect(checkoutUrl);
}
