/**
 * Audit trail API and query builder.
 * Follows src/utils/audit.js in the original repository:
 * - Required empty parameters are always sent.
 * - eventType and entryName are sent as repeated query parameters; when unselected,
 *   sends the complete enum list from metadata (or defaults).
 * - Converts dates to ISO UTC and validates from <= to.
 * - Redacts credentials from all audit events and entryData (including JSON-in-string and Java PO format).
 */
import { config } from "../config.js";
import { authenticatedRequest } from "./client.js";
import { redactAuditValue } from "../utils/redact.js";
import { rowsOf } from "../utils/dto.js";
import type { AuditEvent, AuditEntry } from "../types.js";

export const DEFAULT_AUDIT_TYPES = [
  "INCOMING_MESSAGE",
  "SCHEDULED_EVENT",
  "SYSTEM_EVENT",
  "WEB_REQUEST",
  "DATA_MIGRATION",
];

export const DEFAULT_AUDIT_ENTRY_NAMES = [
  "CREATED",
  "DELETED",
  "ERROR",
  "RESULT",
  "SENDING",
  "START",
  "STOP",
  "UPDATED",
  "WARN",
];

export interface AuditFilterInput {
  eventId?: string | number;
  userId?: string | number;
  from?: string;
  to?: string;
  participantMainId?: string;
  eventTypes?: string[];
  eventName?: string;
  limit?: number;
  entryData?: string;
  entryNames?: string[];
  entityType?: string;
  entryBusinessId?: string;
}

export interface AuditMetadata {
  eventTypes?: string[];
  entryNames?: string[];
}

export function parseAuditDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function auditEnumValues(data: unknown): string[] {
  if (
    !Array.isArray(data) ||
    !data.length ||
    data.some((value) => typeof value !== "string" || !value.trim())
  ) {
    throw new Error("Metadata enum audit tidak valid.");
  }
  return [...new Set(data.map((s) => s.trim()))];
}

/**
 * Matches auditEventsQuery in src/utils/audit.js.
 */
export function buildAuditEventsQuery(
  filter: AuditFilterInput = {},
  metadata: AuditMetadata = {},
): URLSearchParams {
  const resolveDate = (value: string | undefined, fallback: string): string => {
    if (!value) return fallback;
    const parsed = parseAuditDate(value);
    if (!parsed) throw new Error(`Tanggal audit tidak valid: "${value}"`);
    return parsed.toISOString();
  };

  const from = resolveDate(filter.from, "2000-01-01T00:00:00Z");
  const to = resolveDate(filter.to, "2099-12-31T23:59:59Z");
  if (new Date(from) > new Date(to)) {
    throw new Error("Tanggal 'from' tidak boleh melewati tanggal 'to'.");
  }

  const limit = Number(filter.limit ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
    throw new Error("Limit harus bilangan bulat antara 1 dan 100000.");
  }

  const params = new URLSearchParams({
    eventId: String(filter.eventId ?? "").trim(),
    userId: String(filter.userId ?? "").trim(),
    from,
    to,
    participantMainId: String(filter.participantMainId ?? "").trim(),
    eventName: String(filter.eventName ?? "").trim(),
    limit: String(limit),
    entryData: String(filter.entryData ?? "").trim(),
    entityType: String(filter.entityType ?? "").trim(),
    entryBusinessId: String(filter.entryBusinessId ?? "").trim(),
  });

  const typeCatalog = auditEnumValues(
    metadata.eventTypes?.length ? metadata.eventTypes : DEFAULT_AUDIT_TYPES,
  );
  const selectedTypes = filter.eventTypes?.length
    ? filter.eventTypes
    : typeCatalog;
  if (selectedTypes.some((val) => !typeCatalog.includes(val))) {
    throw new Error("Pilihan filter eventType tidak tersedia di server.");
  }
  for (const val of selectedTypes) {
    params.append("eventType", val);
  }

  const entryCatalog = auditEnumValues(
    metadata.entryNames?.length
      ? metadata.entryNames
      : DEFAULT_AUDIT_ENTRY_NAMES,
  );
  const selectedEntries = filter.entryNames?.length
    ? filter.entryNames
    : entryCatalog;
  if (selectedEntries.some((val) => !entryCatalog.includes(val))) {
    throw new Error("Pilihan filter entryName tidak tersedia di server.");
  }
  for (const val of selectedEntries) {
    params.append("entryName", val);
  }

  return params;
}

export function normalizeAuditEvent(row: Record<string, unknown>): AuditEvent {
  const eventId = row.id ?? row.eventId;
  if (eventId === null || eventId === undefined || String(eventId).trim() === "") {
    throw new Error("Event audit dari backend tidak memiliki ID.");
  }
  const redacted = redactAuditValue(row);
  return {
    ...redacted,
    eventId: String(eventId),
    type: String(redacted.type ?? redacted.eventType ?? ""),
    name: String(redacted.name ?? redacted.eventName ?? ""),
    timeStamp: redacted.timeStamp ?? redacted.timestamp,
    nanoSecondsOnTimestamp: redacted.nanoSecondsOnTimestamp,
    user: String(
      redacted.userName ?? redacted.username ?? redacted.user ?? "",
    ),
    participant: String(
      redacted.participantMainId ?? redacted.participant ?? "",
    ),
    parentId: redacted.parentId,
    remoteHost: redacted.remoteHost,
  };
}

export async function getEventTypes(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<string[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/event/eventtypes`,
    timeoutMs: config.requestTimeoutMs,
  });
  return auditEnumValues(res);
}

export async function getEventEntryNames(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<string[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/event/evententrynames`,
    timeoutMs: config.requestTimeoutMs,
  });
  return auditEnumValues(res);
}

export async function searchAuditEvents(
  token: string,
  filter: AuditFilterInput = {},
  targetUrl: string = config.apiBaseUrl,
): Promise<AuditEvent[]> {
  // Fetch live enum metadata if possible, fallback to verified defaults
  let eventTypes: string[] | undefined;
  let entryNames: string[] | undefined;
  try {
    [eventTypes, entryNames] = await Promise.all([
      getEventTypes(token, targetUrl),
      getEventEntryNames(token, targetUrl),
    ]);
  } catch {
    eventTypes = DEFAULT_AUDIT_TYPES;
    entryNames = DEFAULT_AUDIT_ENTRY_NAMES;
  }

  const query = buildAuditEventsQuery(filter, { eventTypes, entryNames });
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/event/events?${query.toString()}`,
    timeoutMs: config.requestTimeoutMs,
  });

  const rows = rowsOf(redactAuditValue(res));
  return rows.map(normalizeAuditEvent);
}

export async function getAuditEntries(
  token: string,
  eventId: number | string,
  limit: number = 1000,
  targetUrl: string = config.apiBaseUrl,
): Promise<AuditEntry[]> {
  const query = new URLSearchParams({
    eventId: String(eventId),
    limit: String(limit),
  });
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/event/evententries?${query.toString()}`,
    timeoutMs: config.requestTimeoutMs,
  });
  const rows = Array.isArray(res)
    ? res
    : Array.isArray((res as Record<string, unknown>)?.data)
      ? ((res as Record<string, unknown>).data as unknown[])
      : null;
  if (
    !rows ||
    rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error("Respons audit entries dari backend tidak valid.");
  }
  return rows.map((row) => redactAuditValue(row as AuditEntry));
}
