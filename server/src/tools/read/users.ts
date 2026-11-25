import { listUsers, getUser } from "../../api/users.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import {
  validatePositiveInt,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import type { ToolResult } from "../../types.js";

export async function handleListUsers(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "list_users");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_users");

  const users = await listUsers(session.token, session.target);
  return formatToolResult(
    {
      count: users.length,
      users,
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleGetUser(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(["userId"]), "get_user");
  const userId = validatePositiveInt(args.userId, "userId");
  const session = requireSession(sessionId);
  assertToolAccess(session, "get_user");

  const user = await getUser(session.token, userId, session.target);
  return formatToolResult(
    {
      user,
    },
    { isUntrustedBackendData: true },
  );
}
