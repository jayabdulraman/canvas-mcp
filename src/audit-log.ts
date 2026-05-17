export interface AuditEventInput {
  toolName: string;
  arguments: Record<string, unknown>;
  status: "success" | "error";
  durationMs: number;
  error?: unknown;
}

export interface AuditEvent {
  event: "canvas_mcp.tool_call";
  timestamp: string;
  tool: string;
  status: "success" | "error";
  duration_ms: number;
  argument_keys: string[];
  course_id?: string;
  account_id?: string;
  module_id?: string;
  assignment_id?: string;
  quiz_id?: string;
  error?: {
    name: string;
    message: string;
  };
}

const SECRET_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key)/i;

export function createAuditEvent(input: AuditEventInput): AuditEvent {
  const args = input.arguments ?? {};
  const event: AuditEvent = {
    event: "canvas_mcp.tool_call",
    timestamp: new Date().toISOString(),
    tool: input.toolName,
    status: input.status,
    duration_ms: input.durationMs,
    argument_keys: Object.keys(args).filter((key) => !SECRET_KEY_PATTERN.test(key)).sort(),
  };

  assignId(event, "course_id", args.course_id);
  assignId(event, "account_id", args.account_id);
  assignId(event, "module_id", args.module_id);
  assignId(event, "assignment_id", args.assignment_id);
  assignId(event, "quiz_id", args.quiz_id);

  if (input.error) {
    event.error = serializeError(input.error);
  }

  return event;
}

export function writeAuditEvent(event: AuditEvent): void {
  if (process.env.CANVAS_MCP_AUDIT_LOG === "false") return;
  console.error(JSON.stringify(event));
}

function assignId(event: AuditEvent, key: "course_id" | "account_id" | "module_id" | "assignment_id" | "quiz_id", value: unknown): void {
  const id = coerceId(value);
  if (id) event[key] = id;
}

function coerceId(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message),
    };
  }

  return {
    name: "Error",
    message: redactSecrets(String(error)),
  };
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:CANVAS_API_TOKEN|api[_-]?token|access[_-]?token)\s*[=:]\s*[^,\s]+/gi, "[REDACTED_TOKEN]");
}
