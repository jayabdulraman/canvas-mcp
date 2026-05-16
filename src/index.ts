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
import { CanvasClient } from "./canvas-client.js";

// -----------------------------------------------------------------------
// Bootstrap the Canvas client from environment variables
// -----------------------------------------------------------------------

const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL ?? "";
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN ?? "";

if (!CANVAS_BASE_URL || !CANVAS_API_TOKEN) {
  console.error(
    "[canvas-mcp] ERROR: CANVAS_BASE_URL and CANVAS_API_TOKEN must be set.\n" +
    "  export CANVAS_BASE_URL=https://yourschool.instructure.com\n" +
    "  export CANVAS_API_TOKEN=your_token_here"
  );
  process.exit(1);
}

const canvas = new CanvasClient({ baseUrl: CANVAS_BASE_URL, token: CANVAS_API_TOKEN });

// -----------------------------------------------------------------------
// MCP Server
// -----------------------------------------------------------------------

const server = new Server(
  { name: "canvas-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

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
        },
        required: ["course_id", "title"],
      },
    },
  ],
}));

// -----------------------------------------------------------------------
// Tool execution
// -----------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
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

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
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

// -----------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[canvas-mcp] Server running on stdio");
