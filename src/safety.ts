export interface SafetyConfig {
  readOnly: boolean;
  requireConfirmation: boolean;
  dryRun: boolean;
  allowedCourseIds?: Set<string>;
  allowedAccountIds?: Set<string>;
  defaultToken?: string;
  tokenMap?: Record<string, string>;
}

export interface SafetyDecision {
  dryRun: boolean;
}

export const WRITE_TOOLS = new Set([
  "create_module",
  "create_module_item",
  "create_page",
  "create_assignment",
  "create_rubric",
  "create_course",
  "update_course",
  "create_assignment_group",
  "update_assignment_group",
  "update_module",
  "delete_module",
  "update_module_item",
  "delete_module_item",
  "build_course_shell",
  "update_page",
  "set_front_page",
  "create_branded_page",
  "create_quiz",
  "update_quiz",
  "delete_quiz",
  "create_quiz_question",
  "update_quiz_question",
  "delete_quiz_question",
  "reorder_quiz_items",
  "grade_submission_with_rubric",
]);

export const READ_TOOLS = new Set([
  "list_courses",
  "get_course",
  "list_assignments",
  "list_quizzes",
  "get_quiz",
  "list_quiz_questions",
  "list_rubrics",
  "list_modules",
  "list_module_items",
  "list_assignment_groups",
  "list_pages",
  "get_page",
  "get_brand_variables",
  "list_submissions",
  "get_submission",
]);

const SAFETY_WRITE_ARGUMENTS = ["confirm", "confirmation", "dry_run"];

