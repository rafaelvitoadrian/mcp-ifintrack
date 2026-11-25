import {
  fetchUserRoles,
  searchUserRoles,
  getAllPermissionFunctions,
  getAccessLevels,
  getAuthLevels,
  fetchAuthorizedPermissionProfiles,
} from "../../api/permissions.js";
import { requireSession, setSessionPermissions } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import {
  validateString,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import type { ToolResult } from "../../types.js";

export async function handleListRoles(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "list_roles");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_roles");

  const roles = await fetchUserRoles(session.token, session.target);
  return formatToolResult(
    {
      count: roles.length,
      roles,
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleSearchRoles(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(["pattern"]), "search_roles");
  const pattern = validateString(args.pattern, "pattern", 120);
  const session = requireSession(sessionId);
  assertToolAccess(session, "search_roles");

  const roles = await searchUserRoles(session.token, pattern, session.target);
  return formatToolResult(
    {
      pattern,
      count: roles.length,
      roles,
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleListPermissionFunctions(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "list_permission_functions");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_permission_functions");

  const functions = await getAllPermissionFunctions(
    session.token,
    session.target,
  );
  return formatToolResult({
    count: functions.length,
    functions,
  });
}

export async function handleListAccessLevels(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "list_access_levels");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_access_levels");

  const accessLevels = await getAccessLevels(session.token, session.target);
  return formatToolResult({
    count: accessLevels.length,
    accessLevels,
  });
}

export async function handleListAuthLevels(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "list_auth_levels");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_auth_levels");

  const authLevels = await getAuthLevels(session.token, session.target);
  return formatToolResult({
    count: authLevels.length,
    authLevels,
  });
}

export async function handleGetAuthorizedPermissionProfiles(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "get_authorized_permission_profiles");
  const session = requireSession(sessionId);
  assertToolAccess(session, "get_authorized_permission_profiles");

  const profiles = await fetchAuthorizedPermissionProfiles(
    session.token,
    session.target,
  );
  setSessionPermissions(sessionId, profiles);
  return formatToolResult({
    principal: session.principal,
    count: profiles.length,
    profiles,
    effectivePermissionIndex: session.permissionIndex,
  });
}
