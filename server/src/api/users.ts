import { config } from "../config.js";
import { authenticatedRequest } from "./client.js";
import { rowsOf } from "../utils/dto.js";
import { normalizeUser } from "../utils/redact.js";
import { userCreate, userUpdate } from "../utils/payload.js";
import { ApiError } from "../types.js";
import type { UserRecord } from "../types.js";

export async function listUsers(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRecord[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res)
    .map(normalizeUser)
    .filter((u): u is UserRecord => u !== null);
}

export async function getUser(
  token: string,
  userId: number,
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRecord> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/${encodeURIComponent(String(userId))}`,
    timeoutMs: config.requestTimeoutMs,
    emptyOn200AsNull: true,
  });
  const normalized = normalizeUser(res);
  if (!normalized || !normalized.id) {
    throw new ApiError(
      404,
      `User #${userId} tidak ditemukan (HTTP 200 dengan body kosong).`,
      { code: "USER_NOT_FOUND" },
    );
  }
  return normalized;
}

export async function freshUser(
  token: string,
  userId: number,
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRecord> {
  return getUser(token, userId, targetUrl);
}

export async function createUser(
  token: string,
  values: Parameters<typeof userCreate>[0],
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRecord> {
  const payload = userCreate(values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "POST",
    url: `${targetUrl}/api/v2/user`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeUser(res) ?? ({} as UserRecord);
}

export async function updateUser(
  token: string,
  latestRecord: UserRecord,
  values: Parameters<typeof userUpdate>[1],
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRecord> {
  const payload = userUpdate(latestRecord, values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "PUT",
    url: `${targetUrl}/api/v2/user`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeUser(res) ?? ({} as UserRecord);
}

/**
 * Check whether a user record meets the backend's isFutureReadyRevision() rule:
 * revisionState.ready === true && revisionEffectiveFrom == null && revisionEffectiveTo == null.
 * Master records ALWAYS have revisionEffectiveFrom populated and cannot be deleted via REST API.
 */
export function isFutureReadyUserRevision(record: UserRecord): boolean {
  const revState =
    record.revisionState ?? record.lifecycleEntity?.revisionState;
  const effFrom =
    record.revisionEffectiveFrom ??
    record.lifecycleEntity?.revisionEffectiveFrom;
  const effTo =
    record.revisionEffectiveTo ?? record.lifecycleEntity?.revisionEffectiveTo;

  return !!(revState && revState.ready === true) && effFrom == null && effTo == null;
}

export async function deleteUserRevision(
  token: string,
  revisionId: number,
  targetUrl: string = config.apiBaseUrl,
): Promise<unknown> {
  const record = await getUser(token, revisionId, targetUrl);
  if (!isFutureReadyUserRevision(record)) {
    const stateName =
      record.revisionState?.name ??
      record.lifecycleEntity?.revisionState?.name ??
      "unknown";
    const effFrom =
      record.revisionEffectiveFrom ??
      record.lifecycleEntity?.revisionEffectiveFrom ??
      null;
    throw new ApiError(
      422,
      `Backend tidak mengizinkan penghapusan user/revisi #${revisionId}. ` +
        `UserPersister.deleteUsers() hanya mengizinkan future-ready revision ` +
        `(revisionState.ready=true dan revisionEffectiveFrom kosong; saat ini state=${String(stateName)}, revisionEffectiveFrom=${String(effFrom)}). ` +
        `Record master tidak dapat dihapus paksa melalui API.`,
      { code: "DELETE_REVISION_NOT_ALLOWED" },
    );
  }
  return authenticatedRequest<unknown>(token, {
    method: "DELETE",
    url: `${targetUrl}/api/v2/user/${encodeURIComponent(String(revisionId))}`,
    timeoutMs: config.writeTimeoutMs,
  });
}

export async function changeUserPassword(
  token: string,
  identUser: number,
  newPassword: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<Record<string, unknown>> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "POST",
    url: `${targetUrl}/api/v2/user/change-password`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identUser: Number(identUser), newPassword }),
    timeoutMs: config.writeTimeoutMs,
  });
  return (normalizeUser(res) ?? { ok: true, identUser }) as Record<
    string,
    unknown
  >;
}