const TOOL_ARGUMENTS: Record<string, readonly string[]> = {
  list_courses: ["enrollment_type", "enrollment_state", "state", "include"],
  get_course: ["course_id"],
  list_assignments: ["course_id", "search_term", "order_by", "include"],
  list_quizzes: ["course_id", "search_term"],
  get_quiz: ["course_id", "quiz_id"],
  list_quiz_questions: ["course_id", "quiz_id"],
  list_rubrics: ["course_id", "include", "style"],
  list_modules: ["course_id", "include", "search_term"],
  list_module_items: ["course_id", "module_id"],
  list_assignment_groups: ["course_id", "include"],
  list_pages: ["course_id", "sort", "order", "search_term", "published", "include"],
  get_page: ["course_id", "url_or_id"],
  get_brand_variables: ["course_id", "account_id"],
  list_submissions: ["course_id", "assignment_id", "include"],
  get_submission: ["course_id", "assignment_id", "user_id", "include"],
  create_module: ["course_id", "name", "unlock_at", "position", "require_sequential_progress", "prerequisite_module_ids", "publish_final_grade", ...SAFETY_WRITE_ARGUMENTS],
  create_module_item: ["course_id", "module_id", "type", "title", "content_id", "page_url", "external_url", "new_tab", "position", "indent", "completion_requirement_type", "completion_requirement_min_score", ...SAFETY_WRITE_ARGUMENTS],
  create_page: ["course_id", "title", "body", "editing_roles", "published", "front_page", "notify_of_update", "publish_at", ...SAFETY_WRITE_ARGUMENTS],
  create_assignment: ["course_id", "name", "description", "points_possible", "grading_type", "submission_types", "due_at", "lock_at", "unlock_at", "published", "allowed_attempts", "allowed_extensions", "peer_reviews", "anonymous_grading", "assignment_group_id", "position", ...SAFETY_WRITE_ARGUMENTS],
  create_rubric: ["course_id", "title", "free_form_criterion_comments", "criteria", "association_id", "association_type", "use_for_grading", "hide_score_total", "purpose", ...SAFETY_WRITE_ARGUMENTS],
  create_course: ["account_id", "name", "course_code", "start_at", "end_at", "syllabus_body", "default_view", "is_public", "public_syllabus", "restrict_enrollments_to_course_dates", ...SAFETY_WRITE_ARGUMENTS],
  update_course: ["course_id", "fields", ...SAFETY_WRITE_ARGUMENTS],
  create_assignment_group: ["course_id", "name", "position", "group_weight", "sis_source_id", ...SAFETY_WRITE_ARGUMENTS],
  update_assignment_group: ["course_id", "assignment_group_id", "fields", ...SAFETY_WRITE_ARGUMENTS],
  update_module: ["course_id", "module_id", "fields", ...SAFETY_WRITE_ARGUMENTS],
  delete_module: ["course_id", "module_id", ...SAFETY_WRITE_ARGUMENTS],
  update_module_item: ["course_id", "module_id", "item_id", "fields", ...SAFETY_WRITE_ARGUMENTS],
  delete_module_item: ["course_id", "module_id", "item_id", ...SAFETY_WRITE_ARGUMENTS],
  build_course_shell: ["course_id", "assignment_groups", "pages", "modules", ...SAFETY_WRITE_ARGUMENTS],
  update_page: ["course_id", "url_or_id", "fields", ...SAFETY_WRITE_ARGUMENTS],
  set_front_page: ["course_id", "title", "body", "published", ...SAFETY_WRITE_ARGUMENTS],
  create_branded_page: ["course_id", "title", "subtitle", "guidelines", "sections", "published", "front_page", ...SAFETY_WRITE_ARGUMENTS],
  create_quiz: ["course_id", "title", "quiz_type", "description", "assignment_group_id", "time_limit", "allowed_attempts", "due_at", "unlock_at", "lock_at", "published", "shuffle_answers", "hide_results", "show_correct_answers", "show_correct_answers_last_attempt", "show_correct_answers_at", "hide_correct_answers_at", "scoring_policy", "one_question_at_a_time", "cant_go_back", "access_code", "ip_filter", "one_time_results", "only_visible_to_overrides", ...SAFETY_WRITE_ARGUMENTS],
  update_quiz: ["course_id", "quiz_id", "fields", ...SAFETY_WRITE_ARGUMENTS],
  delete_quiz: ["course_id", "quiz_id", ...SAFETY_WRITE_ARGUMENTS],
  create_quiz_question: ["course_id", "quiz_id", "question", ...SAFETY_WRITE_ARGUMENTS],
  update_quiz_question: ["course_id", "quiz_id", "question_id", "question", ...SAFETY_WRITE_ARGUMENTS],
  delete_quiz_question: ["course_id", "quiz_id", "question_id", ...SAFETY_WRITE_ARGUMENTS],
  reorder_quiz_items: ["course_id", "quiz_id", "order", ...SAFETY_WRITE_ARGUMENTS],
  grade_submission_with_rubric: ["course_id", "assignment_id", "user_id", "posted_grade", "text_comment", "rubric_assessment", ...SAFETY_WRITE_ARGUMENTS],
};

