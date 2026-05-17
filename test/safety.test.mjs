import assert from "node:assert/strict";
import test from "node:test";
import {
  assertKnownArguments,
  enforceSafety,
  parseSafetyConfig,
  resolveCanvasToken,
  validateToolArguments,
} from "../dist/safety.js";

test("read-only mode blocks write tools before Canvas is called", () => {
  assert.throws(
    () =>
      enforceSafety("create_page", { course_id: 42, title: "Syllabus" }, parseSafetyConfig({
        CANVAS_READ_ONLY: "true",
      })),
    /read-only mode/i
  );
});

test("confirmation can be required for writes and dry-run bypasses live mutation", () => {
  const config = parseSafetyConfig({ CANVAS_REQUIRE_CONFIRMATION: "true" });

  assert.throws(
    () => enforceSafety("create_module", { course_id: 42, name: "Week 1" }, config),
    /explicit confirmation/i
  );

  assert.deepEqual(
    enforceSafety("create_module", { course_id: 42, name: "Week 1", dry_run: true }, config),
    { dryRun: true }
  );

  assert.deepEqual(
    enforceSafety("create_module", { course_id: 42, name: "Week 1", confirm: true }, config),
    { dryRun: false }
  );
});

test("course and account allowlists reject unapproved ids", () => {
  const config = parseSafetyConfig({
    CANVAS_ALLOWED_COURSE_IDS: "101,202",
    CANVAS_ALLOWED_ACCOUNT_IDS: "7",
  });

  assert.doesNotThrow(() => enforceSafety("get_course", { course_id: "101" }, config));
  assert.doesNotThrow(() => enforceSafety("create_course", { account_id: 7, name: "Shell", dry_run: true }, config));
  assert.throws(
    () => enforceSafety("get_course", { course_id: 303 }, config),
    /not allowed by CANVAS_ALLOWED_COURSE_IDS/
  );
  assert.throws(
    () => enforceSafety("create_course", { account_id: 8, name: "Shell", dry_run: true }, config),
    /not allowed by CANVAS_ALLOWED_ACCOUNT_IDS/
  );
});

test("unknown top-level arguments are rejected for every tool", () => {
  assert.throws(
    () => assertKnownArguments("create_assignment", { course_id: 42, name: "Essay", fields: { workflow_state: "deleted" } }),
    /unknown argument.*fields/i
  );
});

test("update field allowlists cover current page, quiz, and module tools", () => {
  assert.doesNotThrow(() =>
    validateToolArguments("update_page", {
      course_id: 42,
      url_or_id: "syllabus",
      fields: { title: "Syllabus", published: true, notify_of_update: false },
    })
  );
  assert.doesNotThrow(() =>
    validateToolArguments("update_quiz", {
      course_id: 42,
      quiz_id: 11,
      fields: { title: "Quiz 1", allowed_attempts: 2, published: false },
    })
  );
  assert.throws(
    () =>
      validateToolArguments("update_module_item", {
        course_id: 42,
        module_id: 5,
        item_id: 9,
        fields: { title: "Reading", workflow_state: "deleted" },
      }),
    /Unknown fields field: workflow_state/i
  );
});

test("build_course_shell validates nested course shell inputs", () => {
  assert.doesNotThrow(() =>
    validateToolArguments("build_course_shell", {
      course_id: 42,
      assignment_groups: [{ name: "Essays", group_weight: 40 }],
      pages: [{ title: "Welcome", body: "Hello", published: false }],
      modules: [{ name: "Week 1", items: [{ type: "Page", title: "Welcome" }] }],
    })
  );
  assert.throws(
    () =>
      validateToolArguments("build_course_shell", {
        course_id: 42,
        modules: [{ name: "Week 1", items: [{ type: "Page", workflow_state: "deleted" }] }],
      }),
    /Unknown modules 0 items field: workflow_state/i
  );
});

