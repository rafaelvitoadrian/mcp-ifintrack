/**
 * Delete user revision tool: delete_user_revision.
 * Follows CONTRACTS.md and src/services/api.js:
 * - DELETE /api/v2/user/{revisionId} is ONLY allowed for a future-ready revision
 *   (revisionState.ready === true && revisionEffectiveFrom == null && revisionEffectiveTo == null).
 * - Master records ALWAYS have revisionEffectiveFrom populated and are rejected before calling DELETE.
 */
import {
  getUser,
  isFutureReadyUserRevision,
  deleteUserRevision,
} from "../../api/users.js";
import {
  validatePositiveInt,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type { UserRecord, SessionData, ToolResult } from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

export async function prepareDeleteUserRevision(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    revisionId: number;
    record: UserRecord;
  }>
> {
  const revisionId = validatePositiveInt(
    domainArgs.revisionId,
    "revisionId",
  );

  const record = await getUser(session.token, revisionId, session.target);
  if (!isFutureReadyUserRevision(record)) {
    const stateName =
      record.revisionState?.name ??
      record.lifecycleEntity?.revisionState?.name ??
      "unknown";
    const effFrom =
      record.revisionEffectiveFrom ??
      record.lifecycleEntity?.revisionEffectiveFrom ??
      null;
    throw new Error(
      `Penghapusan ditolak: record #${revisionId} bukan future-ready revision ` +
        `(revisionState=${String(stateName)}, revisionEffectiveFrom=${String(effFrom)}). ` +
        `Backend hanya mengizinkan penghapusan revisi berstatus Ready dengan effective-from kosong, bukan record master.`,
    );
  }

  const snapshot = {
    id: record.id,
    identRevision: record.identRevision ?? null,
    username: record.username ?? null,
    email: record.email ?? null,
    revisionReady: true,
    revisionEffectiveFrom: null,
  };

  return {
    target: `user_revision:${revisionId}`,
    title: "Hapus revisi user",
    scope: `delete_user_revision:${revisionId}`,
    scopeLabel: `Hapus revisi user #${revisionId} (${record.username || record.email})`,
    changes: {
      revisionId,
      operation: "DELETE",
    },
    snapshot,
    entries: [
      ["Revision ID", String(revisionId)],
      ["Username", String(record.username || "")],
      ["Email", String(record.email || "")],
      ["Status Revisi", "Ready (effective-from kosong)"],
    ],
    previous: [
      ["Username", String(record.username || "")],
      ["Email", String(record.email || "")],
    ],
    context: { revisionId, record },
  };
}

export async function handleDeleteUserRevision(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["revisionId", ...COMMON_APPROVAL_KEYS]),
    "delete_user_revision",
  );

  return runMutationTool(
    sessionId,
    "delete_user_revision",
    args,
    prepareDeleteUserRevision,
    async (session, prepared) => {
      await deleteUserRevision(
        session.token,
        prepared.context.revisionId,
        session.target,
      );
      return {
        message: `Revisi user #${prepared.context.revisionId} berhasil dihapus.`,
        recordId: prepared.context.revisionId,
      };
    },
    extraMeta,
  );
}