const COURSE_FIELDS = new Set(["name", "course_code", "start_at", "end_at", "license", "is_public", "public_syllabus", "public_syllabus_to_auth", "term_id", "time_zone", "default_view", "syllabus_body", "restrict_enrollments_to_course_dates"]);
const ASSIGNMENT_GROUP_FIELDS = new Set(["name", "position", "group_weight", "sis_source_id", "integration_data", "rules"]);
const MODULE_FIELDS = new Set(["name", "unlock_at", "position", "require_sequential_progress", "prerequisite_module_ids", "publish_final_grade", "published"]);
const MODULE_ITEM_FIELDS = new Set(["type", "title", "content_id", "position", "indent", "page_url", "external_url", "new_tab", "completion_requirement_type", "completion_requirement_min_score", "published"]);
const PAGE_FIELDS = new Set(["title", "body", "editing_roles", "published", "front_page", "notify_of_update", "publish_at"]);
const QUIZ_FIELDS = new Set(["title", "description", "quiz_type", "assignment_group_id", "time_limit", "shuffle_answers", "hide_results", "show_correct_answers", "show_correct_answers_last_attempt", "show_correct_answers_at", "hide_correct_answers_at", "allowed_attempts", "scoring_policy", "one_question_at_a_time", "cant_go_back", "access_code", "ip_filter", "due_at", "lock_at", "unlock_at", "published", "one_time_results", "only_visible_to_overrides", "notify_of_update"]);
const QUIZ_QUESTION_FIELDS = new Set(["question_name", "question_text", "quiz_group_id", "question_type", "position", "points_possible", "correct_comments", "incorrect_comments", "neutral_comments", "text_after_answers", "answers"]);
const RUBRIC_CRITERION_FIELDS = new Set(["description", "long_description", "points", "ratings"]);
const RUBRIC_RATING_FIELDS = new Set(["description", "points"]);
const RUBRIC_ASSESSMENT_FIELDS = new Set(["criterion_id", "criterionId", "points", "rating_id", "ratingId", "comments"]);
const QUIZ_ORDER_FIELDS = new Set(["id", "type"]);
const BRAND_GUIDELINE_FIELDS = new Set(["primaryColor", "secondaryColor", "accentColor", "textColor", "backgroundColor", "fontFamily"]);
const BRANDED_SECTION_FIELDS = new Set(["heading", "body", "callout", "links"]);
const BRANDED_LINK_FIELDS = new Set(["label", "url"]);
const HTML_BODY_FIELDS = new Set(["body", "description", "syllabus_body", "question_text", "text_after_answers", "correct_comments", "incorrect_comments", "neutral_comments"]);
const SAFE_HTML_TAGS = new Set([
  "a",
  "abbr",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const UNSAFE_HTML_TAGS = new Set([
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "textarea",
]);
const URL_HTML_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster"]);
const BLOCKED_HTML_ATTRIBUTES = new Set(["style", "srcdoc", "srcset"]);

export function parseSafetyConfig(env: Record<string, string | undefined>): SafetyConfig {
  return {
    readOnly: parseBoolean(env.CANVAS_READ_ONLY),
    requireConfirmation: parseBoolean(env.CANVAS_REQUIRE_CONFIRMATION),
    dryRun: parseBoolean(env.CANVAS_DRY_RUN),
    allowedCourseIds: parseIdSet(env.CANVAS_ALLOWED_COURSE_IDS),
    allowedAccountIds: parseIdSet(env.CANVAS_ALLOWED_ACCOUNT_IDS),
    defaultToken: emptyToUndefined(env.CANVAS_API_TOKEN),
    tokenMap: parseTokenMap(env.CANVAS_API_TOKENS),
  };
}

export function isKnownTool(toolName: string): boolean {
  return Boolean(TOOL_ARGUMENTS[toolName]);
}

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

export function normalizeToolArguments(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (!isPlainRecord(args)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return args;
}

export function assertKnownArguments(toolName: string, args: Record<string, unknown>): void {
  const allowed = TOOL_ARGUMENTS[toolName];
  if (!allowed) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const allowedSet = new Set(allowed);
  for (const key of Object.keys(args)) {
    if (!allowedSet.has(key)) {
      throw new Error(`Unknown argument for ${toolName}: ${key}`);
    }
  }
}

export function validateToolArguments(toolName: string, args: Record<string, unknown>): void {
  assertKnownArguments(toolName, args);

  for (const field of ["course_id", "account_id", "module_id", "assignment_id", "assignment_group_id", "quiz_id", "question_id", "item_id", "user_id", "association_id", "content_id"]) {
    if (field in args) assertIdLike(args[field], field);
  }

  validateNumericField(args, "position", { min: 1 });
  validateNumericField(args, "indent", { min: 0, max: 5 });
  validateNumericField(args, "points_possible", { min: 0 });
  validateNumericField(args, "allowed_attempts", { min: -1 });
  validateNumericField(args, "completion_requirement_min_score", { min: 0 });
  validateNumericField(args, "time_limit", { min: 0 });
  validateTopLevelHtmlFields(toolName, args);

  switch (toolName) {
    case "create_rubric":
      validateRubricArguments(args);
      break;
    case "update_course":
      validateFieldsObject(args.fields, "fields", COURSE_FIELDS);
      validateHtmlFieldsInObject(args.fields, "update_course fields");
      break;
    case "update_assignment_group":
      validateFieldsObject(args.fields, "fields", ASSIGNMENT_GROUP_FIELDS);
      break;
    case "update_module":
      validateFieldsObject(args.fields, "fields", MODULE_FIELDS);
      break;
    case "update_module_item":
      validateFieldsObject(args.fields, "fields", MODULE_ITEM_FIELDS);
      break;
    case "update_page":
      validateFieldsObject(args.fields, "fields", PAGE_FIELDS);
      validateHtmlFieldsInObject(args.fields, "update_page fields");
      break;
    case "update_quiz":
      validateFieldsObject(args.fields, "fields", QUIZ_FIELDS);
      validateHtmlFieldsInObject(args.fields, "update_quiz fields");
      break;
    case "create_quiz_question":
    case "update_quiz_question":
      validateFieldsObject(args.question, "question", QUIZ_QUESTION_FIELDS);
      validateHtmlFieldsInObject(args.question, `${toolName} question`);
      break;
    case "reorder_quiz_items":
      validateQuizOrder(args.order);
      break;
    case "grade_submission_with_rubric":
      validateRubricAssessment(args.rubric_assessment);
      break;
    case "build_course_shell":
      validateCourseShell(args);
      break;
    case "create_branded_page":
      validateBrandedPage(args);
      break;
  }
}

export function enforceSafety(
  toolName: string,
  args: Record<string, unknown>,
  config: SafetyConfig
): SafetyDecision {
  validateToolArguments(toolName, args);
  assertAllowedIds(args, config);

  if (!isWriteTool(toolName)) {
    return { dryRun: false };
  }

  if (config.readOnly) {
    throw new Error(`Tool ${toolName} is blocked because read-only mode (CANVAS_READ_ONLY) is enabled.`);
  }

  const dryRun = config.dryRun || args.dry_run === true;
  if (dryRun) {
    return { dryRun: true };
  }

  if (config.requireConfirmation && !hasExplicitConfirmation(args)) {
    throw new Error(
      `Tool ${toolName} requires explicit confirmation. Pass confirm: true or confirmation: "CONFIRM".`
    );
  }

  return { dryRun: false };
}

export function dryRunResult(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const redactedArgs = { ...args };
  delete redactedArgs.confirm;
  delete redactedArgs.confirmation;
  delete redactedArgs.dry_run;

  return {
    dry_run: true,
    tool: toolName,
    message: "Validated request only. No Canvas API write was performed.",
    arguments: redactedArgs,
  };
}

export function resolveCanvasToken(args: Record<string, unknown>, config: SafetyConfig): string | undefined {
  const courseId = idToString(args.course_id);
  const accountId = idToString(args.account_id);

  if (courseId && config.tokenMap?.[courseId]) return config.tokenMap[courseId];
  if (accountId && config.tokenMap?.[`account:${accountId}`]) return config.tokenMap[`account:${accountId}`];
  if (accountId && config.tokenMap?.[accountId]) return config.tokenMap[accountId];
  return config.tokenMap?.default ?? config.defaultToken;
}

function validateRubricArguments(args: Record<string, unknown>): void {
  const criteria = args.criteria;
  const useForGrading = args.use_for_grading === true;

  if (criteria !== undefined) {
    if (!Array.isArray(criteria)) {
      throw new Error("create_rubric criteria must be an array.");
    }

    criteria.forEach((criterion, criterionIndex) => validateRubricCriterion(criterion, criterionIndex));
  }

  if (useForGrading) {
    if (args.association_id === undefined || args.association_type !== "Assignment") {
      throw new Error("A grading rubric requires an assignment association before Canvas can use it for grading.");
    }
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new Error("A grading rubric must include criteria before Canvas can use it for grading.");
    }
  }
}

function validateRubricCriterion(criterion: unknown, criterionIndex: number): void {
  if (!isPlainRecord(criterion)) {
    throw new Error(`Rubric criterion ${criterionIndex} must be an object.`);
  }
  assertAllowedNestedFields(`rubric criterion ${criterionIndex}`, criterion, RUBRIC_CRITERION_FIELDS);
  assertNonEmptyString(criterion.description, `rubric criterion ${criterionIndex} description`);
  const criterionPoints = assertFiniteNumber(criterion.points, `rubric criterion ${criterionIndex} points`);
  if (criterionPoints <= 0) {
    throw new Error(`Rubric criterion ${criterionIndex} points must be greater than 0.`);
  }

  if (!Array.isArray(criterion.ratings) || criterion.ratings.length === 0) {
    throw new Error(`Rubric criterion ${criterionIndex} must include at least one rating.`);
  }

  let hasMaxRating = false;
  criterion.ratings.forEach((rating, ratingIndex) => {
    if (!isPlainRecord(rating)) {
      throw new Error(`Rubric rating ${criterionIndex}.${ratingIndex} must be an object.`);
    }
    assertAllowedNestedFields(`rubric rating ${criterionIndex}.${ratingIndex}`, rating, RUBRIC_RATING_FIELDS);
    assertNonEmptyString(rating.description, `rubric rating ${criterionIndex}.${ratingIndex} description`);
    const ratingPoints = assertFiniteNumber(rating.points, `rubric rating ${criterionIndex}.${ratingIndex} points`);
    if (ratingPoints < 0) {
      throw new Error(`Rubric rating ${criterionIndex}.${ratingIndex} points must be 0 or greater.`);
    }
    if (ratingPoints > criterionPoints) {
      throw new Error(`Rubric rating ${criterionIndex}.${ratingIndex} points cannot exceed criterion points.`);
    }
    if (ratingPoints === criterionPoints) {
      hasMaxRating = true;
    }
  });

  if (!hasMaxRating) {
    throw new Error(`Rubric criterion ${criterionIndex} must include a rating equal to its maximum points.`);
  }
}

function validateQuizOrder(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("order must be a non-empty array.");
  }
  value.forEach((row, index) => {
    if (!isPlainRecord(row)) {
      throw new Error(`order ${index} must be an object.`);
    }
    assertAllowedNestedFields(`quiz order ${index}`, row, QUIZ_ORDER_FIELDS);
    assertIdLike(row.id, `order ${index} id`);
    if (row.type !== undefined && row.type !== "question" && row.type !== "group") {
      throw new Error(`order ${index} type must be question or group.`);
    }
  });
}

function validateRubricAssessment(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("rubric_assessment must be a non-empty array.");
  }

  value.forEach((row, index) => {
    if (!isPlainRecord(row)) {
      throw new Error(`rubric_assessment row ${index} must be an object.`);
    }
    assertAllowedNestedFields(`rubric_assessment row ${index}`, row, RUBRIC_ASSESSMENT_FIELDS);
    const criterionId = row.criterion_id ?? row.criterionId;
    assertNonEmptyString(criterionId, `rubric_assessment row ${index} criterion_id`);
    if (row.points !== undefined) validateNumericValue(row.points, `rubric_assessment row ${index} points`, { min: 0 });
    if (row.points === undefined && row.rating_id === undefined && row.ratingId === undefined && row.comments === undefined) {
      throw new Error(`Rubric assessment row ${index} requires points, rating_id, or comments.`);
    }
  });
}

