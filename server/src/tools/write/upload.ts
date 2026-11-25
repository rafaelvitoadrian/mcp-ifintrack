/**
 * File upload tool: upload_file.
 * Follows ENDPOINTS.md, CONTRACTS.md, and src/services/api.js:
 * - POST /fileupload/{folder} with multipart/form-data field `file`.
 * - Lets FormData / fetch generate the multipart boundary automatically (never hardcodes Content-Type boundary).
 * - Sends headers `filter: PARTICIPANT:<participant>` and `roles: <role>` (from allowed uploadRoles).
 * - Restricts file sources strictly to the configured FINTRACK_UPLOAD_DIR directory (prevents arbitrary host file read / path traversal).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { authenticatedRequest } from "../../api/client.js";
import {
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type { SessionData, ToolResult } from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

async function resolveSafeUploadFile(fileName: string): Promise<{
  fullPath: string;
  safeName: string;
  sizeBytes: number;
}> {
  const uploadDir = process.env.FINTRACK_UPLOAD_DIR;
  if (!uploadDir || !uploadDir.trim()) {
    throw new Error(
      "FINTRACK_UPLOAD_DIR belum dikonfigurasi pada server. Upload file dibatasi hanya dari direktori yang diizinkan pengelola.",
    );
  }
  const baseName = path.basename(fileName);
  if (
    baseName !== fileName ||
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw new Error(
      "Nama file tidak valid: path traversal tidak diizinkan. Gunakan hanya nama file di dalam FINTRACK_UPLOAD_DIR.",
    );
  }

  const resolvedDir = path.resolve(uploadDir);
  const fullPath = path.resolve(resolvedDir, baseName);
  if (!fullPath.startsWith(resolvedDir + path.sep)) {
    throw new Error("Akses file di luar FINTRACK_UPLOAD_DIR ditolak.");
  }

  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(
      `File "${baseName}" tidak ditemukan di direktori upload yang diizinkan.`,
    );
  }
  if (stat.size > 10 * 1024 * 1024) {
    throw new Error("Ukuran file melebihi batas maksimum upload (10 MB).");
  }

  return { fullPath, safeName: baseName, sizeBytes: stat.size };
}

export async function prepareUploadFile(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    folder: string;
    fileName: string;
    fullPath: string;
    sizeBytes: number;
    participant: string;
    role: string;
  }>
> {
  const fileName = validateString(domainArgs.fileName, "fileName", 255);
  const folder =
    domainArgs.folder !== undefined
      ? validateString(domainArgs.folder, "folder", 100)
      : "dashboard";
  if (!/^[A-Za-z0-9_-]+$/.test(folder)) {
    throw new Error(
      "Nama folder upload hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung.",
    );
  }

  const role =
    domainArgs.role !== undefined
      ? validateString(domainArgs.role, "role", 60)
      : config.uploadDefaultRole;
  if (
    !(config.uploadRoles as readonly string[]).includes(role) &&
    !role.split(":").every((r) => (config.uploadRoles as readonly string[]).includes(r))
  ) {
    throw new Error(
      `Role upload tidak valid. Pilihan yang diizinkan: ${config.uploadRoles.join(", ")}.`,
    );
  }

  const defaultParticipant = session.username
    ? `AKN/${session.username.toUpperCase()}`
    : "DEFAULT_PARTICIPANT";
  const participant =
    domainArgs.participant !== undefined
      ? validateString(domainArgs.participant, "participant", 120)
      : defaultParticipant;

  const { fullPath, safeName, sizeBytes } =
    await resolveSafeUploadFile(fileName);

  return {
    target: `fileupload:${folder}:${safeName}`,
    title: "Upload file ke backend",
    scope: `upload_file:${folder}`,
    scopeLabel: `Upload ${safeName} (${sizeBytes} bytes) ke /fileupload/${folder}`,
    changes: {
      folder,
      fileName: safeName,
      sizeBytes,
      participant,
      role,
    },
    snapshot: {
      folder,
      fileName: safeName,
      sizeBytes,
    },
    entries: [
      ["Nama File", safeName],
      ["Ukuran", `${sizeBytes} bytes`],
      ["Folder Tujuan", `/fileupload/${folder}`],
      ["Header filter", `PARTICIPANT:${participant}`],
      ["Header roles", role],
    ],
    previous: [],
    context: {
      folder,
      fileName: safeName,
      fullPath,
      sizeBytes,
      participant,
      role,
    },
  };
}

export async function handleUploadFile(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "fileName",
      "folder",
      "participant",
      "role",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "upload_file",
  );

  return runMutationTool(
    sessionId,
    "upload_file",
    args,
    prepareUploadFile,
    async (session, prepared) => {
      const { folder, fileName, fullPath, participant, role } =
        prepared.context;
      const fileBuffer = await fs.readFile(fullPath);
      const blob = new Blob([fileBuffer]);
      const form = new FormData();
      form.append("file", blob, fileName);

      // Do NOT set Content-Type manually so fetch sets multipart/form-data with proper boundary
      const res = await authenticatedRequest<Record<string, unknown>>(
        session.token,
        {
          method: "POST",
          url: `${session.target}/fileupload/${encodeURIComponent(folder)}`,
          headers: {
            filter: `PARTICIPANT:${participant}`,
            roles: role,
          },
          body: form,
          timeoutMs: config.writeTimeoutMs,
        },
      );

      return {
        message: `File "${fileName}" berhasil diunggah ke folder "${folder}".`,
        result: res,
      };
    },
    extraMeta,
  );
}
