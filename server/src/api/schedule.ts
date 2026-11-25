/**
 * Daily Schedule API — separate host, custom headers (user, roles, filter),
 * readiness gate (/dailyschedule/ping), and text/plain columnar TAB-separated parsing.
 * Does NOT forward the main backend's Bearer token!
 * Follows src/services/api.js and src/services/config.js in the original repository.
 */
import { config } from "../config.js";
import { apiRequest } from "./client.js";
import { listUsers } from "./users.js";
import { rowsOf } from "../utils/dto.js";
import { toScheduleDay } from "../utils/encoding.js";
import { ApiError } from "../types.js";
import type { ScheduledEvent, SessionData } from "../types.js";

export const DEFAULT_SCHEDULE_STATUSES = [
  "AWAITING_TRIGGER",
  "DONE",
  "PENDING_DEPENDENCIES",
  "FAILED",
  "IN_PROGRESS",
];

function getScheduleBaseUrl(overrideUrl?: string): string {
  const url = overrideUrl || config.scheduleBaseUrl;
  if (!url) {
    throw new ApiError(
      503,
      "FINTRACK_SCHEDULE_BASE_URL belum dikonfigurasi. Layanan Daily Schedule menggunakan host terpisah dari backend utama.",
      { code: "SCHEDULE_HOST_NOT_CONFIGURED" },
    );
  }
  return url;
}

/**
 * Resolve Daily Schedule headers (`user`, `roles`, `filter`) from the authenticated session.
 * Matches dailyScheduleHeaders() in src/services/api.js:
 * - Resolves user record from /api/v2/user (or verified session userId/username).
 * - user: <USERNAME uppercase>
 * - roles: "ADMIN:USER"
 * - filter: "Participant:AKN/<USERNAME>,EffectiveUserIdent:<id>,EffectiveUserAccountIdent:<id>,EffectivePermissionProfileIdent:<id>,IsAdmin:false"
 * Never accepts caller-supplied headers from model input.
 */
export async function buildScheduleHeaders(
  session: SessionData,
): Promise<Record<string, string>> {
  if (!session || !session.verified || !session.token) {
    throw new ApiError(
      401,
      "Header Daily Schedule membutuhkan sesi login yang aktif.",
      { code: "UNAUTHENTICATED" },
    );
  }

  if (session.scheduleHeadersCache) {
    return session.scheduleHeadersCache;
  }

  let username = session.username?.trim();
  let userIdent: number | undefined =
    session.userId && session.userId > 0 ? session.userId : undefined;

  if (!username || !userIdent) {
    const users = await listUsers(session.token, session.target);
    const identityCandidates = [
      session.email,
      session.principal,
      session.username,
    ]
      .filter(Boolean)
      .map((s) => s.trim().toLowerCase());

    const matched = users.find((u) => {
      const em = String(u.email || "")
        .trim()
        .toLowerCase();
      const un = String(u.username || "")
        .trim()
        .toLowerCase();
      return (
        identityCandidates.includes(em) || identityCandidates.includes(un)
      );
    });

    if (!matched || !matched.id || !matched.username) {
      throw new ApiError(
        422,
        `User login "${session.principal}" tidak ditemukan di GET /api/v2/user atau tidak memiliki username/id; header Daily Schedule tidak dapat dibentuk.`,
        { code: "SCHEDULE_HEADER_RESOLUTION_FAILED" },
      );
    }
    username = String(matched.username).trim();
    userIdent = Number(matched.id);
  }

  const upperUsername = username.toUpperCase();
  const identStr = String(userIdent).trim();
  const headers: Record<string, string> = {
    user: upperUsername,
    roles: "ADMIN:USER",
    filter: `Participant:AKN/${upperUsername},EffectiveUserIdent:${identStr},EffectiveUserAccountIdent:${identStr},EffectivePermissionProfileIdent:${identStr},IsAdmin:false`,
  };

  session.scheduleHeadersCache = headers;
  return headers;
}

/**
 * Readiness gate: GET /dailyschedule/ping.
 * Must respond 2xx before any other schedule operation is executed.
 */
export async function pingSchedule(
  session: SessionData,
  scheduleHost?: string,
): Promise<{ ok: boolean; status: number; host: string }> {
  const base = getScheduleBaseUrl(scheduleHost);
  const headers = await buildScheduleHeaders(session);
  await apiRequest<string>({
    method: "GET",
    url: `${base}/dailyschedule/ping`,
    headers,
    raw: true,
    timeoutMs: config.pingTimeoutMs,
  });
  return { ok: true, status: 200, host: base };
}

