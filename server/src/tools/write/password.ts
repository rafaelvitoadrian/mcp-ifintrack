/**
 * Change user password tool: change_user_password.
 * Follows TOOLS.md & CONTRACTS.md:
 * - POST /api/v2/user/change-password with JSON { identUser, newPassword }.
 * - Uses host secret reference (`passwordSecretEnv`), NEVER accepting raw plaintext passwords
 *   in the model conversation or returning passwords in previews/logs.
 */
import { freshUser, changeUserPassword } from "../../api/users.js";
import {
  validatePositiveInt,
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

function resolveSecretFromEnv(envVarName: string): string {
  if (!/^[A-Z0-9_]+$/i.test(envVarName)) {
    throw new Error(
      "passwordSecretEnv harus berupa nama environment variable yang valid.",
    );
  }
  const secret = process.env[envVarName];
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      `Password rahasia tidak ditemukan di environment host "${envVarName}".`,
    );
  }
  return secret;
}

export async function prepareChangeUserPassword(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    userId: number;
    passwordSecretEnv: string;
  }>
> {
  const userId = validatePositiveInt(
    domainArgs.userId ?? domainArgs.identUser,
    "userId",
  );
  const passwordSecretEnv = validateString(
    domainArgs.passwordSecretEnv,
    "passwordSecretEnv",
    120,
  );

  // Verify secret exists in host environment without exposing value
  void resolveSecretFromEnv(passwordSecretEnv);

  const user = await freshUser(session.token, userId, session.target);

  return {
    target: `user:${userId}:password`,
    title: "Ubah password user",
    scope: `change_user_password:${userId}`,
    scopeLabel: `Ubah password untuk user #${userId} (${user.username || user.email})`,
    changes: {
      identUser: userId,
      username: user.username,
      email: user.email,
      passwordSource: `Host env: ${passwordSecretEnv}`,
    },
    snapshot: {
      id: user.id,
      identRevision: user.identRevision ?? null,
      email: user.email ?? null,
    },
    entries: [
      ["User ID", String(userId)],
      ["Username", String(user.username || "")],
      ["Email", String(user.email || "")],
      ["Sumber Password Baru", `Host Secret (${passwordSecretEnv})`],
    ],
    previous: [],
    context: { userId, passwordSecretEnv },
  };
}

export async function handleChangeUserPassword(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  if ("newPassword" in args || "password" in args) {
    throw new Error(
      "Jangan mengirim password plaintext melalui argumen percakapan model! Gunakan passwordSecretEnv yang menunjuk ke secret pada host.",
    );
  }
  rejectUnknownFields(
    args,
    new Set([
      "userId",
      "identUser",
      "passwordSecretEnv",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "change_user_password",
  );

  return runMutationTool(
    sessionId,
    "change_user_password",
    args,
    prepareChangeUserPassword,
    async (session, prepared) => {
      const newPassword = resolveSecretFromEnv(
        prepared.context.passwordSecretEnv,
      );
      await changeUserPassword(
        session.token,
        prepared.context.userId,
        newPassword,
        session.target,
      );
      return {
        message: `Password untuk user #${prepared.context.userId} berhasil diubah.`,
        recordId: prepared.context.userId,
      };
    },
    extraMeta,
  );
}