function validateCourseShell(args: Record<string, unknown>): void {
  if (args.assignment_groups !== undefined) {
    validateObjectArray(args.assignment_groups, "assignment_groups", ASSIGNMENT_GROUP_FIELDS);
  }
  if (args.pages !== undefined) {
    validateObjectArray(args.pages, "pages", PAGE_FIELDS);
    (args.pages as unknown[]).forEach((page, index) => {
      validateHtmlFieldsInObject(page, `pages ${index}`);
    });
  }
  if (args.modules !== undefined) {
    if (!Array.isArray(args.modules)) throw new Error("modules must be an array.");
    args.modules.forEach((mod, index) => {
      if (!isPlainRecord(mod)) throw new Error(`modules ${index} must be an object.`);
      assertAllowedNestedFields(`modules ${index}`, mod, new Set([...MODULE_FIELDS, "items"]));
      if (mod.items !== undefined) {
        validateObjectArray(mod.items, `modules ${index} items`, MODULE_ITEM_FIELDS);
      }
    });
  }
}

function validateBrandedPage(args: Record<string, unknown>): void {
  if (args.guidelines !== undefined) {
    validateFieldsObject(args.guidelines, "guidelines", BRAND_GUIDELINE_FIELDS);
  }
  if (!Array.isArray(args.sections) || args.sections.length === 0) {
    throw new Error("sections must be a non-empty array.");
  }
  args.sections.forEach((section, index) => {
    if (!isPlainRecord(section)) throw new Error(`section ${index} must be an object.`);
    assertAllowedNestedFields(`section ${index}`, section, BRANDED_SECTION_FIELDS);
    assertNonEmptyString(section.heading, `section ${index} heading`);
    if (section.links !== undefined) {
      validateObjectArray(section.links, `section ${index} links`, BRANDED_LINK_FIELDS);
    }
  });
}

