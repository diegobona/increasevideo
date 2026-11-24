// Run against a fresh isolated database/server. Invalid input exercises the real
// request gate without uploading footage, spending credits, or calling fal.
import assert from "node:assert/strict";

const baseUrl = process.argv[2] || "http://127.0.0.1:3000";
const cookies = new Map();
const statuses = [];

async function post(cookieHeader = "") {
  const response = await fetch(new URL("/api/jobs", baseUrl), {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    body: "{}",
  });
  const body = await response.json();
  assert.equal(body.ok, false);
  if (response.status === 429) assert.ok(Number(response.headers.get("Retry-After")) > 0);
  return response;
}

for (let i = 1; i <= 20; i++) {
  const response = await post(Array.from(cookies, ([key, value]) => `${key}=${value}`).join("; "));
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const split = pair.indexOf("=");
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  statuses.push(response.status);
  console.log(`same-cookie #${i}: HTTP ${response.status}${response.headers.has("Retry-After") ? ` Retry-After=${response.headers.get("Retry-After")}` : ""}`);
}
assert.ok(cookies.has("visitorId"), "The server must issue a visitorId cookie.");
assert.deepEqual(statuses, [401, 401, 401, ...Array(17).fill(429)], "Use a fresh isolated DB: pre-existing IP counts can block earlier.");

// The first phase admitted three attempts. Seven fresh sessions fill the same
// IP's remaining allowance; the eighth fresh session must still receive 429.
const rotated = [];
for (let i = 1; i <= 10; i++) {
  const response = await post();
  rotated.push(response.status);
  console.log(`cleared-cookie #${i}: HTTP ${response.status}${response.headers.has("Retry-After") ? ` Retry-After=${response.headers.get("Retry-After")}` : ""}`);
}
assert.deepEqual(rotated, [...Array(7).fill(401), 429, 429, 429]);
console.log("PASS: requests 4–20 blocked; clearing cookies cannot bypass the shared IP limit.");
