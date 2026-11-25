import { searchAuditEvents, getAuditEntries } from "../../api/audit.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import {
  validatePositiveInt,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import type { ToolResult } from "../../types.js";

export async function handleSearchAuditEvents(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "eventId",
      "userId",
      "from",
      "to",
      "participantMainId",
      "eventTypes",
      "eventName",
      "limit",
      "entryData",
      "entryNames",
      "entityType",
      "entryBusinessId",
    ]),
    "search_audit_events",
  );

  const session = requireSession(sessionId);
  assertToolAccess(session, "search_audit_events");

  const limit =
    args.limit !== undefined ? validatePositiveInt(args.limit, "limit") : 100;
  if (limit > 1000) {
    throw new Error("Limit maksimum search_audit_events adalah 1000.");
  }

  const eventTypes = Array.isArray(args.eventTypes)
    ? args.eventTypes.map((v) => String(v))
    : undefined;
  const entryNames = Array.isArray(args.entryNames)
    ? args.entryNames.map((v) => String(v))
    : undefined;

  const events = await searchAuditEvents(
    session.token,
    {
      eventId: args.eventId !== undefined ? String(args.eventId) : undefined,
      userId: args.userId !== undefined ? String(args.userId) : undefined,
      from: args.from !== undefined ? String(args.from) : undefined,
      to: args.to !== undefined ? String(args.to) : undefined,
      participantMainId:
        args.participantMainId !== undefined
          ? String(args.participantMainId)
          : undefined,
      eventTypes,
      eventName:
        args.eventName !== undefined ? String(args.eventName) : undefined,
      limit,
      entryData:
        args.entryData !== undefined ? String(args.entryData) : undefined,
      entryNames,
      entityType:
        args.entityType !== undefined ? String(args.entityType) : undefined,
      entryBusinessId:
        args.entryBusinessId !== undefined
          ? String(args.entryBusinessId)
          : undefined,
    },
    session.target,
  );

  return formatToolResult(
    {
      count: events.length,
      events,
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleGetAuditEntries(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["eventId", "limit"]),
    "get_audit_entries",
  );
  if (args.eventId === undefined || args.eventId === null || String(args.eventId).trim() === "") {
    throw new Error("eventId wajib diisi.");
  }
  const limit =
    args.limit !== undefined ? validatePositiveInt(args.limit, "limit") : 200;
  if (limit > 1000) {
    throw new Error("Limit maksimum get_audit_entries adalah 1000.");
  }

  const session = requireSession(sessionId);
  assertToolAccess(session, "get_audit_entries");

  const entries = await getAuditEntries(
    session.token,
    String(args.eventId).trim(),
    limit,
    session.target,
  );

  return formatToolResult(
    {
      eventId: String(args.eventId).trim(),
      count: entries.length,
      entries,
    },
    { isUntrustedBackendData: true },
  );
}
