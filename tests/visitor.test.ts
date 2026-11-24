import assert from "node:assert/strict";
import { test } from "node:test";
import { getVisitor, withVisitorCookie } from "../src/libs/visitor";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

const visitorId = "c5649772-458a-4b5a-9eea-dd78d9b16bba";

test("first visit receives a server-generated UUID in an HttpOnly cookie", () => {
  const request = new Request("http://localhost:3000/");
  const visitor = getVisitor(request);
  assert.equal(visitor.isNew, true);
  assert.match(visitor.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  const response = withVisitorCookie(new Response("ok"), request, visitor);
  const cookie = response.headers.get("set-cookie")!;
  assert.ok(cookie.startsWith(`visitorId=${visitor.id};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=\d+/);
  assert.doesNotMatch(cookie, /Secure/);
});

test("a valid existing visitor cookie is reused without resetting it", () => {
  const request = new Request("https://increasevideoquality.com/", { headers: { Cookie: `other=value; visitorId=${visitorId}; another=value` } });
  const visitor = getVisitor(request);
  assert.deepEqual(visitor, { id: visitorId, isNew: false });
  assert.equal(withVisitorCookie(new Response("ok"), request, visitor).headers.get("set-cookie"), null);
});

test("invalid visitor cookies are replaced and do not become a ledger identity", () => {
  for (const value of ["", "client-chosen-id", "../../other", "not%20a%20uuid", `${visitorId}%0d%0aInjected=value`]) {
    const visitor = getVisitor(new Request("https://increasevideoquality.com/api/jobs", { headers: { Cookie: `visitorId=${value}` } }));
    assert.equal(visitor.isNew, true);
    assert.notEqual(visitor.id, value);
  }
});

test("HTTPS visitor cookies are Secure and preserve other response cookies", () => {
  const request = new Request("https://increasevideoquality.com/api/jobs");
  const response = new Response("ok", { headers: { "Set-Cookie": "ownerToken=abc; HttpOnly; Path=/api/jobs/job" } });
  const result = withVisitorCookie(response, request, getVisitor(request));
  assert.equal(result, response);
  assert.match(result.headers.get("set-cookie")!, /ownerToken=abc/);
  assert.match(result.headers.get("set-cookie")!, /visitorId=[\da-f-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
});

test("UUID case is canonicalized to avoid multiple ledger identities", () => {
  const request = new Request("https://increasevideoquality.com/", { headers: { Cookie: `visitorId=${visitorId.toUpperCase()}` } });
  assert.deepEqual(getVisitor(request), { id: visitorId, isNew: false });
});

test("middleware forwards the newly issued cookie to the current API request", () => {
  const request = new NextRequest("https://increasevideoquality.com/api/jobs", { headers: { Cookie: "other=kept; visitorId=invalid" } });
  const response = middleware(request);
  const cookie = response.headers.get("set-cookie")!;
  const identity = cookie.match(/^visitorId=([\da-f-]+);/)![1];
  assert.equal(response.headers.get("x-middleware-request-cookie"), `other=kept; visitorId=${identity}`);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test("middleware does not reset a visitor on a later page visit", () => {
  const request = new NextRequest("https://increasevideoquality.com/", { headers: { Cookie: `visitorId=${visitorId}` } });
  const response = middleware(request);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-middleware-request-cookie"), null);
});

test("preview pages send noindex for new and returning visitors", () => {
  for (const cookie of ["", `visitorId=${visitorId}`]) {
    for (const path of ["/", "/video-upscaler", "/sitemap.xml"]) {
      const response = middleware(new NextRequest(`https://increasevideoquality.zw83716.workers.dev${path}`, { headers: { Cookie: cookie } }));
      assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
    }
  }
});

test("production stays indexable even with a forged forwarded host", () => {
  const response = middleware(new NextRequest("https://increasevideoquality.com/", {
    headers: { "x-forwarded-host": "increasevideoquality.zw83716.workers.dev" },
  }));
  assert.equal(response.headers.get("x-robots-tag"), null);
});

test("checkout can renew the same visitor identity beyond a paid pack's validity", () => {
  const request = new Request("https://increasevideoquality.com/api/checkout", { headers: { Cookie: `visitorId=${visitorId}` } });
  const response = withVisitorCookie(new Response("ok"), request, getVisitor(request), true);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.ok(cookie.startsWith(`visitorId=${visitorId};`));
  assert.ok(Number(cookie.match(/Max-Age=(\d+)/)?.[1]) > 366 * 24 * 60 * 60);
  assert.match(cookie, /HttpOnly/);
});
