import assert from "node:assert/strict";
const origin = process.argv[2] || "https://increasevideoquality.com";
const cases = [
  ["/login", 200], ["/sitemap.xml", 200], ["/robots.txt", 200], ["/llms.txt", 200],
  ["/opengraph-image", 200], ["/result/deployment-missing-job", 404],
  ["/api/jobs/deployment-missing-job", 403],
  ["/result/deployment-missing-job/events", 403, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
  ["/api/jobs", 401, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
  ["/api/video/metadata", 401, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
  ["/demos/coast-before.mp4", 200],
];
for (const [path, expected, options] of cases) {
  const response = await fetch(new URL(path, origin), { ...options, redirect: "manual" });
  await response.body?.cancel();
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}`);
  if (path.endsWith(".mp4")) assert.match(response.headers.get("content-type"), /video\/mp4/);
  console.log(`[PASS] ${path}: HTTP ${response.status}`);
}
const auth = await fetch(new URL("/auth/google", origin), { redirect: "manual" });
assert.equal(auth.status, 303);
const destination = new URL(auth.headers.get("location"));
assert.equal(destination.hostname, "accounts.google.com");
assert.equal(destination.searchParams.get("redirect_uri"), `${origin}/auth/google/callback`);
assert.match(auth.headers.get("set-cookie"), /httponly/i);
assert.match(auth.headers.get("set-cookie"), /secure/i);
await auth.body?.cancel();
console.log("[PASS] Google sign-in entry: HTTP 303, correct callback, Secure/HttpOnly cookie (no login performed)");
