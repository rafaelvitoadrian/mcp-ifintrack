import {
  listScheduledEvents,
  getScheduledEvent,
} from "../../api/schedule.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import {
  validatePositiveInt,
  validateString,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import type { ToolResult } from "../../types.js";

export async function handleListScheduledEvents(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "scheduleDay",
      "statuses",
      "businessService",
      "batch",
      "maxItems",
    ]),
    "list_scheduled_events",
  );

  const scheduleDay = validateString(args.scheduleDay, "scheduleDay", 20);
  const batch =
    args.batch !== undefined ? validatePositiveInt(args.batch, "batch") : 5;
  const maxItems =
    args.maxItems !== undefined
      ? validatePositiveInt(args.maxItems, "maxItems")
      : 1000;
  const statuses = Array.isArray(args.statuses)
    ? args.statuses.map(String)
    : typeof args.statuses === "string"
      ? args.statuses
      : undefined;
  const businessService =
    args.businessService !== undefined
      ? (args.businessService as number | string)
      : 1;

  const session = requireSession(sessionId);
  assertToolAccess(session, "list_scheduled_events");

  const events = await listScheduledEvents(session, {
    scheduleDay,
    statuses,
    businessService,
    batch,
    maxItems,
  });

  return formatToolResult(
    {
      scheduleDay,
      businessService,
      count: events.length,
      events,
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleGetScheduledEvent(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(["eventId"]), "get_scheduled_event");
  const eventId = validatePositiveInt(args.eventId, "eventId");

  const session = requireSession(sessionId);
  assertToolAccess(session, "get_scheduled_event");

  const event = await getScheduledEvent(session, eventId);
  return formatToolResult(
    {
      event,
    },
    { isUntrustedBackendData: true },
  );
}
