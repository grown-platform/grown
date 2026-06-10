import { test, expect } from "@playwright/test";

test("GET /healthz returns version + commit + uptime_seconds", async ({
  request,
}) => {
  const res = await request.get("/healthz");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("version");
  expect(body).toHaveProperty("commit");
  expect(body).toHaveProperty("uptime_seconds");
  // protojson serializes int64 as a JSON string to avoid JS precision loss.
  // Verify it parses to a non-negative integer.
  expect(typeof body.uptime_seconds).toBe("string");
  const uptime = Number.parseInt(body.uptime_seconds, 10);
  expect(Number.isInteger(uptime)).toBe(true);
  expect(uptime).toBeGreaterThanOrEqual(0);
});
