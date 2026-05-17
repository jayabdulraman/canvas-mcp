import assert from "node:assert/strict";
import test from "node:test";

import { CanvasClient } from "../dist/canvas-client.js";

function response(body, init = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

test("retries transient 429 responses and honors Retry-After", async () => {
  const sleeps = [];
  let attempts = 0;
  const client = new CanvasClient({
    baseUrl: "https://canvas.example",
    token: "secret-token",
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return response({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "2" } });
      }
      return response({ id: 42, name: "Biology" }, { status: 200 });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const course = await client.getCourse(42);

  assert.equal(course.id, 42);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("throws sanitized structured errors without leaking unlimited response bodies", async () => {
  const client = new CanvasClient({
    baseUrl: "https://canvas.example",
    token: "secret-token",
    fetch: async () => response("x".repeat(2000), { status: 400, statusText: "Bad Request" }),
  });

  await assert.rejects(
    () => client.getCourse(42),
    (error) => {
      assert.equal(error.name, "CanvasApiError");
      assert.equal(error.method, "GET");
      assert.equal(error.path, "/courses/42");
      assert.equal(error.status, 400);
      assert.equal(error.retryable, false);
      assert.ok(error.bodySnippet.length <= 512);
      assert.ok(!error.message.includes("x".repeat(600)));
      return true;
    }
  );
});

test("passes an AbortController signal to fetch for request timeouts", async () => {
  let receivedSignal;
  const client = new CanvasClient({
    baseUrl: "https://canvas.example",
    token: "secret-token",
    timeoutMs: 100,
    fetch: async (_url, init) => {
      receivedSignal = init.signal;
      return response({ id: 42 }, { status: 200 });
    },
  });

  await client.getCourse(42);

  assert.ok(receivedSignal instanceof AbortSignal);
});

test("throws a clear pagination error when max pages are reached with another page available", async () => {
  let page = 0;
  const client = new CanvasClient({
    baseUrl: "https://canvas.example",
    token: "secret-token",
    maxPages: 2,
    fetch: async () => {
      page += 1;
      return response([{ id: page, name: `Course ${page}` }], {
        status: 200,
        headers: {
          Link: `<https://canvas.example/api/v1/courses?page=${page + 1}>; rel="next"`,
        },
      });
    },
  });

  await assert.rejects(
    () => client.listCourses(),
    (error) => {
      assert.equal(error.name, "CanvasPaginationError");
      assert.equal(error.method, "GET");
      assert.equal(error.path, "/courses");
      assert.equal(error.maxPages, 2);
      assert.match(error.nextUrl, /page=3/);
      return true;
    }
  );
});
