import test from "node:test";
import assert from "node:assert/strict";

import { createAuditEvent } from "../dist/audit-log.js";
import { renderBrandedPage } from "../dist/html-template.js";

test("escapes section body and callout content as text", () => {
  const html = renderBrandedPage({
    title: "Week <One>",
    sections: [
      {
        heading: "Overview",
        body: "<img src=x onerror=alert(1)>\n<script>alert('x')</script>",
        callout: "Avoid <script>",
      },
    ],
  });

  assert.match(html, /Week &lt;One&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.match(html, /Avoid &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<img\s/i);
});

test("filters unsafe link URLs and escapes link labels", () => {
  const html = renderBrandedPage({
    title: "Resources",
    sections: [
      {
        heading: "Links",
        body: "Use these resources.",
        links: [
          { label: "Safe <Site>", url: "https://example.edu/path?q=1" },
          { label: "JS", url: "javascript:alert(1)" },
          { label: "Data", url: "data:text/html,<svg onload=alert(1)>" },
        ],
      },
    ],
  });

  assert.match(html, /href="https:\/\/example.edu\/path\?q=1"/);
  assert.match(html, /Safe &lt;Site&gt;/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /data:text/i);
});

test("falls back from unsafe brand values before writing inline styles", () => {
  const html = renderBrandedPage({
    title: "Theme",
    guidelines: {
      primaryColor: "red; background-image: url(javascript:alert(1))",
      accentColor: "#0088cc",
      fontFamily: "Arial; background:url(javascript:alert(1))",
    },
    sections: [{ heading: "Safe", body: "Theme values are constrained." }],
  });

  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /background-image/i);
  assert.match(html, /color: #191919/);
  assert.match(html, /#0088cc/);
  assert.match(html, /font-family: Arial, Helvetica, sans-serif/);
});

test("audit events summarize tool calls without leaking raw arguments", () => {
  const event = createAuditEvent({
    status: "error",
    toolName: "create_page",
    arguments: {
      course_id: 123,
      title: "Launch",
      body: "contains CANVAS_API_TOKEN=secret-token",
      canvas_api_token: "secret-token",
    },
    durationMs: 42,
    error: new Error("Canvas API POST /courses/123/pages -> 403: CANVAS_API_TOKEN=secret-token"),
  });

  assert.equal(event.tool, "create_page");
  assert.equal(event.status, "error");
  assert.equal(event.course_id, "123");
  assert.equal(event.duration_ms, 42);
  assert.equal(event.argument_keys.includes("body"), true);
  assert.equal(JSON.stringify(event).includes("secret-token"), false);
  assert.equal(JSON.stringify(event).includes("CANVAS_API_TOKEN"), false);
});