function validateObjectArray(value: unknown, name: string, allowed: Set<string>): void {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }
  value.forEach((row, index) => {
    if (!isPlainRecord(row)) {
      throw new Error(`${name} ${index} must be an object.`);
    }
    assertAllowedNestedFields(`${name} ${index}`, row, allowed);
  });
}

function validateFieldsObject(value: unknown, name: string, allowed: Set<string>): void {
  if (!isPlainRecord(value)) {
    throw new Error(`${name} must be an object.`);
  }
  assertAllowedNestedFields(name, value, allowed);
  for (const [field, fieldValue] of Object.entries(value)) {
    validateFieldValue(field, fieldValue);
  }
}

function validateTopLevelHtmlFields(toolName: string, args: Record<string, unknown>): void {
  const htmlFieldsByTool: Record<string, readonly string[]> = {
    create_page: ["body"],
    set_front_page: ["body"],
    create_assignment: ["description"],
    create_course: ["syllabus_body"],
    create_quiz: ["description"],
  };

  for (const field of htmlFieldsByTool[toolName] ?? []) {
    validateCanvasHtml(args[field], `${toolName} ${field}`);
  }
}

function validateHtmlFieldsInObject(value: unknown, path: string): void {
  if (!isPlainRecord(value)) return;
  for (const [field, fieldValue] of Object.entries(value)) {
    if (HTML_BODY_FIELDS.has(field)) {
      validateCanvasHtml(fieldValue, `${path} ${field}`);
    }
  }
}

