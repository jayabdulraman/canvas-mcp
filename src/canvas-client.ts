/**
 * Canvas LMS API client
 *
 * Wraps fetch with auth headers and handles pagination automatically.
 * All list helpers return the full collection across pages (up to a safe cap).
 */

export interface CanvasClientConfig {
  baseUrl: string;   // e.g. https://yourschool.instructure.com
  token: string;     // Canvas API access token
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  retryJitter?: boolean;
  maxPages?: number;
}

type QueryValue = string | number | boolean | string[] | number[] | undefined | null;
type QueryParams = Record<string, QueryValue>;

export class CanvasApiError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly bodySnippet?: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly attempts: number;

  constructor(message: string, metadata: {
    method: string;
    path: string;
    status?: number;
    bodySnippet?: string;
    retryable: boolean;
    retryAfterMs?: number;
    attempts: number;
    cause?: unknown;
  }) {
    super(message, { cause: metadata.cause });
    this.name = "CanvasApiError";
    this.method = metadata.method;
    this.path = metadata.path;
    this.status = metadata.status;
    this.bodySnippet = metadata.bodySnippet;
    this.retryable = metadata.retryable;
    this.retryAfterMs = metadata.retryAfterMs;
    this.attempts = metadata.attempts;
  }
}

export class CanvasPaginationError extends Error {
  readonly method = "GET";
  readonly path: string;
  readonly maxPages: number;
  readonly nextUrl: string;

