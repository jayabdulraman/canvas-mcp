# Canvas MCP

Canvas MCP is a Model Context Protocol (MCP) server for the Canvas LMS API.
It lets AI coding/productivity agents safely read course structure and create
common instructional objects (modules, pages, assignments, and rubrics) through
typed tools over stdio.

Built to support education workflows for faculty, course designers, and teams
that want AI-assisted course operations in Canvas.

## Overview

- **Purpose:** Connect AI agents to Canvas LMS through MCP tools.
- **Transport:** stdio (`command` + `args` in your MCP client config).
- **Auth model:** Canvas personal access token via environment variables.
- **Scope today:** Course discovery and creation workflows for key content types.

## Features

### Read tools

- `list_courses`
- `get_course`
- `list_assignments`
- `list_quizzes`
- `list_rubrics`
- `list_modules`
- `list_module_items`

### Create tools

- `create_module`
- `create_module_item`
- `create_page`
- `create_assignment`
- `create_rubric`

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
npm run start   # run compiled server
npm run dev     # watch mode TypeScript compile
```

## Security Notes

- Never commit `.env` with real credentials.
- Use a least-privilege Canvas token scoped to the minimum needed courses.
- Treat write tools (`create_*`) as production-impacting actions.

## Contributing

Contributions are welcome. If you open an issue or PR, include:

- What Canvas workflow you are trying to support
- Expected behavior and actual behavior
- Canvas API endpoint references (if applicable)

## License

Add your preferred OSS license (for example, MIT) before publishing publicly.