function validateCanvasHtml(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }

  const tags = value.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g);
  for (const match of tags) {
    const tag = match[1].toLowerCase();
    const attributes = match[2] ?? "";

    if (UNSAFE_HTML_TAGS.has(tag)) {
      throw new Error(`Unsafe HTML in ${field}: ${tag} tag is not allowed.`);
    }
    if (!SAFE_HTML_TAGS.has(tag)) {
      throw new Error(`Unsafe HTML in ${field}: ${tag} tag is not in the Canvas HTML allowlist.`);
    }

    validateHtmlAttributes(attributes, field);
  }
}

function validateHtmlAttributes(attributes: string, field: string): void {
  const attributeMatches = attributes.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g);
  for (const match of attributeMatches) {
    const rawName = match[1];
    if (rawName === "/") continue;

    const name = rawName.toLowerCase();
    const attributeValue = match[2] ?? match[3] ?? match[4] ?? "";

    if (name.startsWith("on")) {
      throw new Error(`Unsafe HTML in ${field}: event handler attributes are not allowed.`);
    }
    if (BLOCKED_HTML_ATTRIBUTES.has(name)) {
      throw new Error(`Unsafe HTML in ${field}: ${name} attribute is not allowed.`);
    }
    if (URL_HTML_ATTRIBUTES.has(name)) {
      validateHtmlUrl(attributeValue, field);
    }
  }
}