export async function listBusinessServices(
  session: SessionData,
  scheduleHost?: string,
): Promise<Record<string, unknown>[]> {
  const base = getScheduleBaseUrl(scheduleHost);
  const headers = await buildScheduleHeaders(session);
  const res = await apiRequest<unknown>({
    method: "GET",
    url: `${base}/dailyschedule/business-services`,
    headers,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res);
}

export async function listScheduleEventActions(
  session: SessionData,
  scheduleHost?: string,
): Promise<Record<string, unknown>[]> {
  const base = getScheduleBaseUrl(scheduleHost);
  const headers = await buildScheduleHeaders(session);
  const res = await apiRequest<unknown>({
    method: "GET",
    url: `${base}/dailyschedule/daily-schedule-event-actions`,
    headers,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res);
}

export interface ScheduleListParams {
  scheduleDay: string; // YYYYMMDD or YYYY-MM-DD
  statuses?: string[] | string;
  businessService?: number | string;
  batch?: number;
  maxItems?: number;
}

/**
 * GET /dailyschedule/event/scheduled
 * - Checks /dailyschedule/ping readiness first.
 * - _batch is mandatory (server returns HTTP 400 without it).
 * - Endpoint ONLY serves text/plain (sending Accept: application/json causes HTTP 406).
 * - Parses columnar descriptor + TAB-separated rows.
 */
export async function listScheduledEvents(
  session: SessionData,
  params: ScheduleListParams,
  scheduleHost?: string,
): Promise<Record<string, unknown>[]> {
  const base = getScheduleBaseUrl(scheduleHost);
  await pingSchedule(session, base);
  const headers = await buildScheduleHeaders(session);

  const batch = params.batch ?? 5;
  const maxItems = params.maxItems ?? 1000;
  const scheduleDay = toScheduleDay(params.scheduleDay);
  const statusList =
    params.statuses === undefined
      ? DEFAULT_SCHEDULE_STATUSES.join(",")
      : Array.isArray(params.statuses)
        ? params.statuses.join(",")
        : String(params.statuses);
  const businessService =
    params.businessService === undefined ||
    params.businessService === null ||
    params.businessService === ""
      ? 1
      : params.businessService;

  const query = new URLSearchParams({
    _batch: String(batch),
    _maxItems: String(maxItems),
    _scheduleday: scheduleDay,
    Istatus: statusList,
    _business_service: String(businessService),
  });

  const response = await apiRequest<string>({
    method: "GET",
    url: `${base}/dailyschedule/event/scheduled?${query.toString()}`,
    headers,
    raw: true,
    timeoutMs: config.requestTimeoutMs,
  });

  const rows = rowsOf(response);
  // Apply client-side businessService filter verification as in original UI
  if (
    businessService !== undefined &&
    rows.some((r) => r.business_service !== undefined && r.business_service !== "")
  ) {
    return rows.filter(
      (r) =>
        r.business_service === undefined ||
        r.business_service === "" ||
        String(r.business_service) === String(businessService),
    );
  }
  return rows;
}

/**
 * GET /dailyschedule/scheduledEvent/{id}
 * Returns full ScheduledEventMsg JSON object needed before trigger, force run, or repeat.
 */
export async function getScheduledEvent(
  session: SessionData,
  eventId: number,
  scheduleHost?: string,
): Promise<ScheduledEvent> {
  const base = getScheduleBaseUrl(scheduleHost);
  await pingSchedule(session, base);
  const headers = await buildScheduleHeaders(session);
  const data = await apiRequest<unknown>({
    method: "GET",
    url: `${base}/dailyschedule/scheduledEvent/${encodeURIComponent(String(eventId))}`,
    headers,
    timeoutMs: config.requestTimeoutMs,
  });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(
      502,
      `Detail scheduled event #${eventId} dari service Daily Schedule tidak valid.`,
      { code: "INVALID_SCHEDULE_EVENT" },
    );
  }
  return data as ScheduledEvent;
}

/**
 * POST /dailyschedule/scheduledEvent/triggerEvent
 * Sends full latest ScheduledEventMsg with operationType = "TRIGGER".
 */
export async function triggerScheduledEvent(
  session: SessionData,
  latestEvent: ScheduledEvent,
  scheduleHost?: string,
): Promise<unknown> {
  const base = getScheduleBaseUrl(scheduleHost);
  const headers = await buildScheduleHeaders(session);
  const payload: ScheduledEvent = {
    ...latestEvent,
    operationType: "TRIGGER",
  };
  return apiRequest<unknown>({
    method: "POST",
    url: `${base}/dailyschedule/scheduledEvent/triggerEvent`,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
}

/**
 * POST /dailyschedule/scheduledEvent/triggerEvent/forcedRun
 * Sends full latest ScheduledEventMsg with operationType = "FORCED_TRIGGER".
 */
export async function forceScheduledEvent(
  session: SessionData,
  latestEvent: ScheduledEvent,
  scheduleHost?: string,
): Promise<unknown> {
  const base = getScheduleBaseUrl(scheduleHost);
  const headers = await buildScheduleHeaders(session);
  const payload: ScheduledEvent = {
    ...latestEvent,
    operationType: "FORCED_TRIGGER",
  };
  return apiRequest<unknown>({
    method: "POST",
    url: `${base}/dailyschedule/scheduledEvent/triggerEvent/forcedRun`,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
}

/**
 * POST /dailyschedule/scheduledEvent/repeat
 * Sends full latest ScheduledEventMsg with operationType = null and new ISO scheduledTime.
 */
export async function repeatScheduledEvent(
  session: SessionData,
  latestEvent: ScheduledEvent,
  scheduledTime: string,
  scheduleHost?: string,
): Promise<unknown> {
  const base = getScheduleBaseUrl(scheduleHost);
  const headers = await buildScheduleHeaders(session);
  const payload: ScheduledEvent = {
    ...latestEvent,
    operationType: null,
    scheduledTime,
  };
  return apiRequest<unknown>({
    method: "POST",
    url: `${base}/dailyschedule/scheduledEvent/repeat`,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
}
