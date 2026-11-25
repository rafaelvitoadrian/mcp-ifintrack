/**
 * Common preview & approval execution helper for all mutation tools.
 * Enforces:
 * - Strict session permission check before preview and before execute.
 * - Rejects `confirmed: true` from model as fake approval.
 * - Binds approval to sessionId, tool, canonical domain arguments, and live backend snapshot.
 * - Re-reads latest backend snapshot right before executing to reject stale revisions.
 * - Deduplicates identical requestId executions within TTL without auto-retrying uncertain writes.
 */
import {
  createPreview,
  verifyApproval,
  executeWithDeduplication,
  stripApprovalControlFields,
} from "../../approval/manager.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import { formatToolResult } from "../../utils/validation.js";
import type {
  SessionData,
  ApprovalMeta,
  ToolResult,
} from "../../types.js";

export interface PreparedMutation<TContext = unknown> {
  target: string;
  title: string;
  scope?: string;
  scopeLabel?: string;
  changes: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  entries?: Array<[string, string]>;
  previous?: Array<[string, string]>;
  canonicalArgs?: Record<string, unknown>;
  context: TContext;
}

export function extractApprovalMeta(
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): ApprovalMeta | null {
  // Check MCP _meta.approval first, then structured approval object or explicit fields
  const metaApproval =
    (extraMeta?.approval as Record<string, unknown> | undefined) ??
    ((args._meta as Record<string, unknown> | undefined)?.approval as
      | Record<string, unknown>
      | undefined) ??
    (args.approval as Record<string, unknown> | undefined);

  if (metaApproval && typeof metaApproval === "object") {
    const requestId = String(metaApproval.requestId || "").trim();
    const fingerprint = String(metaApproval.fingerprint || "").trim();
    const expiresAt = Number(metaApproval.expiresAt);
    if (requestId && fingerprint && Number.isFinite(expiresAt)) {
      return { requestId, fingerprint, expiresAt };
    }
  }

  if (
    typeof args.requestId === "string" &&
    typeof args.fingerprint === "string" &&
    args.expiresAt !== undefined
  ) {
    return {
      requestId: args.requestId.trim(),
      fingerprint: args.fingerprint.trim(),
      expiresAt: Number(args.expiresAt),
    };
  }

  return null;
}

export async function runMutationTool<TContext>(
  sessionId: string,
  toolName: string,
  rawArgs: Record<string, unknown>,
  prepareFn: (
    session: SessionData,
    domainArgs: Record<string, unknown>,
  ) => Promise<PreparedMutation<TContext>>,
  executeFn: (
    session: SessionData,
    prepared: PreparedMutation<TContext>,
    domainArgs: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  const session = requireSession(sessionId);
  assertToolAccess(session, toolName);

  const action =
    rawArgs.action !== undefined ? String(rawArgs.action).trim() : undefined;
  if (action !== undefined && action !== "preview" && action !== "execute") {
    throw new Error(
      `Nilai action tidak valid: "${action}". Gunakan "preview" atau "execute".`,
    );
  }

  const approvalMeta = extractApprovalMeta(rawArgs, extraMeta);

  // Explicitly reject model-supplied confirmed=true if no valid host approval metadata is present
  if (rawArgs.confirmed === true && !approvalMeta && action !== "preview") {
    throw new Error(
      "Argumen confirmed=true dari model BUKAN persetujuan host/pengguna yang sah. " +
        "Jalankan preview (action='preview' atau prepare_action) terlebih dahulu, lalu eksekusi dengan metadata approval (requestId, fingerprint, expiresAt) yang disetujui host.",
    );
  }

  const domainArgs = stripApprovalControlFields(rawArgs);

  // Phase 1: Preview
  if (action === "preview" || (!approvalMeta && action !== "execute")) {
    const prepared = await prepareFn(session, domainArgs);
    const effectiveArgs = prepared.canonicalArgs ?? domainArgs;
    const approvalReq = createPreview(
      sessionId,
      toolName,
      effectiveArgs,
      prepared.target,
      prepared.changes,
      prepared.snapshot,
      {
        title: prepared.title,
        scope: prepared.scope,
        scopeLabel: prepared.scopeLabel,
        entries: prepared.entries,
        previous: prepared.previous,
      },
    );

    return formatToolResult({
      status: "PREVIEW_READY",
      requiresHostApproval: true,
      message:
        "Preview berhasil dibuat. Host/pengguna harus menyetujui preview ini sebelum eksekusi mutasi dijalankan.",
      tool: toolName,
      title: approvalReq.title,
      requestId: approvalReq.requestId,
      fingerprint: approvalReq.fingerprint,
      expiresAt: approvalReq.expiresAt,
      expiresAtIso: approvalReq.expiresAtIso,
      scope: approvalReq.preview.scope,
      scopeLabel: approvalReq.preview.scopeLabel,
      target: approvalReq.preview.target,
      arguments: approvalReq.arguments,
      entries: approvalReq.preview.entries,
      previous: approvalReq.preview.previous,
      changes: approvalReq.preview.changes,
    });
  }

  // Phase 2: Execute (requires valid approvalMeta)
  if (!approvalMeta) {
    throw new Error(
      `Eksekusi mutasi "${toolName}" memerlukan metadata persetujuan host (requestId, fingerprint, expiresAt) dari preview yang aktif.`,
    );
  }

  const executionResult = await executeWithDeduplication(
    sessionId,
    toolName,
    domainArgs,
    approvalMeta,
    async () => {
      // Re-verify permissions right before write
      const currentSession = requireSession(sessionId);
      assertToolAccess(currentSession, toolName);

      // Re-read current backend state and rebuild preview to verify snapshot has not changed
      const latestPrepared = await prepareFn(currentSession, domainArgs);
      const effectiveArgs = latestPrepared.canonicalArgs ?? domainArgs;

      verifyApproval(
        approvalMeta.requestId,
        sessionId,
        toolName,
        effectiveArgs,
        latestPrepared.snapshot,
        approvalMeta.fingerprint,
        approvalMeta.expiresAt,
      );

      return executeFn(currentSession, latestPrepared, effectiveArgs);
    },
  );

  return formatToolResult({
    ok: true,
    status: "EXECUTED",
    tool: toolName,
    ...executionResult,
  });
}