function validateHtmlUrl(value: string, field: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;

  const lower = trimmed.replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
  if (lower.startsWith("javascript:")) {
    throw new Error(`Unsafe HTML in ${field}: javascript URLs are not allowed.`);
  }
  if (lower.startsWith("data:")) {
    throw new Error(`Unsafe HTML in ${field}: data URLs are not allowed.`);
  }
  if (lower.startsWith("vbscript:")) {
    throw new Error(`Unsafe HTML in ${field}: vbscript URLs are not allowed.`);
  }
}

function validateFieldValue(field: string, value: unknown): void {
  if (["position", "term_id", "assignment_group_id", "quiz_group_id", "content_id"].includes(field)) {
    validateNumericValue(value, field, { min: 1, integer: true });
  }
  if (["indent"].includes(field)) {
    validateNumericValue(value, field, { min: 0, max: 5, integer: true });
  }
  if (["points_possible", "completion_requirement_min_score", "time_limit"].includes(field)) {
    validateNumericValue(value, field, { min: 0 });
  }
  if (field === "allowed_attempts") {
    validateNumericValue(value, field, { min: -1, integer: true });
  }
}

function assertAllowedIds(args: Record<string, unknown>, config: SafetyConfig): void {
  const courseId = idToString(args.course_id);
  if (courseId && config.allowedCourseIds && !config.allowedCourseIds.has(courseId)) {
    throw new Error(`course_id ${courseId} is not allowed by CANVAS_ALLOWED_COURSE_IDS.`);
  }

  const accountId = idToString(args.account_id);
  if (accountId && config.allowedAccountIds && !config.allowedAccountIds.has(accountId)) {
    throw new Error(`account_id ${accountId} is not allowed by CANVAS_ALLOWED_ACCOUNT_IDS.`);
  }
}

function assertAllowedNestedFields(path: string, value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      const fieldLabel = path.replace(/\s+\d+(?:\.\d+)?$/, "");
      throw new Error(`Unknown ${fieldLabel} field: ${key} (${path})`);
    }
  }
}

function validateNumericField(
  args: Record<string, unknown>,
  field: string,
  range: { min?: number; max?: number; integer?: boolean }
): void {
  if (args[field] === undefined) return;
  validateNumericValue(args[field], field, range);
}

function validateNumericValue(value: unknown, field: string, range: { min?: number; max?: number; integer?: boolean }): number {
  const numberValue = assertFiniteNumber(value, field);
  if (range.integer && !Number.isSafeInteger(numberValue)) {
    throw new Error(`${field} must be an integer.`);
  }
  if (range.min !== undefined && numberValue < range.min) {
    throw new Error(`${field} must be greater than or equal to ${range.min}.`);
  }
  if (range.max !== undefined && numberValue > range.max) {
    throw new Error(`${field} must be less than or equal to ${range.max}.`);
  }
  return numberValue;
}

function assertIdLike(value: unknown, field: string): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${field} must be a positive integer.`);
    }
    return;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return;
  }
  throw new Error(`${field} must be a positive Canvas id.`);
}

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function hasExplicitConfirmation(args: Record<string, unknown>): boolean {
  return args.confirm === true || args.confirmation === "CONFIRM";
}

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parseIdSet(value: string | undefined): Set<string> | undefined {
  const ids = value
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids && ids.length > 0 ? new Set(ids) : undefined;
}

function parseTokenMap(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;

  const parsed = JSON.parse(value) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("CANVAS_API_TOKENS must be a JSON object mapping ids to tokens.");
  }

  const tokenMap: Record<string, string> = {};
  for (const [key, token] of Object.entries(parsed)) {
    if (typeof token !== "string" || token.trim() === "") {
      throw new Error(`CANVAS_API_TOKENS value for ${key} must be a non-empty string.`);
    }
    tokenMap[key] = token;
  }
  return tokenMap;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function idToString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
