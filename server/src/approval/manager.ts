/**
 * Approval & preview manager for all mutation tools.
 * Follows mcp.js and docs/MCP.md from the original repository:
 * - Previews are bound to sessionId, tool, canonical arguments, and target snapshot via SHA-256 fingerprint.
 * - Model-supplied `confirmed: true` is NEVER trusted as approval.
 * - Host/user approval is bound to requestId, fingerprint, and expiresAt.
 * - Deduplicates identical requestId calls within TTL in process memory without claiming persistent exactly-once.
 */
import { randomUUID, createHash } from "crypto";
import { config } from "../config.js";
import type { ApprovalRequest, ApprovalMeta } from "../types.js";

const pendingApprovals = new Map<string, ApprovalRequest>();
const executedCalls = new Map<
  string,
  {
    signature: string;
    expiresAt: number;
    resultPromise: Promise<unknown>;
  }
>();

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .filter((k) => obj[k] !== undefined)
        .map((key) => [key, canonicalize(obj[key])]),
    );
  }
  return value;
}

export function computeHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

/**
 * Strip non-domain approval control fields from tool arguments before fingerprinting.
 */
export function stripApprovalControlFields(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (
      [
        "action",
        "confirmed",
        "approval",
        "_meta",
        "requestId",
        "fingerprint",
        "expiresAt",
      ].includes(key)
    ) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export function generateFingerprint(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): string {
  const domainArgs = stripApprovalControlFields(args);
  return computeHash({
    sessionId,
    tool,
    args: domainArgs,
    snapshot,
  });
}

export interface CreatePreviewOptions {
  title?: string;
  scope?: string;
  scopeLabel?: string;
  entries?: Array<[string, string]>;
  previous?: Array<[string, string]>;
  ttlMs?: number;
}

/**
 * Create a preview for a mutation operation.
 * Returns the approval request containing requestId, fingerprint, expiresAt, and preview summary.
 */
export function createPreview(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  target: string,
  changes: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  options?: CreatePreviewOptions,
): ApprovalRequest {
  cleanupExpired();

  const requestId = randomUUID();
  const domainArgs = stripApprovalControlFields(args);
  const fingerprint = generateFingerprint(sessionId, tool, domainArgs, snapshot);
  const nowMs = Date.now();
  const ttlMs = options?.ttlMs ?? config.approvalTimeoutMs;
  const expiresAt = nowMs + ttlMs;

  const entries: Array<[string, string]> =
    options?.entries ??
    Object.entries(changes).map(([k, v]) => [
      k,
      typeof v === "object" ? JSON.stringify(v) : String(v ?? ""),
    ]);

  const previous: Array<[string, string]> =
    options?.previous ??
    Object.entries(snapshot).map(([k, v]) => [
      k,
      typeof v === "object" ? JSON.stringify(v) : String(v ?? ""),
    ]);

  const approval: ApprovalRequest = {
    requestId,
    sessionId,
    tool,
    title: options?.title || tool,
    arguments: domainArgs,
    preview: {
      target,
      scope: options?.scope || `${tool}:${target}`,
      scopeLabel: options?.scopeLabel || `${options?.title || tool} pada ${target}`,
      entries,
      previous,
      changes,
      snapshot,
    },
    fingerprint,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
    approved: false,
  };

  pendingApprovals.set(requestId, approval);
  return approval;
}

/**
 * Record explicit host/user decision approving a pending preview request.
 * In stdio or HTTP host mode, the host approves the preview before execution,
 * or supplies the signed `{ requestId, fingerprint, expiresAt }` issued by createPreview.
 */
export function approvePreview(
  requestId: string,
  sessionId: string,
  approvedBy: string = "host",
): ApprovalRequest {
  cleanupExpired();
  const approval = pendingApprovals.get(requestId);
  if (!approval) {
    throw new Error(
      "Preview persetujuan tidak ditemukan atau sudah kedaluwarsa.",
    );
  }
  if (approval.sessionId !== sessionId) {
    throw new Error("Persetujuan terikat pada sesi yang berbeda.");
  }
  if (Date.now() > approval.expiresAt) {
    pendingApprovals.delete(requestId);
    throw new Error("Preview persetujuan sudah kedaluwarsa.");
  }
  approval.approved = true;
  approval.approvedBy = approvedBy;
  approval.approvedAt = new Date().toISOString();
  return approval;
}

/**
 * Verify that an approval is valid, has not expired, is bound to the same session and tool,
 * and matches the latest data snapshot (rejects stale revisions!).
 */
export function verifyApproval(
  requestId: string,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  currentSnapshot: Record<string, unknown>,
  providedFingerprint?: string,
  providedExpiresAt?: number,
): ApprovalRequest {
  if (!requestId || typeof requestId !== "string" || !/^[\w-]{8,100}$/.test(requestId)) {
    throw new Error(
      "Persetujuan host tidak valid: requestId wajib disertakan dari hasil preview.",
    );
  }

  const approval = pendingApprovals.get(requestId);
  if (!approval) {
    throw new Error(
      "Persetujuan tidak ditemukan, sudah kedaluwarsa, atau sudah digunakan. Siapkan preview baru terlebih dahulu.",
    );
  }

  if (approval.sessionId !== sessionId) {
    throw new Error("Persetujuan terikat pada sesi pengguna yang berbeda.");
  }

  if (approval.tool !== tool) {
    throw new Error(
      `Persetujuan dibuat untuk tool "${approval.tool}", bukan "${tool}".`,
    );
  }

  if (Date.now() > approval.expiresAt) {
    pendingApprovals.delete(requestId);
    throw new Error(
      "Persetujuan telah kedaluwarsa. Silakan buat preview baru.",
    );
  }

  if (
    providedExpiresAt !== undefined &&
    Number(providedExpiresAt) !== approval.expiresAt
  ) {
    throw new Error(
      "Nilai expiresAt pada metadata approval tidak cocok dengan preview asli.",
    );
  }

  if (
    providedFingerprint !== undefined &&
    providedFingerprint !== approval.fingerprint
  ) {
    throw new Error(
      "Fingerprint persetujuan tidak cocok dengan preview yang disetujui.",
    );
  }

  const domainArgs = stripApprovalControlFields(args);
  const currentFingerprint = generateFingerprint(
    sessionId,
    tool,
    domainArgs,
    currentSnapshot,
  );

  if (approval.fingerprint !== currentFingerprint) {
    pendingApprovals.delete(requestId);
    throw new Error(
      "Data atau argumen telah berubah sejak preview dibuat (revisi basi / stale snapshot). Buat preview baru dengan data terbaru.",
    );
  }

  // Consume pending approval so it cannot be replayed with different parameters
  pendingApprovals.delete(requestId);
  return approval;
}

/**
 * Execute a mutation with in-memory requestId deduplication (matches mcp.js calls Map).
 * Prevents accidental double-execution of the same requestId within TTL, while rejecting
 * reuse of the same requestId for different tool/args/fingerprint.
 */
export async function executeWithDeduplication<T>(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  approvalMeta: ApprovalMeta,
  operation: () => Promise<T>,
): Promise<T> {
  cleanupExpired();

  const dedupKey = computeHash({
    sessionId,
    requestId: approvalMeta.requestId,
  });
  const domainArgs = stripApprovalControlFields(args);
  const signature = computeHash({
    tool,
    args: domainArgs,
    fingerprint: approvalMeta.fingerprint,
  });

  const existing = executedCalls.get(dedupKey);
  if (existing) {
    if (existing.signature !== signature) {
      throw new Error(
        "ID permintaan (requestId) sudah pernah digunakan untuk tindakan atau parameter yang berbeda.",
      );
    }
    return (await existing.resultPromise) as T;
  }

  if (executedCalls.size >= 500) {
    throw new Error(
      "Terlalu banyak tindakan mutasi sedang diproses. Tunggu beberapa saat lalu siapkan ulang.",
    );
  }

  const resultPromise = operation();
  executedCalls.set(dedupKey, {
    signature,
    expiresAt: Date.now() + config.approvalTimeoutMs,
    resultPromise,
  });

  try {
    return await resultPromise;
  } catch (err) {
    // Keep failed execution or remove? If validation failed before write, allow new requestId.
    throw err;
  }
}

export function getApproval(requestId: string): ApprovalRequest | undefined {
  cleanupExpired();
  return pendingApprovals.get(requestId);
}

export function hasPendingApproval(requestId: string): boolean {
  cleanupExpired();
  return pendingApprovals.has(requestId);
}

export function cancelApproval(requestId: string): boolean {
  return pendingApprovals.delete(requestId);
}

export function clearAllApprovals(): void {
  pendingApprovals.clear();
  executedCalls.clear();
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [id, approval] of pendingApprovals.entries()) {
    if (now > approval.expiresAt) {
      pendingApprovals.delete(id);
    }
  }
  for (const [key, call] of executedCalls.entries()) {
    if (now > call.expiresAt) {
      executedCalls.delete(key);
    }
  }
}

export function getPendingCount(): number {
  cleanupExpired();
  return pendingApprovals.size;
}