test("rubric criteria reject arbitrary nested keys and unsafe points", () => {
  assert.throws(
    () =>
      validateToolArguments("create_rubric", {
        course_id: 42,
        title: "Rubric",
        criteria: [
          {
            description: "Analysis",
            points: 10,
            ratings: [{ description: "Excellent", points: 12, hidden: true }],
          },
        ],
      }),
    /unknown rubric rating field.*hidden/i
  );

  assert.throws(
    () =>
      validateToolArguments("create_rubric", {
        course_id: 42,
        title: "Rubric",
        use_for_grading: true,
        association_type: "Course",
        criteria: [{ description: "Analysis", points: 10, ratings: [{ description: "Excellent", points: 10 }] }],
      }),
    /grading rubric.*assignment association/i
  );
});

test("grading and quiz reorder validators reject unsafe nested payloads", () => {
  assert.doesNotThrow(() =>
    validateToolArguments("grade_submission_with_rubric", {
      course_id: 42,
      assignment_id: 7,
      user_id: 1001,
      rubric_assessment: [{ criterion_id: "crit_1", points: 4, comments: "Good work" }],
    })
  );
  assert.throws(
    () =>
      validateToolArguments("reorder_quiz_items", {
        course_id: 42,
        quiz_id: 3,
        order: [{ id: 1, type: "question", hidden: true }],
      }),
    /Unknown quiz order field: hidden/i
  );
});

test("token maps can select a course-specific Canvas token", () => {
  const config = parseSafetyConfig({
    CANVAS_API_TOKEN: "default-token",
    CANVAS_API_TOKENS: JSON.stringify({ "42": "course-token", default: "map-default" }),
  });

  assert.equal(resolveCanvasToken({ course_id: 42 }, config), "course-token");
  assert.equal(resolveCanvasToken({ course_id: 99 }, config), "map-default");
});

test("generic Canvas HTML fields allow safe instructional markup", () => {
  assert.doesNotThrow(() =>
    validateToolArguments("create_page", {
      course_id: 42,
      title: "Welcome",
      body: '<h2>Welcome</h2><p>Read the <a href="https://example.edu/syllabus">syllabus</a>.</p><ul><li>Start here</li></ul>',
    })
  );
  assert.doesNotThrow(() =>
    validateToolArguments("create_assignment", {
      course_id: 42,
      name: "Essay",
      description: "<p><strong>Submit</strong> your draft.</p>",
    })
  );
});

test("generic Canvas HTML fields reject scripts events and unsafe URLs", () => {
  assert.throws(
    () =>
      validateToolArguments("create_page", {
        course_id: 42,
        title: "Unsafe",
        body: '<p onclick="alert(1)">Click me</p>',
      }),
    /unsafe html.*event handler/i
  );
  assert.throws(
    () =>
      validateToolArguments("create_assignment", {
        course_id: 42,
        name: "Unsafe",
        description: '<a href="javascript:alert(1)">bad</a>',
      }),
    /unsafe html.*javascript/i
  );
  assert.throws(
    () =>
      validateToolArguments("create_course", {
        account_id: 7,
        name: "Unsafe",
        syllabus_body: "<script>alert(1)</script>",
      }),
    /unsafe html.*script/i
  );
});

test("HTML policy covers update fields quiz descriptions and course shell pages", () => {
  assert.throws(
    () =>
      validateToolArguments("update_page", {
        course_id: 42,
        url_or_id: "welcome",
        fields: { body: "<iframe src=\"https://example.edu\"></iframe>" },
      }),
    /unsafe html.*iframe/i
  );
  assert.throws(
    () =>
      validateToolArguments("create_quiz", {
        course_id: 42,
        title: "Unsafe",
        description: '<img src="data:text/html,evil">',
      }),
    /unsafe html.*data/i
  );
  assert.throws(
    () =>
      validateToolArguments("build_course_shell", {
        course_id: 42,
        pages: [{ title: "Unsafe", body: '<form action="/steal"></form>' }],
      }),
    /unsafe html.*form/i
  );
});