  constructor(path: string, maxPages: number, nextUrl: string) {
    super(`Canvas API GET ${path} reached pagination limit of ${maxPages} pages with another page available`);
    this.name = "CanvasPaginationError";
    this.path = path;
    this.maxPages = maxPages;
    this.nextUrl = nextUrl;
  }
}

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_PAGES = 20;
const ERROR_BODY_SNIPPET_LIMIT = 512;

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly retryJitter: boolean;
  private readonly maxPages: number;

  constructor(config: CanvasClientConfig) {
    // Normalise – strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    this.fetchImpl = config.fetch ?? fetch.bind(globalThis);
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.retryJitter = config.retryJitter ?? true;
    this.maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
  }

  // -----------------------------------------------------------------------
  // Low-level helpers
  // -----------------------------------------------------------------------

  private url(path: string, params?: QueryParams): string {
    const u = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (Array.isArray(val)) {
          const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
          for (const v of val) u.searchParams.append(arrayKey, String(v));
        } else if (val !== undefined && val !== null && val !== "") {
          u.searchParams.set(key, String(val));
        }
      }
    }
    return u.toString();
  }

  private async request<T>(method: string, path: string, body?: unknown, params?: QueryParams): Promise<T> {
    const res = await this.fetchWithRetries(method, path, this.url(path, params), {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Canvas API ${method} ${path} → ${res.status}: ${text}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  private async fetchWithRetries(method: string, path: string, url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const attempts = attempt + 1;
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      try {
        const res = await this.fetchImpl(url, { ...init, signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          return res;
        }

        const retryable = TRANSIENT_STATUS_CODES.has(res.status);
        const retryAfterMs = this.retryAfterMs(res.headers.get("Retry-After"));
        const bodySnippet = await this.safeBodySnippet(res);

        if (retryable && attempt < this.maxRetries) {
          await this.sleep(this.retryDelayMs(attempt, retryAfterMs));
          continue;
        }

        throw new CanvasApiError(
          `Canvas API ${method} ${path} failed with status ${res.status}: ${bodySnippet}`,
          { method, path, status: res.status, bodySnippet, retryable, retryAfterMs, attempts }
        );
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof CanvasApiError) {
          throw error;
        }
        if (timedOut) {
          throw new CanvasApiError(
            `Canvas API ${method} ${path} timed out after ${this.timeoutMs}ms`,
            { method, path, retryable: false, attempts, cause: error }
          );
        }
        throw new CanvasApiError(
          `Canvas API ${method} ${path} request failed before receiving a response`,
          { method, path, retryable: false, attempts, cause: error }
        );
      }
    }

    throw new Error("unreachable");
  }

  private async safeBodySnippet(res: Response): Promise<string> {
    const text = await res.text().catch(() => res.statusText);
    return text.length > ERROR_BODY_SNIPPET_LIMIT
      ? `${text.slice(0, ERROR_BODY_SNIPPET_LIMIT - 3)}...`
      : text;
  }

  private retryAfterMs(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(value);
    if (Number.isNaN(dateMs)) return undefined;
    return Math.max(0, dateMs - Date.now());
  }

  private retryDelayMs(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) {
      return retryAfterMs;
    }
    const exponentialDelay = Math.min(
      this.maxRetryDelayMs,
      this.baseRetryDelayMs * 2 ** attempt
    );
    if (!this.retryJitter) {
      return exponentialDelay;
    }
    return Math.floor(exponentialDelay * (0.5 + Math.random() * 0.5));
  }

  /**
   * Fetch all pages from a paginated Canvas list endpoint.
   * Respects the `Link: <url>; rel="next"` header.
   */
  private async paginate<T>(path: string, params?: QueryParams, maxPages = this.maxPages): Promise<T[]> {
    let nextUrl: string | null = this.url(path, { per_page: 100, ...params });
    const results: T[] = [];
    let page = 0;

    while (nextUrl && page < maxPages) {
      const res = await this.fetchWithRetries("GET", path, nextUrl, { headers: this.headers });

      const data = (await res.json()) as T[];
      results.push(...data);

      // Follow pagination via Link header
      const link: string = res.headers.get("Link") ?? "";
      const match: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = match ? match[1] : null;
      page++;
    }

    if (nextUrl) {
      throw new CanvasPaginationError(path, maxPages, nextUrl);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // READ – Courses
  // -----------------------------------------------------------------------

  async listCourses(params?: {
    enrollmentType?: string;
    enrollmentState?: string;
    state?: string[];
    include?: string[];
  }) {
    return this.paginate<CanvasCourse>("/courses", {
      ...(params?.enrollmentType && { enrollment_type: params.enrollmentType }),
      ...(params?.enrollmentState && { enrollment_state: params.enrollmentState }),
      ...(params?.state && { "state[]": params.state }),
      ...(params?.include && { "include[]": params.include }),
    });
  }

  async getCourse(courseId: string | number) {
    return this.request<CanvasCourse>("GET", `/courses/${courseId}`);
  }

  async createCourse(accountId: string | number, params: CourseInput) {
    return this.request<CanvasCourse>("POST", `/accounts/${accountId}/courses`, {
      course: snakeCaseObject(params),
    });
  }

  async updateCourse(courseId: string | number, params: Partial<CourseInput>) {
    return this.request<CanvasCourse>("PUT", `/courses/${courseId}`, {
      course: snakeCaseObject(params),
    });
  }

  // -----------------------------------------------------------------------
  // READ – Assignments
  // -----------------------------------------------------------------------

  async listAssignments(courseId: string | number, params?: {
    searchTerm?: string;
    orderBy?: string;
    include?: string[];
  }) {
    return this.paginate<CanvasAssignment>(`/courses/${courseId}/assignments`, {
      ...(params?.searchTerm && { search_term: params.searchTerm }),
      ...(params?.orderBy && { order_by: params.orderBy }),
      ...(params?.include && { "include[]": params.include }),
    });
  }

  async getAssignment(courseId: string | number, assignmentId: string | number, params?: {
    include?: string[];
  }) {
    return this.request<CanvasAssignment>(
      "GET",
      `/courses/${courseId}/assignments/${assignmentId}`,
      undefined,
      {
        ...(params?.include && { "include[]": params.include }),
      }
    );
  }

  async updateAssignment(courseId: string | number, assignmentId: string | number, params: Partial<AssignmentInput>) {
    return this.request<CanvasAssignment>("PUT", `/courses/${courseId}/assignments/${assignmentId}`, {
      assignment: snakeCaseObject(params),
    });
  }

  // -----------------------------------------------------------------------
  // Assignment groups
  // -----------------------------------------------------------------------

  async listAssignmentGroups(courseId: string | number, params?: {
    include?: string[];
  }) {
    return this.paginate<CanvasAssignmentGroup>(`/courses/${courseId}/assignment_groups`, {
      ...(params?.include && { "include[]": params.include }),
    });
  }

  async createAssignmentGroup(courseId: string | number, params: AssignmentGroupInput) {
    return this.request<CanvasAssignmentGroup>(
      "POST",
      `/courses/${courseId}/assignment_groups`,
      snakeCaseObject(params)
    );
  }

  async updateAssignmentGroup(courseId: string | number, assignmentGroupId: string | number, params: Partial<AssignmentGroupInput>) {
    return this.request<CanvasAssignmentGroup>(
      "PUT",
      `/courses/${courseId}/assignment_groups/${assignmentGroupId}`,
      snakeCaseObject(params)
    );
  }

  // -----------------------------------------------------------------------
  // READ – Quizzes
  // -----------------------------------------------------------------------

  async listQuizzes(courseId: string | number, params?: {
    searchTerm?: string;
  }) {
    return this.paginate<CanvasQuiz>(`/courses/${courseId}/quizzes`, {
      ...(params?.searchTerm && { search_term: params.searchTerm }),
    });
  }

  async getQuiz(courseId: string | number, quizId: string | number) {
    return this.request<CanvasQuiz>("GET", `/courses/${courseId}/quizzes/${quizId}`);
  }

  async createQuiz(courseId: string | number, params: QuizInput) {
    return this.request<CanvasQuiz>("POST", `/courses/${courseId}/quizzes`, {
      quiz: snakeCaseObject(params),
    });
  }

  async updateQuiz(courseId: string | number, quizId: string | number, params: Partial<QuizInput> & { notifyOfUpdate?: boolean }) {
    return this.request<CanvasQuiz>("PUT", `/courses/${courseId}/quizzes/${quizId}`, {
      quiz: snakeCaseObject(params),
    });
  }

  async deleteQuiz(courseId: string | number, quizId: string | number) {
    return this.request<CanvasQuiz>("DELETE", `/courses/${courseId}/quizzes/${quizId}`);
  }

  async reorderQuizItems(courseId: string | number, quizId: string | number, order: QuizItemOrder[]) {
    return this.request<void>("POST", `/courses/${courseId}/quizzes/${quizId}/reorder`, { order });
  }

  async listQuizQuestions(courseId: string | number, quizId: string | number) {
    return this.paginate<CanvasQuizQuestion>(`/courses/${courseId}/quizzes/${quizId}/questions`);
  }

  async createQuizQuestion(courseId: string | number, quizId: string | number, params: QuizQuestionInput) {
    return this.request<CanvasQuizQuestion>(
      "POST",
      `/courses/${courseId}/quizzes/${quizId}/questions`,
      { question: snakeCaseObject(params) }
    );
  }

  async updateQuizQuestion(courseId: string | number, quizId: string | number, questionId: string | number, params: Partial<QuizQuestionInput>) {
    return this.request<CanvasQuizQuestion>(
      "PUT",
      `/courses/${courseId}/quizzes/${quizId}/questions/${questionId}`,
      { question: snakeCaseObject(params) }
    );
  }

  async deleteQuizQuestion(courseId: string | number, quizId: string | number, questionId: string | number) {
    return this.request<void>("DELETE", `/courses/${courseId}/quizzes/${quizId}/questions/${questionId}`);
  }

  // -----------------------------------------------------------------------
  // READ – Rubrics
  // -----------------------------------------------------------------------

  async listRubrics(courseId: string | number, params?: {
    include?: string[];
    style?: string;
  }) {
    return this.paginate<CanvasRubric>(`/courses/${courseId}/rubrics`, {
      ...(params?.include && { "include[]": params.include }),
      ...(params?.style && { style: params.style }),
    });
  }

  // -----------------------------------------------------------------------
  // READ – Modules
  // -----------------------------------------------------------------------

  async listModules(courseId: string | number, params?: {
    include?: string[];
    searchTerm?: string;
  }) {
    return this.paginate<CanvasModule>(`/courses/${courseId}/modules`, {
      ...(params?.include && { "include[]": params.include }),
      ...(params?.searchTerm && { search_term: params.searchTerm }),
    });
  }

  async listModuleItems(courseId: string | number, moduleId: string | number) {
    return this.paginate<CanvasModuleItem>(`/courses/${courseId}/modules/${moduleId}/items`, {
      "include[]": ["content_details"],
    });
  }

  async updateModule(courseId: string | number, moduleId: string | number, params: Partial<ModuleInput>) {
    return this.request<CanvasModule>("PUT", `/courses/${courseId}/modules/${moduleId}`, {
      module: snakeCaseObject(params),
    });
  }

  async deleteModule(courseId: string | number, moduleId: string | number) {
    return this.request<CanvasModule>("DELETE", `/courses/${courseId}/modules/${moduleId}`);
  }

  // -----------------------------------------------------------------------
  // CREATE – Module
  // -----------------------------------------------------------------------

  async createModule(courseId: string | number, params: {
    name: string;
    unlockAt?: string;
    position?: number;
    requireSequentialProgress?: boolean;
    prerequisiteModuleIds?: number[];
    publishFinalGrade?: boolean;
  }) {
    const body: Record<string, unknown> = {
      module: {
        name: params.name,
        ...(params.unlockAt && { unlock_at: params.unlockAt }),
        ...(params.position !== undefined && { position: params.position }),
        ...(params.requireSequentialProgress !== undefined && {
          require_sequential_progress: params.requireSequentialProgress,
        }),
        ...(params.prerequisiteModuleIds?.length && {
          prerequisite_module_ids: params.prerequisiteModuleIds,
        }),
        ...(params.publishFinalGrade !== undefined && {
          publish_final_grade: params.publishFinalGrade,
        }),
      },
    };
    return this.request<CanvasModule>("POST", `/courses/${courseId}/modules`, body);
  }

  // -----------------------------------------------------------------------
  // CREATE – Module Item
  // -----------------------------------------------------------------------

  async createModuleItem(courseId: string | number, moduleId: string | number, params: {
    type: string;
    title?: string;
    contentId?: number;
    position?: number;
    indent?: number;
    pageUrl?: string;
    externalUrl?: string;
    newTab?: boolean;
    completionRequirementType?: string;
    completionRequirementMinScore?: number;
  }) {
    return this.request<CanvasModuleItem>(
      "POST",
      `/courses/${courseId}/modules/${moduleId}/items`,
      { module_item: buildModuleItem(params) }
    );
  }

  async updateModuleItem(courseId: string | number, moduleId: string | number, itemId: string | number, params: Partial<ModuleItemInput>) {
    return this.request<CanvasModuleItem>(
      "PUT",
      `/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
      { module_item: buildModuleItem(params) }
    );
  }

  async deleteModuleItem(courseId: string | number, moduleId: string | number, itemId: string | number) {
    return this.request<CanvasModuleItem>(
      "DELETE",
      `/courses/${courseId}/modules/${moduleId}/items/${itemId}`
    );
  }

  // -----------------------------------------------------------------------
  // Pages
  // -----------------------------------------------------------------------

  async listPages(courseId: string | number, params?: {
    sort?: string;
    order?: string;
    searchTerm?: string;
    published?: boolean;
    include?: string[];
  }) {
    return this.paginate<CanvasPage>(`/courses/${courseId}/pages`, {
      ...(params?.sort && { sort: params.sort }),
      ...(params?.order && { order: params.order }),
      ...(params?.searchTerm && { search_term: params.searchTerm }),
      ...(params?.published !== undefined && { published: params.published }),
      ...(params?.include && { "include[]": params.include }),
    });
  }

  async getPage(courseId: string | number, urlOrId: string | number) {
    return this.request<CanvasPage>("GET", `/courses/${courseId}/pages/${encodeURIComponent(String(urlOrId))}`);
  }

  async createPage(courseId: string | number, params: {
    title: string;
    body?: string;
    editingRoles?: string;
    published?: boolean;
    frontPage?: boolean;
    notifyOfUpdate?: boolean;
    publishAt?: string;
  }) {
    const body = {
      wiki_page: {
        title: params.title,
        ...(params.body !== undefined && { body: params.body }),
        ...(params.editingRoles && { editing_roles: params.editingRoles }),
        ...(params.published !== undefined && { published: params.published }),
        ...(params.frontPage !== undefined && { front_page: params.frontPage }),
        ...(params.notifyOfUpdate !== undefined && { notify_of_update: params.notifyOfUpdate }),
        ...(params.publishAt && { publish_at: params.publishAt }),
      },
    };
    return this.request<CanvasPage>("POST", `/courses/${courseId}/pages`, body);
  }

  async updatePage(courseId: string | number, urlOrId: string | number, params: PageInput) {
    return this.request<CanvasPage>(
      "PUT",
      `/courses/${courseId}/pages/${encodeURIComponent(String(urlOrId))}`,
      { wiki_page: snakeCaseObject(params) }
    );
  }

  async setFrontPage(courseId: string | number, params: PageInput) {
    return this.request<CanvasPage>("PUT", `/courses/${courseId}/front_page`, {
      wiki_page: snakeCaseObject(params),
    });
  }

  async getBrandVariables(params: { courseId?: string | number; accountId?: string | number }) {
    if (params.courseId !== undefined) {
      return this.request<Record<string, unknown>>("GET", `/courses/${params.courseId}/brand_variables`);
    }
    if (params.accountId !== undefined) {
      return this.request<Record<string, unknown>>("GET", `/accounts/${params.accountId}/brand_variables`);
    }
    return this.request<Record<string, unknown>>("GET", "/brand_variables");
  }

  // -----------------------------------------------------------------------
  // CREATE – Assignment
  // -----------------------------------------------------------------------

  async createAssignment(courseId: string | number, params: {
    name: string;
    description?: string;
    pointsPossible?: number;
    gradingType?: string;
    submissionTypes?: string[];
    dueAt?: string;
    lockAt?: string;
    unlockAt?: string;
    published?: boolean;
    allowedAttempts?: number;
    allowedExtensions?: string[];
    peerReviews?: boolean;
    anonymousGrading?: boolean;
    assignmentGroupId?: number;
    position?: number;
  }) {
    const body = {
      assignment: {
        name: params.name,
        ...(params.description && { description: params.description }),
        ...(params.pointsPossible !== undefined && { points_possible: params.pointsPossible }),
        ...(params.gradingType && { grading_type: params.gradingType }),
        ...(params.submissionTypes?.length && { submission_types: params.submissionTypes }),
        ...(params.dueAt && { due_at: params.dueAt }),
        ...(params.lockAt && { lock_at: params.lockAt }),
        ...(params.unlockAt && { unlock_at: params.unlockAt }),
        ...(params.published !== undefined && { published: params.published }),
        ...(params.allowedAttempts !== undefined && { allowed_attempts: params.allowedAttempts }),
        ...(params.allowedExtensions?.length && { allowed_extensions: params.allowedExtensions }),
        ...(params.peerReviews !== undefined && { peer_reviews: params.peerReviews }),
        ...(params.anonymousGrading !== undefined && { anonymous_grading: params.anonymousGrading }),
        ...(params.assignmentGroupId !== undefined && { assignment_group_id: params.assignmentGroupId }),
        ...(params.position !== undefined && { position: params.position }),
      },
    };
    return this.request<CanvasAssignment>("POST", `/courses/${courseId}/assignments`, body);
  }

  // -----------------------------------------------------------------------
  // CREATE – Rubric
  // -----------------------------------------------------------------------

  async createRubric(courseId: string | number, params: {
    title: string;
    freeFormCriterionComments?: boolean;
    criteria?: RubricCriterionInput[];
    associationId?: number;
    associationType?: string;
    useForGrading?: boolean;
    hideScoreTotal?: boolean;
    purpose?: string;
  }) {
    // Canvas requires criteria as an indexed-hash (Rails style)
    const criteriaHash: Record<string, unknown> = {};
    if (params.criteria) {
      params.criteria.forEach((c, i) => {
        const ratingsHash: Record<string, unknown> = {};
        c.ratings.forEach((r, j) => {
          ratingsHash[String(j)] = { description: r.description, points: r.points };
        });
        criteriaHash[String(i)] = {
          description: c.description,
          long_description: c.longDescription ?? c.long_description ?? "",
          points: c.points,
          ratings: ratingsHash,
        };
      });
    }

    const body: Record<string, unknown> = {
      rubric: {
        title: params.title,
        ...(params.freeFormCriterionComments !== undefined && {
          free_form_criterion_comments: params.freeFormCriterionComments,
        }),
        ...(Object.keys(criteriaHash).length > 0 && { criteria: criteriaHash }),
      },
    };

    if (params.associationId !== undefined) {
      body["rubric_association"] = {
        association_id: params.associationId,
        association_type: params.associationType ?? "Course",
        ...(params.useForGrading !== undefined && { use_for_grading: params.useForGrading }),
        ...(params.hideScoreTotal !== undefined && { hide_score_total: params.hideScoreTotal }),
        ...(params.purpose && { purpose: params.purpose }),
      };
    }

    return this.request<{ rubric: CanvasRubric; rubric_association?: unknown }>(
      "POST",
      `/courses/${courseId}/rubrics`,
      body
    );
  }

  // -----------------------------------------------------------------------
  // Submissions / grading
  // -----------------------------------------------------------------------

  async listSubmissions(courseId: string | number, assignmentId: string | number, params?: {
    include?: string[];
  }) {
    return this.paginate<CanvasSubmission>(
      `/courses/${courseId}/assignments/${assignmentId}/submissions`,
      {
        ...(params?.include && { "include[]": params.include }),
      }
    );
  }

  async getSubmission(courseId: string | number, assignmentId: string | number, userId: string | number, params?: {
    include?: string[];
  }) {
    return this.request<CanvasSubmission>(
      "GET",
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      undefined,
      {
        ...(params?.include && { "include[]": params.include }),
      }
    );
  }

  async gradeSubmission(courseId: string | number, assignmentId: string | number, userId: string | number, params: GradeSubmissionInput) {
    const body: Record<string, unknown> = {};
    if (params.postedGrade !== undefined || params.excuse !== undefined) {
      body["submission"] = {
        ...(params.postedGrade !== undefined && { posted_grade: params.postedGrade }),
        ...(params.excuse !== undefined && { excuse: params.excuse }),
      };
    }
    if (params.textComment) {
      body["comment"] = { text_comment: params.textComment };
    }
    if (params.rubricAssessment?.length) {
      body["rubric_assessment"] = Object.fromEntries(
        params.rubricAssessment.map((row) => [
          row.criterionId,
          {
            ...(row.points !== undefined && { points: row.points }),
            ...(row.ratingId && { rating_id: row.ratingId }),
            ...(row.comments && { comments: row.comments }),
          },
        ])
      );
    }

    return this.request<CanvasSubmission>(
      "PUT",
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      body,
      {
        "include[]": ["submission_comments", "rubric_assessment", "full_rubric_assessment", "user"],
      }
    );
  }
}

function buildModuleItem(params: Partial<ModuleItemInput>): Record<string, unknown> {
  const moduleItem: Record<string, unknown> = {
    ...(params.type && { type: params.type }),
    ...(params.title && { title: params.title }),
    ...(params.contentId !== undefined && { content_id: params.contentId }),
    ...(params.position !== undefined && { position: params.position }),
    ...(params.indent !== undefined && { indent: params.indent }),
    ...(params.pageUrl && { page_url: params.pageUrl }),
    ...(params.externalUrl && { external_url: params.externalUrl }),
    ...(params.newTab !== undefined && { new_tab: params.newTab }),
  };

  if (params.completionRequirementType) {
    moduleItem["completion_requirement"] = {
      type: params.completionRequirementType,
      ...(params.completionRequirementMinScore !== undefined && {
        min_score: params.completionRequirementMinScore,
      }),
    };
  }

  return moduleItem;
}

function snakeCaseObject(input: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [toSnakeCase(key), value])
  );
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// -----------------------------------------------------------------------
// Lightweight Canvas type definitions (partial — the real API returns more)
// -----------------------------------------------------------------------

export interface CourseInput {
  name: string;
  courseCode?: string;
  startAt?: string;
  endAt?: string;
  license?: string;
  isPublic?: boolean;
  publicSyllabus?: boolean;
  publicSyllabusToAuth?: boolean;
  termId?: number;
  timeZone?: string;
  defaultView?: string;
  syllabusBody?: string;
  restrictEnrollmentsToCourseDates?: boolean;
}

export interface AssignmentInput {
  name: string;
  description?: string;
  pointsPossible?: number;
  gradingType?: string;
  submissionTypes?: string[];
  dueAt?: string;
  lockAt?: string;
  unlockAt?: string;
  published?: boolean;
  allowedAttempts?: number;
  allowedExtensions?: string[];
  peerReviews?: boolean;
  anonymousGrading?: boolean;
  assignmentGroupId?: number;
  position?: number;
}

export interface AssignmentGroupInput {
  name: string;
  position?: number;
  groupWeight?: number;
  sisSourceId?: string;
  integrationData?: Record<string, unknown>;
  rules?: Record<string, unknown> | string;
}

export interface ModuleInput {
  name: string;
  unlockAt?: string;
  position?: number;
  requireSequentialProgress?: boolean;
  prerequisiteModuleIds?: number[];
  publishFinalGrade?: boolean;
  published?: boolean;
}

export interface ModuleItemInput {
  type: string;
  title?: string;
  contentId?: number;
  position?: number;
  indent?: number;
  pageUrl?: string;
  externalUrl?: string;
  newTab?: boolean;
  completionRequirementType?: string;
  completionRequirementMinScore?: number;
  published?: boolean;
}

export interface PageInput {
  title?: string;
  body?: string;
  editingRoles?: string;
  published?: boolean;
  frontPage?: boolean;
  notifyOfUpdate?: boolean;
  publishAt?: string;
}

export interface QuizInput {
  title: string;
  description?: string;
  quizType?: string;
  assignmentGroupId?: number;
  timeLimit?: number | null;
  shuffleAnswers?: boolean;
  hideResults?: string | null;
  showCorrectAnswers?: boolean;
  showCorrectAnswersLastAttempt?: boolean;
  showCorrectAnswersAt?: string;
  hideCorrectAnswersAt?: string;
  allowedAttempts?: number;
  scoringPolicy?: string;
  oneQuestionAtATime?: boolean;
  cantGoBack?: boolean;
  accessCode?: string | null;
  ipFilter?: string | null;
  dueAt?: string;
  lockAt?: string;
  unlockAt?: string;
  published?: boolean;
  oneTimeResults?: boolean;
  onlyVisibleToOverrides?: boolean;
}

export interface QuizQuestionInput {
  questionName?: string;
  questionText?: string;
  quizGroupId?: number;
  questionType?: string;
  position?: number;
  pointsPossible?: number;
  correctComments?: string;
  incorrectComments?: string;
  neutralComments?: string;
  textAfterAnswers?: string;
  answers?: Array<Record<string, unknown>>;
}

export interface QuizItemOrder {
  id: number;
  type?: "question" | "group";
}

export interface GradeSubmissionInput {
  postedGrade?: string;
  excuse?: boolean;
  textComment?: string;
  rubricAssessment?: RubricAssessmentInput[];
}

export interface RubricAssessmentInput {
  criterionId: string;
  points?: number;
  ratingId?: string;
  comments?: string;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: string;
  start_at: string | null;
  end_at: string | null;
  enrollment_term_id: number;
  [key: string]: unknown;
}

export interface CanvasAssignment {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  points_possible: number | null;
  grading_type: string;
  submission_types: string[];
  due_at: string | null;
  published: boolean;
  [key: string]: unknown;
}

export interface CanvasAssignmentGroup {
  id: number;
  name: string;
  position: number;
  group_weight: number;
  assignments?: CanvasAssignment[];
  [key: string]: unknown;
}

export interface CanvasQuiz {
  id: number;
  course_id: number;
  title: string;
  description: string | null;
  quiz_type: string;
  points_possible: number | null;
  published: boolean;
  [key: string]: unknown;
}

export interface CanvasQuizQuestion {
  id: number;
  quiz_id: number;
  question_name: string;
  question_type: string;
  question_text: string;
  points_possible: number;
  answers: Array<Record<string, unknown>> | null;
  [key: string]: unknown;
}

export interface CanvasRubric {
  id: number;
  title: string;
  points_possible: number;
  criteria: CanvasRubricCriterion[];
  [key: string]: unknown;
}

export interface CanvasRubricCriterion {
  description: string;
  long_description: string;
  points: number;
  ratings: Array<{ description: string; points: number }>;
}

export interface CanvasModule {
  id: number;
  course_id: number;
  name: string;
  position: number;
  unlock_at: string | null;
  require_sequential_progress: boolean;
  prerequisite_module_ids: number[];
  items_count: number;
  workflow_state: string;
  [key: string]: unknown;
}

export interface CanvasModuleItem {
  id: number;
  module_id: number;
  position: number;
  title: string;
  indent: number;
  type: string;
  content_id: number | null;
  html_url: string;
  url: string | null;
  page_url: string | null;
  external_url: string | null;
  [key: string]: unknown;
}

export interface CanvasPage {
  page_id: number;
  url: string;
  title: string;
  body: string | null;
  published: boolean;
  front_page: boolean;
  editing_roles: string;
  [key: string]: unknown;
}

export interface CanvasSubmission {
  id: number;
  assignment_id: number;
  user_id: number;
  submission_type: string | null;
  body: string | null;
  url: string | null;
  grade: string | null;
  score: number | null;
  workflow_state: string;
  rubric_assessment?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RubricCriterionInput {
  description: string;
  longDescription?: string;
  long_description?: string;
  points: number;
  ratings: Array<{ description: string; points: number }>;
}
