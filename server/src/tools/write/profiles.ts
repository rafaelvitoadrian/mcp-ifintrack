/**
 * Permission profile write tools: create_permission_profile, update_permission_profile.
 * Uses application/x-www-form-urlencoded with indexed dot-notation keys:
 * name, identPermissionProfile (for update), userAccount.ident (if individual),
 * userRoles[i].identUserRole, .shortname, .name, .activationStatus.
 */
import {
  fetchUserRoles,
  fetchAuthorizedPermissionProfiles,
  createPermissionProfile,
  updatePermissionProfile,
} from "../../api/permissions.js";
import { roleId, profileId } from "../../utils/encoding.js";
import {
  validatePositiveInt,
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type {
  UserRole,
  PermissionProfile,
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

async function resolveProfileRoles(
  session: SessionData,
  rawRoleIds: unknown,
): Promise<UserRole[]> {
  if (!Array.isArray(rawRoleIds) || rawRoleIds.length === 0) {
    throw new Error("roleIds wajib berupa array berisi sedikitnya satu ID role.");
  }
  const ids = rawRoleIds.map((r, i) =>
    validatePositiveInt(r, `roleIds[${i}]`),
  );
  const catalog = await fetchUserRoles(session.token, session.target);
  return ids.map((id) => {
    const found = catalog.find((r) => roleId(r) === id);
    if (!found) {
      throw new Error(`Role #${id} tidak ditemukan pada katalog fetchUserRoles.`);
    }
    return {
      identUserRole: roleId(found),
      shortname: found.shortname,
      name: found.name,
      activationStatus: found.activationStatus || "Active",
    };
  });
}

export async function prepareCreatePermissionProfile(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    name: string;
    roles: UserRole[];
  }>
> {
  const rawName = validateString(domainArgs.name, "name", 120);
  const roles = await resolveProfileRoles(session, domainArgs.roleIds);

  return {
    target: `profile:new:${rawName}`,
    title: "Buat permission profile",
    scope: `create_permission_profile:${rawName}`,
    scopeLabel: `Buat permission profile ${rawName}`,
    changes: {
      name: rawName,
      roles: roles.map((r) => ({
        identUserRole: r.identUserRole,
        shortname: r.shortname,
        name: r.name,
      })),
    },
    snapshot: { exists: false, name: rawName },
    entries: [
      ["Nama Profile", rawName],
      ["Roles", roles.map((r) => r.shortname || r.name).join(", ")],
    ],
    previous: [],
    context: { name: rawName, roles },
  };
}

export async function handleCreatePermissionProfile(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["name", "roleIds", ...COMMON_APPROVAL_KEYS]),
    "create_permission_profile",
  );

  return runMutationTool(
    sessionId,
    "create_permission_profile",
    args,
    prepareCreatePermissionProfile,
    async (session, prepared) => {
      const created = await createPermissionProfile(
        session.token,
        prepared.context.name,
        prepared.context.roles,
        true,
        session.target,
      );
      return {
        message: "Buat permission profile berhasil.",
        recordId: profileId(created) ?? null,
        profile: created,
      };
    },
    extraMeta,
  );
}

export async function prepareUpdatePermissionProfile(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    profile: PermissionProfile;
  }>
> {
  const identPermissionProfile = validatePositiveInt(
    domainArgs.profileId ?? domainArgs.identPermissionProfile,
    "profileId",
  );

  const profiles = await fetchAuthorizedPermissionProfiles(
    session.token,
    session.target,
  );
  const existing = profiles.find(
    (p) => profileId(p) === identPermissionProfile,
  );

  const name =
    domainArgs.name !== undefined
      ? validateString(domainArgs.name, "name", 120)
      : existing?.name
        ? String(existing.name).trim()
        : "";
  if (!name) {
    throw new Error("Nama permission profile wajib diisi.");
  }

  const roles =
    domainArgs.roleIds !== undefined
      ? await resolveProfileRoles(session, domainArgs.roleIds)
      : (existing?.userRoles ?? []);
  if (!roles.length) {
    throw new Error("Pilih sedikitnya satu role untuk permission profile.");
  }

  const ownerIdent =
    domainArgs.ownerUserId !== undefined
      ? validatePositiveInt(domainArgs.ownerUserId, "ownerUserId")
      : existing?.userAccount
        ? Number(
            existing.userAccount.ident ??
              existing.userAccount.id ??
              existing.userAccount.lifecycleEntity?.identEntity ??
              0,
          ) || undefined
        : undefined;

  const profilePayload: PermissionProfile = {
    identPermissionProfile,
    name,
    userRoles: roles,
    ...(ownerIdent ? { userAccount: { ident: ownerIdent } } : {}),
  };

  const snapshot = existing
    ? {
        identPermissionProfile,
        name: existing.name,
        roleIds: (existing.userRoles || []).map(roleId),
      }
    : { identPermissionProfile };

  return {
    target: `profile:${identPermissionProfile}`,
    title: "Edit permission profile",
    scope: `update_permission_profile:${identPermissionProfile}`,
    scopeLabel: `Edit permission profile #${identPermissionProfile} (${name})`,
    changes: {
      identPermissionProfile,
      name,
      ownerUserId: ownerIdent ?? null,
      roles: roles.map((r) => ({
        identUserRole: roleId(r),
        shortname: r.shortname,
      })),
    },
    snapshot,
    entries: [
      ["Profile ID", String(identPermissionProfile)],
      ["Nama Profile", name],
      ["Roles", roles.map((r) => r.shortname || r.name).join(", ")],
      ...(ownerIdent
        ? [["Pemilik (User ID)", String(ownerIdent)] as [string, string]]
        : []),
    ],
    previous: existing
      ? [
          ["Nama Profile", String(existing.name || "")],
          [
            "Roles",
            (existing.userRoles || [])
              .map((r) => r.shortname || r.name)
              .join(", "),
          ],
        ]
      : [],
    context: { profile: profilePayload },
  };
}

export async function handleUpdatePermissionProfile(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "profileId",
      "identPermissionProfile",
      "name",
      "roleIds",
      "ownerUserId",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "update_permission_profile",
  );

  return runMutationTool(
    sessionId,
    "update_permission_profile",
    args,
    prepareUpdatePermissionProfile,
    async (session, prepared) => {
      const updated = await updatePermissionProfile(
        session.token,
        prepared.context.profile,
        session.target,
      );
      return {
        message: "Edit permission profile berhasil.",
        recordId:
          profileId(updated) ??
          prepared.context.profile.identPermissionProfile,
        profile: updated,
      };
    },
    extraMeta,
  );
}
