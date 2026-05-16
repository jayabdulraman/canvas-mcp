/**
 * Canvas LMS API client
 *
 * Wraps fetch with auth headers and handles pagination automatically.
 * All list helpers return the full collection across pages (up to a safe cap).
 */

export interface CanvasClientConfig {
  baseUrl: string;   // e.g. https://yourschool.instructure.com
  token: string;     // Canvas API access token
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: CanvasClientConfig) {
    // Normalise – strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  // -----------------------------------------------------------------------
  // Low-level helpers
  // -----------------------------------------------------------------------

  private url(path: string, params?: Record<string, string | number | boolean | string[]>): string {
    const u = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (Array.isArray(val)) {
          for (const v of val) u.searchParams.append(`${key}[]`, String(v));
        } else if (val !== undefined && val !== null && val !== "") {
          u.searchParams.set(key, String(val));
        }
      }
    }
    return u.toString();
  }

  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number | boolean | string[]>): Promise<T> {
    const res = await fetch(this.url(path, params), {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Canvas API ${method} ${path} → ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Fetch all pages from a paginated Canvas list endpoint.
   * Respects the `Link: <url>; rel="next"` header.
   */
  private async paginate<T>(path: string, params?: Record<string, string | number | boolean | string[]>, maxPages = 20): Promise<T[]> {
    let nextUrl: string | null = this.url(path, { per_page: 100, ...params });
    const results: T[] = [];
    let page = 0;

    while (nextUrl && page < maxPages) {
      const res: Response = await fetch(nextUrl, { headers: this.headers });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Canvas API GET ${path} (page ${page + 1}) → ${res.status}: ${text}`);
      }

      const data = (await res.json()) as T[];
      results.push(...data);

      // Follow pagination via Link header
      const link: string = res.headers.get("Link") ?? "";
      const match: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = match ? match[1] : null;
      page++;
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
    const moduleItem: Record<string, unknown> = {
      type: params.type,
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

    return this.request<CanvasModuleItem>(
      "POST",
      `/courses/${courseId}/modules/${moduleId}/items`,
      { module_item: moduleItem }
    );
  }

  // -----------------------------------------------------------------------
  // CREATE – Page
  // -----------------------------------------------------------------------

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
          long_description: c.longDescription ?? "",
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
}

// -----------------------------------------------------------------------
// Lightweight Canvas type definitions (partial — the real API returns more)
// -----------------------------------------------------------------------

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

export interface RubricCriterionInput {
  description: string;
  longDescription?: string;
  points: number;
  ratings: Array<{ description: string; points: number }>;
}
