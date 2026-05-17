#!/usr/bin/env node
/**
 * Canvas LMS MCP Server
 *
 * Exposes Canvas LMS functionality as MCP tools so AI assistants can
 * help faculty find and create course content.
 *
 * Required environment variables:
 *   CANVAS_BASE_URL  – e.g. https://yourschool.instructure.com
 *   CANVAS_API_TOKEN – Canvas API access token (Settings → New Access Token)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createAuditEvent, writeAuditEvent } from "./audit-log.js";
import { CanvasClient } from "./canvas-client.js";
import { renderBrandedPage, type BrandedPageInput } from "./html-template.js";
import {
  dryRunResult,
  enforceSafety,
  isKnownTool,
  normalizeToolArguments,
  parseSafetyConfig,
  resolveCanvasToken,
  type SafetyConfig,
} from "./safety.js";

// -----------------------------------------------------------------------
// Bootstrap the Canvas client from environment variables
// -----------------------------------------------------------------------

const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL ?? "";
let safetyConfig: SafetyConfig;

try {
  safetyConfig = parseSafetyConfig(process.env);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[canvas-mcp] ERROR: ${message}`);
  process.exit(1);
}

const hasCanvasToken = Boolean(
  safetyConfig.defaultToken || (safetyConfig.tokenMap && Object.keys(safetyConfig.tokenMap).length > 0)
);

if (!CANVAS_BASE_URL || !hasCanvasToken) {
  console.error(
    "[canvas-mcp] ERROR: CANVAS_BASE_URL and CANVAS_API_TOKEN or CANVAS_API_TOKENS must be set.\n" +
    "  export CANVAS_BASE_URL=https://yourschool.instructure.com\n" +
    "  export CANVAS_API_TOKEN=your_token_here"
  );
  process.exit(1);
}

// -----------------------------------------------------------------------
// MCP Server
// -----------------------------------------------------------------------

const server = new Server(
  { name: "canvas-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const WRITE_SAFETY_PROPERTIES = {
  dry_run: {
    type: "boolean",
    description: "Validate the write request and return the planned action without calling Canvas.",
  },
  confirm: {
    type: "boolean",
    description: "Set to true when CANVAS_REQUIRE_CONFIRMATION is enabled and you intend to mutate Canvas.",
  },
  confirmation: {
    type: "string",
    enum: ["CONFIRM"],
    description: "Alternative explicit confirmation token for production write tools.",
  },
};

// -----------------------------------------------------------------------
// Tool definitions
// -----------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── READ ────────────────────────────────────────────────────────────
    {
      name: "list_courses",
      description:
        "List Canvas courses available to the authenticated user. " +
        "Faculty typically see their active taught courses. " +
        "Filter by enrollment state or workflow state as needed.",
      inputSchema: {
        type: "object",
        properties: {
          enrollment_type: {
            type: "string",
            enum: ["teacher", "student", "ta", "observer", "designer"],
            description: "Filter courses by enrollment role.",
          },
          enrollment_state: {
            type: "string",
            enum: ["active", "invited", "completed"],
            description: "Filter courses by enrollment state.",
          },
          state: {
            type: "array",
            items: {
              type: "string",
              enum: ["unpublished", "available", "completed", "deleted"],
            },
            description: "Filter by course workflow state.",
          },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["term", "teachers", "total_students", "course_image", "public_description"],
            },
            description: "Extra fields to include in the response.",
          },
        },
      },
    },
    {
      name: "get_course",
      description: "Get details for a single Canvas course by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
        },
        required: ["course_id"],
      },
    },
    {
      name: "list_assignments",
      description: "List all assignments in a Canvas course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          search_term: {
            type: "string",
            description: "Filter assignments by name.",
          },
          order_by: {
            type: "string",
            enum: ["position", "name", "due_at"],
            description: "Sort order for the results.",
          },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["submission", "assignment_visibility", "overrides", "observed_users"],
            },
            description: "Extra fields to include.",
          },
        },
        required: ["course_id"],
      },
    },
    {
      name: "list_quizzes",
      description: "List all quizzes in a Canvas course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          search_term: {
            type: "string",
            description: "Filter quizzes by title.",
          },
        },
        required: ["course_id"],
      },
    },
    {
      name: "list_rubrics",
      description: "List all rubrics in a Canvas course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "assessments",
                "graded_assessments",
                "peer_assessments",
                "associations",
                "assignment_associations",
                "learning_outcome_alignments",
              ],
            },
            description: "Extra data to include.",
          },
          style: {
            type: "string",
            enum: ["full", "comments_only"],
            description: "Assessment style to include.",
          },
        },
        required: ["course_id"],
      },
    },
    {
      name: "list_modules",
      description: "List all modules in a Canvas course, optionally including their items.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["items", "content_details"],
            },
            description: "Set to [\"items\"] to include module items inline.",
          },
          search_term: {
            type: "string",
            description: "Filter modules by name.",
          },
        },
        required: ["course_id"],
      },
    },
    {
      name: "list_module_items",
      description: "List all items inside a specific module.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          module_id: {
            type: ["string", "number"],
            description: "The module ID.",
          },
        },
        required: ["course_id", "module_id"],
      },
    },

    // ── CREATE ───────────────────────────────────────────────────────────
    {
      name: "create_module",
      description: "Create a new module in a Canvas course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          name: {
            type: "string",
            description: "Name of the new module.",
          },
          unlock_at: {
            type: "string",
            description: "ISO 8601 datetime when the module unlocks (e.g. 2025-08-26T00:00:00Z).",
          },
          position: {
            type: "number",
            description: "Position of the module in the course (1-indexed).",
          },
          require_sequential_progress: {
            type: "boolean",
            description: "Require students to complete items in order.",
          },
          prerequisite_module_ids: {
            type: "array",
            items: { type: "number" },
            description: "IDs of modules that must be completed before this one unlocks.",
          },
          publish_final_grade: {
            type: "boolean",
            description: "Publish the final grade when this module is completed.",
          },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "name"],
      },
    },
    {
      name: "create_module_item",
      description:
        "Add an item to an existing module. " +
        "Supported types: File, Page, Discussion, Assignment, Quiz, SubHeader, ExternalUrl, ExternalTool. " +
        "Use page_url for Page items; use external_url for ExternalUrl items; " +
        "use content_id for Assignment, Quiz, Discussion, File items.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          module_id: {
            type: ["string", "number"],
            description: "The module ID to add the item to.",
          },
          type: {
            type: "string",
            enum: ["File", "Page", "Discussion", "Assignment", "Quiz", "SubHeader", "ExternalUrl", "ExternalTool"],
            description: "Type of content being added.",
          },
          title: {
            type: "string",
            description: "Display title for the item.",
          },
          content_id: {
            type: "number",
            description: "ID of the Canvas content object (Assignment, Quiz, etc.). Not needed for Page, ExternalUrl, SubHeader.",
          },
          page_url: {
            type: "string",
            description: "URL slug of the page (required when type is Page).",
          },
          external_url: {
            type: "string",
            description: "Full URL (required when type is ExternalUrl).",
          },
          new_tab: {
            type: "boolean",
            description: "Open ExternalUrl in a new tab.",
          },
          position: {
            type: "number",
            description: "Position within the module (1-indexed).",
          },
          indent: {
            type: "number",
            description: "Visual indent level (0–5).",
          },
          completion_requirement_type: {
            type: "string",
            enum: ["must_view", "must_contribute", "must_submit", "must_mark_done", "min_score"],
            description: "Type of completion requirement for this item.",
          },
          completion_requirement_min_score: {
            type: "number",
            description: "Minimum score (only used when completion_requirement_type is min_score).",
          },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "module_id", "type"],
      },
    },
    {
      name: "create_page",
      description: "Create a new wiki page in a Canvas course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          title: {
            type: "string",
            description: "Title of the page.",
          },
          body: {
            type: "string",
            description: "HTML body content of the page.",
          },
          editing_roles: {
            type: "string",
            enum: ["teachers", "students", "members", "public"],
            description: "Who can edit the page.",
          },
          published: {
            type: "boolean",
            description: "Publish the page immediately (default: false).",
          },
          front_page: {
            type: "boolean",
            description: "Set this page as the course front page.",
          },
          notify_of_update: {
            type: "boolean",
            description: "Send a notification when the page is updated.",
          },
          publish_at: {
            type: "string",
            description: "ISO 8601 datetime to auto-publish the page.",
          },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "title"],
      },
    },
    {
      name: "create_assignment",
      description: "Create a new assignment in a Canvas course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          name: {
            type: "string",
            description: "Name of the assignment.",
          },
          description: {
            type: "string",
            description: "HTML description / instructions for the assignment.",
          },
          points_possible: {
            type: "number",
            description: "Maximum points for the assignment.",
          },
          grading_type: {
            type: "string",
            enum: ["points", "percent", "letter_grade", "gpa_scale", "pass_fail", "not_graded"],
            description: "Grading scale type.",
          },
          submission_types: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "none",
                "online_upload",
                "online_text_entry",
                "online_url",
                "online_quiz",
                "media_recording",
                "student_annotation",
                "on_paper",
                "external_tool",
                "discussion_topic",
              ],
            },
            description: "Allowed submission methods.",
          },
          due_at: {
            type: "string",
            description: "ISO 8601 due date/time.",
          },
          lock_at: {
            type: "string",
            description: "ISO 8601 date/time after which submissions are locked.",
          },
          unlock_at: {
            type: "string",
            description: "ISO 8601 date/time when the assignment becomes visible.",
          },
          published: {
            type: "boolean",
            description: "Publish the assignment immediately.",
          },
          allowed_attempts: {
            type: "number",
            description: "Max submission attempts. Use -1 for unlimited.",
          },
          allowed_extensions: {
            type: "array",
            items: { type: "string" },
            description: "Allowed file extensions for upload submissions (e.g. [\"pdf\", \"docx\"]).",
          },
          peer_reviews: {
            type: "boolean",
            description: "Enable peer reviews.",
          },
          anonymous_grading: {
            type: "boolean",
            description: "Hide student names from graders.",
          },
          assignment_group_id: {
            type: "number",
            description: "Assignment group to place this assignment in.",
          },
          position: {
            type: "number",
            description: "Position within the assignment group.",
          },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "name"],
      },
    },
    {
      name: "create_rubric",
      description:
        "Create a new rubric in a Canvas course. " +
        "Optionally attach it to an assignment for grading.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: {
            type: ["string", "number"],
            description: "The Canvas course ID.",
          },
          title: {
            type: "string",
            description: "Title of the rubric.",
          },
          free_form_criterion_comments: {
            type: "boolean",
            description: "Allow free-form text comments instead of selecting a rating.",
          },
          criteria: {
            type: "array",
            description: "List of rubric criteria.",
            items: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "Short name of the criterion.",
                },
                long_description: {
                  type: "string",
                  description: "Detailed explanation of the criterion.",
                },
                points: {
                  type: "number",
                  description: "Maximum points for this criterion.",
                },
                ratings: {
                  type: "array",
                  description: "Rating levels from highest to lowest.",
                  items: {
                    type: "object",
                    properties: {
                      description: { type: "string", description: "Label for this rating level." },
                      points: { type: "number", description: "Points awarded at this level." },
                    },
                    required: ["description", "points"],
                  },
                },
              },
              required: ["description", "points", "ratings"],
            },
          },
          association_id: {
            type: "number",
            description: "ID of an assignment or course to associate the rubric with.",
          },
          association_type: {
            type: "string",
            enum: ["Assignment", "Course", "Account"],
            description: "Type of object being associated (default: Course).",
          },
          use_for_grading: {
            type: "boolean",
            description: "Use the rubric to calculate the assignment grade.",
          },
          hide_score_total: {
            type: "boolean",
            description: "Hide the total score from students.",
          },
          purpose: {
            type: "string",
            enum: ["grading", "bookmark"],
            description: "Purpose of the rubric association.",
          },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "title"],
      },
    },
    {
      name: "create_course",
      description: "Create a new Canvas course in an account. Requires account-level permissions.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: ["string", "number"], description: "Canvas account ID." },
          name: { type: "string", description: "Course name." },
          course_code: { type: "string", description: "Short course code." },
          start_at: { type: "string", description: "ISO 8601 course start date." },
          end_at: { type: "string", description: "ISO 8601 course end date." },
          syllabus_body: { type: "string", description: "HTML syllabus body." },
          default_view: { type: "string", enum: ["feed", "wiki", "modules", "syllabus", "assignments"], description: "Canvas course home view." },
          is_public: { type: "boolean" },
          public_syllabus: { type: "boolean" },
          restrict_enrollments_to_course_dates: { type: "boolean" },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["account_id", "name"],
      },
    },
    {
      name: "update_course",
      description: "Update core Canvas course settings.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"], description: "Canvas course ID." },
          fields: { type: "object", description: "Course fields to update, using snake_case Canvas names." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "fields"],
      },
    },
    {
      name: "list_assignment_groups",
      description: "List assignment groups in a course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          include: { type: "array", items: { type: "string" } },
        },
        required: ["course_id"],
      },
    },
    {
      name: "create_assignment_group",
      description: "Create an assignment group in a course.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          name: { type: "string" },
          position: { type: "number" },
          group_weight: { type: "number" },
          sis_source_id: { type: "string" },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "name"],
      },
    },
    {
      name: "update_assignment_group",
      description: "Update an assignment group.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          assignment_group_id: { type: ["string", "number"] },
          fields: { type: "object", description: "Assignment group fields to update." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "assignment_group_id", "fields"],
      },
    },
    {
      name: "update_module",
      description: "Update a Canvas module.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          module_id: { type: ["string", "number"] },
          fields: { type: "object", description: "Module fields to update." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "module_id", "fields"],
      },
    },
    {
      name: "delete_module",
      description: "Delete a Canvas module.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          module_id: { type: ["string", "number"] },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "module_id"],
      },
    },
    {
      name: "update_module_item",
      description: "Update an item inside a Canvas module.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          module_id: { type: ["string", "number"] },
          item_id: { type: ["string", "number"] },
          fields: { type: "object", description: "Module item fields to update." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "module_id", "item_id", "fields"],
      },
    },
    {
      name: "delete_module_item",
      description: "Delete an item from a Canvas module.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          module_id: { type: ["string", "number"] },
          item_id: { type: ["string", "number"] },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "module_id", "item_id"],
      },
    },
    {
      name: "build_course_shell",
      description: "Create an ordered course skeleton from modules, assignment groups, and starter pages.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          assignment_groups: { type: "array", items: { type: "object" } },
          pages: { type: "array", items: { type: "object" } },
          modules: { type: "array", items: { type: "object" } },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id"],
      },
    },
    {
      name: "list_pages",
      description: "List Canvas course pages.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          search_term: { type: "string" },
          include: { type: "array", items: { type: "string", enum: ["body"] } },
        },
        required: ["course_id"],
      },
    },
    {
      name: "get_page",
      description: "Get a Canvas page by URL slug or page_id:<id>.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          url_or_id: { type: ["string", "number"] },
        },
        required: ["course_id", "url_or_id"],
      },
    },
    {
      name: "update_page",
      description: "Update a Canvas page.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          url_or_id: { type: ["string", "number"] },
          fields: { type: "object", description: "Page fields to update." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "url_or_id", "fields"],
      },
    },
    {
      name: "set_front_page",
      description: "Update/create the course front page.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          title: { type: "string" },
          body: { type: "string" },
          published: { type: "boolean" },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "title", "body"],
      },
    },
    {
      name: "get_brand_variables",
      description: "Read Canvas brand variables for a course, account, or current domain.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          account_id: { type: ["string", "number"] },
        },
      },
    },
    {
      name: "create_branded_page",
      description: "Create a Canvas page from structured sections and brand guideline tokens.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          title: { type: "string" },
          subtitle: { type: "string" },
          guidelines: { type: "object" },
          sections: { type: "array", items: { type: "object" } },
          published: { type: "boolean" },
          front_page: { type: "boolean" },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "title", "sections"],
      },
    },
    {
      name: "get_quiz",
      description: "Get a single classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
        },
        required: ["course_id", "quiz_id"],
      },
    },
    {
      name: "create_quiz",
      description: "Create a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          title: { type: "string" },
          quiz_type: { type: "string", enum: ["practice_quiz", "assignment", "graded_survey", "survey"] },
          description: { type: "string" },
          assignment_group_id: { type: "number" },
          time_limit: { type: "number" },
          allowed_attempts: { type: "number" },
          due_at: { type: "string" },
          unlock_at: { type: "string" },
          lock_at: { type: "string" },
          published: { type: "boolean" },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "title"],
      },
    },
    {
      name: "update_quiz",
      description: "Update a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
          fields: { type: "object", description: "Quiz fields to update." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "quiz_id", "fields"],
      },
    },
    {
      name: "delete_quiz",
      description: "Delete a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "quiz_id"],
      },
    },
    {
      name: "list_quiz_questions",
      description: "List questions in a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
        },
        required: ["course_id", "quiz_id"],
      },
    },
    {
      name: "create_quiz_question",
      description: "Create a question in a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
          question: { type: "object", description: "Canvas quiz question fields." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "quiz_id", "question"],
      },
    },
    {
      name: "update_quiz_question",
      description: "Update a question in a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
          question_id: { type: ["string", "number"] },
          question: { type: "object", description: "Question fields to update." },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "quiz_id", "question_id", "question"],
      },
    },
    {
      name: "delete_quiz_question",
      description: "Delete a question from a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
          question_id: { type: ["string", "number"] },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "quiz_id", "question_id"],
      },
    },
    {
      name: "reorder_quiz_items",
      description: "Reorder questions or groups in a classic Canvas quiz.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          quiz_id: { type: ["string", "number"] },
          order: { type: "array", items: { type: "object" } },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "quiz_id", "order"],
      },
    },
    {
      name: "list_submissions",
      description: "List assignment submissions, optionally including user and rubric data.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          assignment_id: { type: ["string", "number"] },
          include: { type: "array", items: { type: "string" } },
        },
        required: ["course_id", "assignment_id"],
      },
    },
    {
      name: "get_submission",
      description: "Get one assignment submission by user ID.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          assignment_id: { type: ["string", "number"] },
          user_id: { type: ["string", "number"] },
          include: { type: "array", items: { type: "string" } },
        },
        required: ["course_id", "assignment_id", "user_id"],
      },
    },
    {
      name: "grade_submission_with_rubric",
      description: "Grade a text-entry or URL submission with rubric row scores and comments.",
      inputSchema: {
        type: "object",
        properties: {
          course_id: { type: ["string", "number"] },
          assignment_id: { type: ["string", "number"] },
          user_id: { type: ["string", "number"] },
          posted_grade: { type: "string" },
          text_comment: { type: "string" },
          rubric_assessment: { type: "array", items: { type: "object" } },
          ...WRITE_SAFETY_PROPERTIES,
        },
        required: ["course_id", "assignment_id", "user_id", "rubric_assessment"],
      },
    },
  ],
}));

// -----------------------------------------------------------------------
// Tool execution
// -----------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs = {} } = request.params;
  const startedAt = Date.now();
  let args: Record<string, unknown> = {};
  let auditStatus: "success" | "error" = "success";
  let auditError: unknown;

  try {
    args = normalizeToolArguments(rawArgs);
    if (!isKnownTool(name)) {
      auditStatus = "error";
      auditError = new Error(`Unknown tool: ${name}`);
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const safetyDecision = enforceSafety(name, args, safetyConfig);
    if (safetyDecision.dryRun) {
      return json(dryRunResult(name, args));
    }

    const canvas = canvasFor(args);

    switch (name) {
      // ── READ ──────────────────────────────────────────────────────────

      case "list_courses": {
        const courses = await canvas.listCourses({
          enrollmentType: args.enrollment_type as string | undefined,
          enrollmentState: args.enrollment_state as string | undefined,
          state: args.state as string[] | undefined,
          include: args.include as string[] | undefined,
        });
        return json(courses);
      }

      case "get_course": {
        const course = await canvas.getCourse(args.course_id as string | number);
        return json(course);
      }

      case "list_assignments": {
        const assignments = await canvas.listAssignments(
          args.course_id as string | number,
          {
            searchTerm: args.search_term as string | undefined,
            orderBy: args.order_by as string | undefined,
            include: args.include as string[] | undefined,
          }
        );
        return json(assignments);
      }

      case "list_quizzes": {
        const quizzes = await canvas.listQuizzes(
          args.course_id as string | number,
          { searchTerm: args.search_term as string | undefined }
        );
        return json(quizzes);
      }

      case "list_rubrics": {
        const rubrics = await canvas.listRubrics(
          args.course_id as string | number,
          {
            include: args.include as string[] | undefined,
            style: args.style as string | undefined,
          }
        );
        return json(rubrics);
      }

      case "list_modules": {
        const modules = await canvas.listModules(
          args.course_id as string | number,
          {
            include: args.include as string[] | undefined,
            searchTerm: args.search_term as string | undefined,
          }
        );
        return json(modules);
      }

      case "list_module_items": {
        const items = await canvas.listModuleItems(
          args.course_id as string | number,
          args.module_id as string | number
        );
        return json(items);
      }

      // ── CREATE ────────────────────────────────────────────────────────

      case "create_module": {
        const mod = await canvas.createModule(
          args.course_id as string | number,
          {
            name: args.name as string,
            unlockAt: args.unlock_at as string | undefined,
            position: args.position as number | undefined,
            requireSequentialProgress: args.require_sequential_progress as boolean | undefined,
            prerequisiteModuleIds: args.prerequisite_module_ids as number[] | undefined,
            publishFinalGrade: args.publish_final_grade as boolean | undefined,
          }
        );
        return json(mod);
      }

      case "create_module_item": {
        const item = await canvas.createModuleItem(
          args.course_id as string | number,
          args.module_id as string | number,
          {
            type: args.type as string,
            title: args.title as string | undefined,
            contentId: args.content_id as number | undefined,
            position: args.position as number | undefined,
            indent: args.indent as number | undefined,
            pageUrl: args.page_url as string | undefined,
            externalUrl: args.external_url as string | undefined,
            newTab: args.new_tab as boolean | undefined,
            completionRequirementType: args.completion_requirement_type as string | undefined,
            completionRequirementMinScore: args.completion_requirement_min_score as number | undefined,
          }
        );
        return json(item);
      }

      case "create_page": {
        const page = await canvas.createPage(
          args.course_id as string | number,
          {
            title: args.title as string,
            body: args.body as string | undefined,
            editingRoles: args.editing_roles as string | undefined,
            published: args.published as boolean | undefined,
            frontPage: args.front_page as boolean | undefined,
            notifyOfUpdate: args.notify_of_update as boolean | undefined,
            publishAt: args.publish_at as string | undefined,
          }
        );
        return json(page);
      }

      case "create_assignment": {
        const assignment = await canvas.createAssignment(
          args.course_id as string | number,
          {
            name: args.name as string,
            description: args.description as string | undefined,
            pointsPossible: args.points_possible as number | undefined,
            gradingType: args.grading_type as string | undefined,
            submissionTypes: args.submission_types as string[] | undefined,
            dueAt: args.due_at as string | undefined,
            lockAt: args.lock_at as string | undefined,
            unlockAt: args.unlock_at as string | undefined,
            published: args.published as boolean | undefined,
            allowedAttempts: args.allowed_attempts as number | undefined,
            allowedExtensions: args.allowed_extensions as string[] | undefined,
            peerReviews: args.peer_reviews as boolean | undefined,
            anonymousGrading: args.anonymous_grading as boolean | undefined,
            assignmentGroupId: args.assignment_group_id as number | undefined,
            position: args.position as number | undefined,
          }
        );
        return json(assignment);
      }

      case "create_rubric": {
        const result = await canvas.createRubric(
          args.course_id as string | number,
          {
            title: args.title as string,
            freeFormCriterionComments: args.free_form_criterion_comments as boolean | undefined,
            criteria: args.criteria as Array<{
              description: string;
              long_description?: string;
              points: number;
              ratings: Array<{ description: string; points: number }>;
            }> | undefined,
            associationId: args.association_id as number | undefined,
            associationType: args.association_type as string | undefined,
            useForGrading: args.use_for_grading as boolean | undefined,
            hideScoreTotal: args.hide_score_total as boolean | undefined,
            purpose: args.purpose as string | undefined,
          }
        );
        return json(result);
      }

      case "create_course": {
        const course = await canvas.createCourse(args.account_id as string | number, camelizeObject({
          name: args.name,
          course_code: args.course_code,
          start_at: args.start_at,
          end_at: args.end_at,
          syllabus_body: args.syllabus_body,
          default_view: args.default_view,
          is_public: args.is_public,
          public_syllabus: args.public_syllabus,
          restrict_enrollments_to_course_dates: args.restrict_enrollments_to_course_dates,
        }) as { name: string });
        return json(course);
      }

      case "update_course": {
        const course = await canvas.updateCourse(
          args.course_id as string | number,
          camelizeObject(assertObject(args.fields, "fields"))
        );
        return json(course);
      }

      case "list_assignment_groups": {
        const groups = await canvas.listAssignmentGroups(args.course_id as string | number, {
          include: args.include as string[] | undefined,
        });
        return json(groups);
      }

      case "create_assignment_group": {
        const group = await canvas.createAssignmentGroup(args.course_id as string | number, camelizeObject({
          name: args.name,
          position: args.position,
          group_weight: args.group_weight,
          sis_source_id: args.sis_source_id,
        }) as { name: string });
        return json(group);
      }

      case "update_assignment_group": {
        const group = await canvas.updateAssignmentGroup(
          args.course_id as string | number,
          args.assignment_group_id as string | number,
          camelizeObject(assertObject(args.fields, "fields"))
        );
        return json(group);
      }

      case "update_module": {
        const mod = await canvas.updateModule(
          args.course_id as string | number,
          args.module_id as string | number,
          camelizeObject(assertObject(args.fields, "fields"))
        );
        return json(mod);
      }

      case "delete_module": {
        const mod = await canvas.deleteModule(
          args.course_id as string | number,
          args.module_id as string | number
        );
        return json(mod);
      }

      case "update_module_item": {
        const item = await canvas.updateModuleItem(
          args.course_id as string | number,
          args.module_id as string | number,
          args.item_id as string | number,
          camelizeObject(assertObject(args.fields, "fields"))
        );
        return json(item);
      }

      case "delete_module_item": {
        const item = await canvas.deleteModuleItem(
          args.course_id as string | number,
          args.module_id as string | number,
          args.item_id as string | number
        );
        return json(item);
      }

      case "build_course_shell": {
        const result = await buildCourseShell(canvas, args);
        return json(result);
      }

      case "list_pages": {
        const pages = await canvas.listPages(args.course_id as string | number, {
          searchTerm: args.search_term as string | undefined,
          include: args.include as string[] | undefined,
        });
        return json(pages);
      }

      case "get_page": {
        const page = await canvas.getPage(
          args.course_id as string | number,
          args.url_or_id as string | number
        );
        return json(page);
      }

      case "update_page": {
        const page = await canvas.updatePage(
          args.course_id as string | number,
          args.url_or_id as string | number,
          camelizeObject(assertObject(args.fields, "fields"))
        );
        return json(page);
      }

      case "set_front_page": {
        const page = await canvas.setFrontPage(args.course_id as string | number, camelizeObject({
          title: args.title,
          body: args.body,
          published: args.published,
        }));
        return json(page);
      }

      case "get_brand_variables": {
        const variables = await canvas.getBrandVariables({
          courseId: args.course_id as string | number | undefined,
          accountId: args.account_id as string | number | undefined,
        });
        return json(variables);
      }

      case "create_branded_page": {
        const pageInput: BrandedPageInput = {
          title: args.title as string,
          subtitle: args.subtitle as string | undefined,
          guidelines: assertOptionalObject(args.guidelines),
          sections: assertArray(args.sections, "sections") as BrandedPageInput["sections"],
        };
        const body = renderBrandedPage(pageInput);
        const page = await canvas.createPage(args.course_id as string | number, {
          title: pageInput.title,
          body,
          published: args.published as boolean | undefined,
          frontPage: args.front_page as boolean | undefined,
        });
        return json(page);
      }

      case "get_quiz": {
        const quiz = await canvas.getQuiz(
          args.course_id as string | number,
          args.quiz_id as string | number
        );
        return json(quiz);
      }

      case "create_quiz": {
        const quiz = await canvas.createQuiz(args.course_id as string | number, camelizeObject({
          title: args.title,
          quiz_type: args.quiz_type,
          description: args.description,
          assignment_group_id: args.assignment_group_id,
          time_limit: args.time_limit,
          allowed_attempts: args.allowed_attempts,
          due_at: args.due_at,
          unlock_at: args.unlock_at,
          lock_at: args.lock_at,
          published: args.published,
        }) as { title: string });
        return json(quiz);
      }

      case "update_quiz": {
        const quiz = await canvas.updateQuiz(
          args.course_id as string | number,
          args.quiz_id as string | number,
          camelizeObject(assertObject(args.fields, "fields"))
        );
        return json(quiz);
      }

      case "delete_quiz": {
        const quiz = await canvas.deleteQuiz(
          args.course_id as string | number,
          args.quiz_id as string | number
        );
        return json(quiz);
      }

      case "list_quiz_questions": {
        const questions = await canvas.listQuizQuestions(
          args.course_id as string | number,
          args.quiz_id as string | number
        );
        return json(questions);
      }

      case "create_quiz_question": {
        const question = await canvas.createQuizQuestion(
          args.course_id as string | number,
          args.quiz_id as string | number,
          camelizeObject(assertObject(args.question, "question"))
        );
        return json(question);
      }

      case "update_quiz_question": {
        const question = await canvas.updateQuizQuestion(
          args.course_id as string | number,
          args.quiz_id as string | number,
          args.question_id as string | number,
          camelizeObject(assertObject(args.question, "question"))
        );
        return json(question);
      }

      case "delete_quiz_question": {
        const result = await canvas.deleteQuizQuestion(
          args.course_id as string | number,
          args.quiz_id as string | number,
          args.question_id as string | number
        );
        return json(result ?? { deleted: true });
      }

      case "reorder_quiz_items": {
        const result = await canvas.reorderQuizItems(
          args.course_id as string | number,
          args.quiz_id as string | number,
          assertArray(args.order, "order") as Array<{ id: number; type?: "question" | "group" }>
        );
        return json(result ?? { reordered: true });
      }

      case "list_submissions": {
        const submissions = await canvas.listSubmissions(
          args.course_id as string | number,
          args.assignment_id as string | number,
          { include: args.include as string[] | undefined }
        );
        return json(submissions);
      }

      case "get_submission": {
        const submission = await canvas.getSubmission(
          args.course_id as string | number,
          args.assignment_id as string | number,
          args.user_id as string | number,
          { include: args.include as string[] | undefined }
        );
        return json(submission);
      }

      case "grade_submission_with_rubric": {
        const submission = await canvas.getSubmission(
          args.course_id as string | number,
          args.assignment_id as string | number,
          args.user_id as string | number,
          { include: ["assignment", "user", "rubric_assessment", "full_rubric_assessment"] }
        );
        if (!["online_text_entry", "online_url"].includes(String(submission.submission_type))) {
          throw new Error(
            `grade_submission_with_rubric only supports online_text_entry and online_url submissions in v1; received ${submission.submission_type ?? "none"}.`
          );
        }
        const graded = await canvas.gradeSubmission(
          args.course_id as string | number,
          args.assignment_id as string | number,
          args.user_id as string | number,
          {
            postedGrade: args.posted_grade as string | undefined,
            textComment: args.text_comment as string | undefined,
            rubricAssessment: normalizeRubricAssessment(args.rubric_assessment),
          }
        );
        return json(graded);
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    auditStatus = "error";
    auditError = err;
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  } finally {
    writeAuditEvent(createAuditEvent({
      toolName: name,
      arguments: args,
      status: auditStatus,
      durationMs: Date.now() - startedAt,
      error: auditError,
    }));
  }
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function json(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function canvasFor(args: Record<string, unknown>): CanvasClient {
  const token = resolveCanvasToken(args, safetyConfig);
  if (!token) {
    throw new Error(
      "No Canvas API token is configured for this request. Set CANVAS_API_TOKEN or add a matching entry to CANVAS_API_TOKENS."
    );
  }

  return new CanvasClient({ baseUrl: CANVAS_BASE_URL, token });
}

function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOptionalObject(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertObject(value, "guidelines") as Record<string, string>;
}

function assertArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }
  return value;
}

function camelizeObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [toCamelCase(key), value])
  );
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function normalizeRubricAssessment(value: unknown) {
  return assertArray(value, "rubric_assessment").map((row) => {
    const obj = assertObject(row, "rubric_assessment row");
    const criterionId = obj.criterion_id ?? obj.criterionId;
    if (typeof criterionId !== "string" || criterionId.length === 0) {
      throw new Error("Each rubric_assessment row requires criterion_id.");
    }
    if (obj.points === undefined && obj.rating_id === undefined && obj.ratingId === undefined && obj.comments === undefined) {
      throw new Error(`Rubric row ${criterionId} requires points, rating_id, or comments.`);
    }
    return {
      criterionId,
      points: obj.points as number | undefined,
      ratingId: (obj.rating_id ?? obj.ratingId) as string | undefined,
      comments: obj.comments as string | undefined,
    };
  });
}

async function buildCourseShell(canvas: CanvasClient, args: Record<string, unknown>) {
  const courseId = args.course_id as string | number;
  const created: Record<string, unknown[]> = {
    assignment_groups: [],
    pages: [],
    modules: [],
    module_items: [],
  };

  for (const group of (args.assignment_groups as unknown[] | undefined) ?? []) {
    const groupInput = camelizeObject(assertObject(group, "assignment group")) as { name: string };
    created.assignment_groups.push(await canvas.createAssignmentGroup(courseId, groupInput));
  }

  const pageByTitle = new Map<string, { url?: string; page_id?: number }>();
  for (const page of (args.pages as unknown[] | undefined) ?? []) {
    const pageInput = camelizeObject(assertObject(page, "page"));
    const createdPage = await canvas.createPage(courseId, {
      title: pageInput.title as string,
      body: pageInput.body as string | undefined,
      published: pageInput.published as boolean | undefined,
      frontPage: pageInput.frontPage as boolean | undefined,
    });
    pageByTitle.set(createdPage.title, createdPage);
    created.pages.push(createdPage);
  }

  for (const mod of (args.modules as unknown[] | undefined) ?? []) {
    const moduleInput = camelizeObject(assertObject(mod, "module"));
    const items = (moduleInput.items as unknown[] | undefined) ?? [];
    delete moduleInput.items;
    const createdModule = await canvas.createModule(courseId, moduleInput as { name: string });
    created.modules.push(createdModule);

    for (const item of items) {
      const itemInput = camelizeObject(assertObject(item, "module item"));
      if (itemInput.type === "Page" && !itemInput.pageUrl && typeof itemInput.title === "string") {
        itemInput.pageUrl = pageByTitle.get(itemInput.title)?.url;
      }
      created.module_items.push(await canvas.createModuleItem(courseId, createdModule.id, itemInput as { type: string }));
    }
  }

  return created;
}

// -----------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[canvas-mcp] Server running on stdio");
