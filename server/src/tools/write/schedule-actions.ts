/**
 * Daily Schedule mutation tools:
 * - trigger_scheduled_event (POST /dailyschedule/scheduledEvent/triggerEvent, operationType="TRIGGER", Initiate permission)
 * - force_scheduled_event (POST /dailyschedule/scheduledEvent/triggerEvent/forcedRun, operationType="FORCED_TRIGGER", Approve permission)
 * - repeat_scheduled_event (POST /dailyschedule/scheduledEvent/repeat, operationType=null + scheduledTime ISO, Initiate permission)
 *
 * All three tools read the full latest ScheduledEventMsg object via GET /dailyschedule/scheduledEvent/{id}
 * during preview AND right before execution, binding the snapshot so stale event states are rejected.
 */
import {
  getScheduledEvent,
  triggerScheduledEvent,
  forceScheduledEvent,
  repeatScheduledEvent,
} from "../../api/schedule.js";
import {
  validatePositiveInt,
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type {
  ScheduledEvent,
  SessionData,
  ToolResult,
} from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

function buildEventSnapshot(event: ScheduledEvent): Record<string, unknown> {
  return {
    id: event.id,
    name: event.name ?? null,
    status: event.status ?? null,
    scheduledTime: event.scheduledTime ?? event.scheduled_time ?? null,
    executionDateTime: event.executiondatetime ?? null,
  };
}

export async function prepareTriggerScheduledEvent(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    eventId: number;
    latestEvent: ScheduledEvent;
  }>
> {
  const eventId = validatePositiveInt(domainArgs.eventId, "eventId");
  const latestEvent = await getScheduledEvent(session, eventId);

  return {
    target: `scheduled_event:${eventId}`,
    title: "Trigger scheduled event",
    scope: `trigger_scheduled_event:${eventId}`,
    scopeLabel: `Trigger event #${eventId} (${String(latestEvent.name || "")})`,
    changes: {
      eventId,
      operationType: "TRIGGER",
      currentStatus: latestEvent.status ?? null,
    },
    snapshot: buildEventSnapshot(latestEvent),
    entries: [
      ["Event ID", String(eventId)],
      ["Nama Event", String(latestEvent.name || "-")],
      ["Status Saat Ini", String(latestEvent.status || "-")],
      ["Operasi", "TRIGGER"],
    ],
    previous: [
      ["Status", String(latestEvent.status || "-")],
    ],
    context: { eventId, latestEvent },
  };
}

export async function handleTriggerScheduledEvent(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["eventId", ...COMMON_APPROVAL_KEYS]),
    "trigger_scheduled_event",
  );

  return runMutationTool(
    sessionId,
    "trigger_scheduled_event",
    args,
    prepareTriggerScheduledEvent,
    async (session, prepared) => {
      const res = await triggerScheduledEvent(
        session,
        prepared.context.latestEvent,
      );
      return {
        message: `Trigger scheduled event #${prepared.context.eventId} berhasil dikirim.`,
        eventId: prepared.context.eventId,
        result: res,
      };
    },
    extraMeta,
  );
}

export async function prepareForceScheduledEvent(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    eventId: number;
    latestEvent: ScheduledEvent;
  }>
> {
  const eventId = validatePositiveInt(domainArgs.eventId, "eventId");
  const latestEvent = await getScheduledEvent(session, eventId);

  return {
    target: `scheduled_event:${eventId}:forced`,
    title: "Force run scheduled event",
    scope: `force_scheduled_event:${eventId}`,
    scopeLabel: `Force run (bypass dependencies) event #${eventId} (${String(latestEvent.name || "")})`,
    changes: {
      eventId,
      operationType: "FORCED_TRIGGER",
      warning: "Force run dapat melewati dependency jadwal!",
      currentStatus: latestEvent.status ?? null,
    },
    snapshot: buildEventSnapshot(latestEvent),
    entries: [
      ["Event ID", String(eventId)],
      ["Nama Event", String(latestEvent.name || "-")],
      ["Status Saat Ini", String(latestEvent.status || "-")],
      ["Operasi", "FORCED_TRIGGER (Melewati Dependency)"],
    ],
    previous: [
      ["Status", String(latestEvent.status || "-")],
    ],
    context: { eventId, latestEvent },
  };
}

export async function handleForceScheduledEvent(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["eventId", ...COMMON_APPROVAL_KEYS]),
    "force_scheduled_event",
  );

  return runMutationTool(
    sessionId,
    "force_scheduled_event",
    args,
    prepareForceScheduledEvent,
    async (session, prepared) => {
      const res = await forceScheduledEvent(
        session,
        prepared.context.latestEvent,
      );
      return {
        message: `Force run scheduled event #${prepared.context.eventId} berhasil dikirim.`,
        eventId: prepared.context.eventId,
        result: res,
      };
    },
    extraMeta,
  );
}

export async function prepareRepeatScheduledEvent(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    eventId: number;
    scheduledTime: string;
    latestEvent: ScheduledEvent;
  }>
> {
  const eventId = validatePositiveInt(domainArgs.eventId, "eventId");
  const rawTime = validateString(
    domainArgs.scheduledTime,
    "scheduledTime",
    60,
  );
  const parsedDate = new Date(rawTime);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(
      `scheduledTime harus berupa format ISO date-time yang valid, diterima: "${rawTime}"`,
    );
  }
  const scheduledTime = parsedDate.toISOString();
  const latestEvent = await getScheduledEvent(session, eventId);

  return {
    target: `scheduled_event:${eventId}:repeat`,
    title: "Repeat scheduled event",
    scope: `repeat_scheduled_event:${eventId}`,
    scopeLabel: `Repeat event #${eventId} (${String(latestEvent.name || "")}) pada ${scheduledTime}`,
    changes: {
      eventId,
      operationType: null,
      scheduledTime,
      currentStatus: latestEvent.status ?? null,
    },
    snapshot: buildEventSnapshot(latestEvent),
    entries: [
      ["Event ID", String(eventId)],
      ["Nama Event", String(latestEvent.name || "-")],
      ["Status Saat Ini", String(latestEvent.status || "-")],
      ["Waktu Pengulangan Baru (UTC)", scheduledTime],
    ],
    previous: [
      ["Status", String(latestEvent.status || "-")],
      [
        "Waktu Jadwal Lama",
        String(latestEvent.scheduledTime ?? latestEvent.scheduled_time ?? "-"),
      ],
    ],
    context: { eventId, scheduledTime, latestEvent },
  };
}

export async function handleRepeatScheduledEvent(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["eventId", "scheduledTime", ...COMMON_APPROVAL_KEYS]),
    "repeat_scheduled_event",
  );

  return runMutationTool(
    sessionId,
    "repeat_scheduled_event",
    args,
    prepareRepeatScheduledEvent,
    async (session, prepared) => {
      const res = await repeatScheduledEvent(
        session,
        prepared.context.latestEvent,
        prepared.context.scheduledTime,
      );
      return {
        message: `Repeat scheduled event #${prepared.context.eventId} untuk waktu ${prepared.context.scheduledTime} berhasil dikirim.`,
        eventId: prepared.context.eventId,
        scheduledTime: prepared.context.scheduledTime,
        result: res,
      };
    },
    extraMeta,
  );
}
