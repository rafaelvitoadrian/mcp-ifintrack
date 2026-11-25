import { config } from "../config.js";
import { authenticatedRequest } from "./client.js";
import { rowsOf } from "../utils/dto.js";
import {
  userRoleForm,
  permissionProfileForm,
  permissionProfileUpdateForm,
  accessLevelId,
} from "../utils/encoding.js";
import type {
  UserRole,
  PermissionProfile,
  RoleFunction,
} from "../types.js";

export async function fetchUserRoles(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRole[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/fetchUserRoles`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res) as UserRole[];
}

export async function searchUserRoles(
  token: string,
  pattern: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRole[]> {
  const trimmed = pattern.trim();
  // Client wraps plain text with *...* unless wildcard is already present
  const wrappedPattern =
    trimmed.includes("*") || trimmed.includes("?") ? trimmed : `*${trimmed}*`;
  const encoded = encodeURIComponent(wrappedPattern);
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/getUserRoles/${encoded}`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res) as UserRole[];
}

export async function getAccessLevels(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<Record<string, unknown>[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/getAccessLevels`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res);
}

export async function getAuthLevels(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<Record<string, unknown>[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/getAuthLevels`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res);
}

export async function getAllPermissionFunctions(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<Record<string, unknown>[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/getAllPermissionFunctions`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res);
}

export async function fetchAuthorizedPermissionProfiles(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<PermissionProfile[]> {
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v2/user/fetchAuthorizedPermissionProfiles`,
    timeoutMs: config.requestTimeoutMs,
  });
  return rowsOf(res) as PermissionProfile[];
}

/**
 * Resolve access levels and permission functions from the backend catalog.
 * Ensures accessLevel IDs are resolved from getAccessLevels (not hardcoded guesses)
 * and function metadata (functionName, authLevel) is preserved from getAllPermissionFunctions.
 */
export async function resolveRoleFunctionsFromCatalog(
  token: string,
  requestedFunctions: Array<{
    identFunction: number;
    functionName?: string;
    accessLevel: number | string; // ID or name ("View", "Initiate", "Approve")
  }>,
  targetUrl: string = config.apiBaseUrl,
): Promise<RoleFunction[]> {
  const [accessLevels, catalogFunctions] = await Promise.all([
    getAccessLevels(token, targetUrl),
    getAllPermissionFunctions(token, targetUrl),
  ]);

  if (!accessLevels.length) {
    throw new Error("Katalog getAccessLevels dari backend kosong.");
  }

  return requestedFunctions.map((reqFn) => {
    // 1. Resolve access level from getAccessLevels
    const matchedAccess = accessLevels.find((lvl) => {
      const id = accessLevelId(lvl);
      const name = String(
        lvl.accessLevelName ?? lvl.name ?? "",
      )
        .trim()
        .toLowerCase();
      if (typeof reqFn.accessLevel === "number") {
        return id === reqFn.accessLevel;
      }
      const reqStr = String(reqFn.accessLevel).trim().toLowerCase();
      if (/^\d+$/.test(reqStr)) {
        return id === Number(reqStr);
      }
      return name === reqStr;
    });

    if (!matchedAccess) {
      throw new Error(
        `Access level "${String(reqFn.accessLevel)}" tidak ditemukan pada katalog getAccessLevels backend.`,
      );
    }
    const resolvedAccessId = accessLevelId(matchedAccess)!;

    // 2. Resolve function metadata (including authLevel) from getAllPermissionFunctions
    const catalogEntry = catalogFunctions.find((entry) => {
      const fnObj = (entry.function as Record<string, unknown>) || entry;
      const fnId = Number(fnObj.identFunction ?? fnObj.ident ?? fnObj.id);
      return fnId === Number(reqFn.identFunction);
    });

    const fnSource = catalogEntry
      ? ((catalogEntry.function as Record<string, unknown>) || catalogEntry)
      : null;

    const functionName = String(
      fnSource?.functionName ?? reqFn.functionName ?? "",
    ).trim();
    if (!functionName) {
      throw new Error(
        `Function #${reqFn.identFunction} tidak ditemukan di katalog getAllPermissionFunctions dan tidak memiliki functionName.`,
      );
    }

    const authLevelObj = fnSource?.authLevel as
      | Record<string, unknown>
      | undefined;
    const identAuthLevel = Number(
      authLevelObj?.identAuthLevel ?? authLevelObj?.ident ?? 0,
    );
    const authLevelName = authLevelObj?.authLevelName
      ? String(authLevelObj.authLevelName)
      : undefined;

    return {
      function: {
        identFunction: Number(reqFn.identFunction),
        functionName,
        ...(identAuthLevel > 0 || authLevelName
          ? {
              authLevel: {
                ...(identAuthLevel > 0 ? { identAuthLevel } : {}),
                ...(authLevelName ? { authLevelName } : {}),
              },
            }
          : {}),
      },
      accessLevel: {
        identAccessLevel: resolvedAccessId,
        ...(matchedAccess.accessLevelName
          ? { accessLevelName: String(matchedAccess.accessLevelName) }
          : {}),
      },
    };
  });
}

export async function createUserRole(
  token: string,
  values: Parameters<typeof userRoleForm>[0],
  entries: RoleFunction[],
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRole> {
  const form = userRoleForm(values, entries);
  return authenticatedRequest<UserRole>(token, {
    method: "POST",
    url: `${targetUrl}/api/v2/user/create-user-role`,
    body: form,
    timeoutMs: config.writeTimeoutMs,
  });
}

export async function updateUserRole(
  token: string,
  values: Parameters<typeof userRoleForm>[0],
  entries: RoleFunction[],
  targetUrl: string = config.apiBaseUrl,
): Promise<UserRole> {
  const form = userRoleForm(values, entries);
  return authenticatedRequest<UserRole>(token, {
    method: "PUT",
    url: `${targetUrl}/api/v2/user/update-user-role`,
    body: form,
    timeoutMs: config.writeTimeoutMs,
  });
}

export async function createPermissionProfile(
  token: string,
  nameOrUsername: string,
  roles: UserRole[],
  isRawProfileName: boolean = true,
  targetUrl: string = config.apiBaseUrl,
): Promise<PermissionProfile> {
  const form = permissionProfileForm(nameOrUsername, roles, isRawProfileName);
  return authenticatedRequest<PermissionProfile>(token, {
    method: "POST",
    url: `${targetUrl}/api/v2/user/create-permission-profile`,
    body: form,
    timeoutMs: config.writeTimeoutMs,
  });
}

export async function updatePermissionProfile(
  token: string,
  profile: PermissionProfile,
  targetUrl: string = config.apiBaseUrl,
): Promise<PermissionProfile> {
  const form = permissionProfileUpdateForm(profile);
  return authenticatedRequest<PermissionProfile>(token, {
    method: "PUT",
    url: `${targetUrl}/api/v2/user/update-permission-profile`,
    body: form,
    timeoutMs: config.writeTimeoutMs,
  });
}
