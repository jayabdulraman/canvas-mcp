# Canvas MCP

Canvas MCP is a Model Context Protocol (MCP) server for the Canvas LMS API.
It lets AI coding/productivity agents safely read course structure, build course
shells, design Canvas pages, manage classic quizzes, and grade text/URL
submissions with rubrics through typed tools over stdio.

Built to support education workflows for faculty, course designers, and teams
that want AI-assisted course operations in Canvas.

## Overview

- **Purpose:** Connect AI agents to Canvas LMS through MCP tools.
- **Transport:** stdio (`command` + `args` in your MCP client config).
- **Auth model:** Canvas personal access token via environment variables.
- **Scope today:** Course buildout, branded page authoring, classic quiz
  management, and text/URL submission grading workflows.

### Demo

[Watch demo](https://screen.studio/share/v7EvSqQz)

## Features

### Read tools

- `list_courses`
- `get_course`
- `list_assignments`
- `list_quizzes`
- `get_quiz`
- `list_quiz_questions`
- `list_rubrics`
- `list_modules`
- `list_module_items`
- `list_assignment_groups`
- `list_pages`
- `get_page`
- `get_brand_variables`
- `list_submissions`
- `get_submission`

### Course build tools

- `create_course`
- `update_course`
- `build_course_shell`
- `create_assignment_group`
- `update_assignment_group`

- `create_module`
- `update_module`
- `delete_module`
- `create_module_item`
- `update_module_item`
- `delete_module_item`

### Page and brand tools

- `create_page`
- `update_page`
- `set_front_page`
- `create_branded_page`

### Assignment and rubric tools

- `create_assignment`
- `create_rubric`
- `grade_submission_with_rubric`

### Classic quiz tools

- `create_quiz`
- `update_quiz`
- `delete_quiz`
- `create_quiz_question`
- `update_quiz_question`
- `delete_quiz_question`
- `reorder_quiz_items`

## Requirements

- Node.js 18+ (Node 20+ recommended)
- A Canvas LMS instance URL
- A Canvas API token with permissions for the courses you need

## Setup

1. **Clone and install dependencies**

   ```bash
   git clone <your-repo-url>
   cd canvas-mcp
   npm install
   ```

2. **Create your environment file**

   ```bash
   cp .env.example .env
   ```

3. **Set your Canvas credentials in `.env`**

   ```env
   CANVAS_BASE_URL=https://yourschool.instructure.com
   CANVAS_API_TOKEN=your_canvas_api_token_here
   CANVAS_READ_ONLY=false
   CANVAS_REQUIRE_CONFIRMATION=false
   CANVAS_DRY_RUN=false
   CANVAS_MCP_AUDIT_LOG=true
   ```

4. **Build**

   ```bash
   npm run build
   ```

## Configure With AI Agents

The server runs over stdio. In every client, point to the built entrypoint:
`dist/index.js`.

### Claude Desktop

Add this in your Claude MCP config (often `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "canvas-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-mcp/dist/index.js"],
      "env": {
        "CANVAS_BASE_URL": "https://yourschool.instructure.com",
        "CANVAS_API_TOKEN": "your_canvas_api_token_here"
      }
    }
  }
}
```

### Cursor

Add this in your Cursor MCP config (workspace or user-level MCP settings):

```json
{
  "mcpServers": {
    "canvas-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-mcp/dist/index.js"],
      "env": {
        "CANVAS_BASE_URL": "https://yourschool.instructure.com",
        "CANVAS_API_TOKEN": "your_canvas_api_token_here"
      }
    }
  }
}
```

### Codex

For Codex environments that support MCP stdio servers, register the same
process command and env vars:

- `command`: `node`
- `args`: `["/absolute/path/to/canvas-mcp/dist/index.js"]`
- `env`: `CANVAS_BASE_URL`, `CANVAS_API_TOKEN`

If your Codex host expects a different config shape, keep these exact values
and map them into that host's MCP server schema.

## Development

- TypeScript source lives in `src/`
- Build output goes to `dist/`

Useful scripts:

```bash
npm run build   # compile TypeScript
npm test        # compile and run the node:test suite
npm run start   # run compiled server
npm run dev     # watch mode TypeScript compile
npm run smoke   # non-destructive compile smoke check
```

## Example Prompts

Once the MCP is configured in your AI agent, try:

- "List my active teacher courses and show the modules for the course named BIO 101."
- "Create a week 1 module with a welcome page, readings page, and assignment placeholder."
- "Create a branded Canvas page using ASU colors with sections for outcomes, weekly tasks, and support resources."
- "Create a classic quiz with five multiple-choice questions and keep it unpublished."
- "Read this student's text submission and draft rubric row scores with comments before posting the grade."

## Permissions

Canvas permissions depend on your role and institution configuration:

- Course-shell creation (`create_course`) usually requires account/admin-level access.
- Course content tools require teacher, designer, or equivalent permissions in the course.
- Grading tools require permission to manage grades.
- Brand variable reads may be available at course, account, or domain level depending on Canvas settings.

## Production Safety

Write tools validate top-level arguments against explicit allowlists before
calling Canvas. Update-style tools (`update_page`, `update_quiz`,
`update_module_item`, and related tools) also validate their `fields` objects,
and nested payloads such as rubric criteria, rubric grading rows, quiz reorder
items, and `build_course_shell` module/page/group entries reject unknown keys.

Recommended production controls:

- Start with `CANVAS_READ_ONLY=true` while connecting a new MCP client.
- Use `CANVAS_ALLOWED_COURSE_IDS` and `CANVAS_ALLOWED_ACCOUNT_IDS` to pin the
  server to known Canvas resources.
- Set `CANVAS_REQUIRE_CONFIRMATION=true` so live write tools must include
  `confirm: true` or `confirmation: "CONFIRM"`.
- Use `CANVAS_DRY_RUN=true`, or pass `dry_run: true` on a write call, to
  validate the request and return the planned action without mutating Canvas.
- Use `CANVAS_API_TOKENS` when one server needs different tokens by course or
  account. Keys may be course IDs, `account:<id>`, or `default`; a matching
  course token wins over the default token. `CANVAS_API_TOKEN` remains the
  simple default-token option.

## Throttling And Retries

The Canvas client applies a request timeout, retries transient failures
(`408`, `425`, `429`, `5xx`), honors `Retry-After`, and caps pagination to a
safe maximum. If Canvas still reports a pagination overflow, the client throws a
typed `CanvasPaginationError` rather than silently returning a partial list.
Canvas can throttle at token, user, and account levels, so keep write-heavy MCP
workflows serialized and avoid parallel retry storms.

## Audit Logging

Tool calls emit structured JSON audit events to stderr by default. Events
include tool name, status, duration, argument keys, and resource IDs such as
`course_id`, `assignment_id`, and `quiz_id` when present. Raw argument values
and token-like fields are not logged, and error messages are redacted for common
token patterns. Set `CANVAS_MCP_AUDIT_LOG=false` only if your MCP host captures
equivalent audit events elsewhere.

## HTML Policy

`create_branded_page` renders a constrained Canvas page template from structured
sections. Titles, headings, section body text, callouts, and link labels are
escaped; unsafe URLs such as `javascript:` and `data:` are dropped; and brand
colors/fonts are restricted before they are written into inline styles.

Generic Canvas HTML fields such as `create_page.body`, `set_front_page.body`,
assignment and quiz descriptions, quiz question text/comments, syllabus bodies,
and `build_course_shell` page bodies are validated before any Canvas write.
The validator allows common instructional Canvas markup such as paragraphs,
headings, lists, tables, links, images, and emphasis tags, while rejecting unsafe
tags and attributes such as scripts, iframes, forms, event handlers, inline
styles, `srcdoc`, `srcset`, and `javascript:`, `data:`, or `vbscript:` URLs.

## Grading Safety

`grade_submission_with_rubric` is intentionally narrow in v1:

- It only grades `online_text_entry` and `online_url` submissions.
- It requires explicit rubric row IDs and row-level points, ratings, or comments.
- It posts through Canvas submissions update API with `submission[posted_grade]`,
  `comment[text_comment]`, and `rubric_assessment`.
- It does not download or evaluate files, media, or annotation submissions.

## Security Notes

- Never commit `.env` with real credentials.
- Use a least-privilege Canvas token scoped to the minimum needed courses.
- Treat write tools (`create_*`, `update_*`, `delete_*`, grading, and course-shell builders) as production-impacting actions.

## Contributing

Contributions are welcome. If you open an issue or PR, include:

- What Canvas workflow you are trying to support
- Expected behavior and actual behavior
- Canvas API endpoint references (if applicable)

## License

Add your preferred OSS license (for example, MIT) before publishing publicly.
