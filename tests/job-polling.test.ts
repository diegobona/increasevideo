import assert from "node:assert/strict";
import { test } from "node:test";
import { pollVideoJob, PollingTimeoutError } from "../src/libs/video/poll";
import { pricing } from "../src/config/pricing";

test("client polls every configured interval and stops once a result arrives", async () => {
  let clock = 0;
  const times: number[] = [];
  const statuses: string[] = [];
  const result = await pollVideoJob("job-one", {
    signal: new AbortController().signal, now: () => clock,
    onStatus: (status) => statuses.push(status),
    wait: async (ms) => { clock += ms; },
    fetcher: async (url, options) => {
      assert.equal(url, "/api/jobs/job-one");
      assert.equal(options?.credentials, "same-origin");
      times.push(clock);
      return Response.json({ ok: true, data: times.length === 1 ? { status: "PENDING" } : times.length === 2 ? { status: "PROCESSING" } : { status: "SUCCEEDED", resultUrl: "https://media.example.com/result.mp4" } });
    },
  });
  assert.equal(result, "https://media.example.com/result.mp4");
  assert.deepEqual(times, [pricing.polling.intervalMs, pricing.polling.intervalMs * 2, pricing.polling.intervalMs * 3]);
  assert.deepEqual(statuses, ["PENDING", "PROCESSING"]);
});

test("polling stops at the deadline; retry checks the same job without a new POST", async () => {
  let clock = 0;
  const options = {
    signal: new AbortController().signal, now: () => clock,
    wait: async (ms: number) => { clock += ms; },
    fetcher: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, "/api/jobs/job-one");
      assert.equal(init?.method, "GET");
      return Response.json({ ok: true, data: { status: "PROCESSING" } });
    },
  };
  await assert.rejects(pollVideoJob("job-one", options), PollingTimeoutError);
  assert.equal(clock, pricing.polling.timeoutMs);
  const result = await pollVideoJob("job-one", {
    ...options, fetcher: async () => Response.json({ ok: true, data: { status: "SUCCEEDED", resultUrl: "https://media.example.com/result.mp4" } }),
  });
  assert.equal(result, "https://media.example.com/result.mp4");
});
