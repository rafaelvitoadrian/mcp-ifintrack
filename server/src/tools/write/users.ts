/**
 * User administration write tools: create_user, update_user.
 * Follows docs/USER_PERMISSION_PROFILE_FLOW.md, src/utils/payload.js, and src/utils/users.js:
 * - create_user can create an inline individual profile (identPermissionProfile: 0, name: AKN/<USERNAME>, userRoles)
 *   and/or reference stored shared profiles.
 * - Password for create_user is resolved from host secret environment variable (`passwordSecretEnv`)
 *   so plaintext passwords are not exposed in model prompts or preview logs.
 * - update_user reads the latest user record first (freshUser), preserves existing individual profile ID
 *   with userAccount: { ident: userId } (NEVER blindly forces profile ID to 0 on every edit!),
 *   and re-reads + verifies the saved roles with `userProfilesMatch` after PUT.
 */
import {
  listUsers,
  freshUser,
  createUser,
  updateUser,
} from "../../api/users.js";
import { fetchUserRoles } from "../../api/permissions.js";
import {
  userProfilesMatch,
  buildUpdatedUserProfiles,
  isIndividualProfile,
} from "../../utils/payload.js";
import { roleId, profileId } from "../../utils/encoding.js";
import {
  validatePositiveInt,
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type {
  UserRecord,
  PermissionProfile,
  UserRole,
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

function resolveHostSecretPassword(secretEnvName: unknown): string {
  const envKey = validateString(secretEnvName, "passwordSecretEnv", 120);
  if (!/^[A-Z0-9_]+$/i.test(envKey)) {
    throw new Error(
      "passwordSecretEnv harus berupa nama environment variable yang valid (huruf, angka, garis bawah).",
    );
  }
  const secretValue = process.env[envKey];
  if (!secretValue || secretValue.trim().length === 0) {
    throw new Error(
      `Secret password tidak ditemukan pada environment host "${envKey}". Sediakan password melalui mekanisme rahasia host, bukan lewat percakapan model.`,
    );
  }
  return secretValue;
}

async function resolveRolesFromCatalog(
  session: SessionData,
  roleIds: number[],
): Promise<UserRole[]> {
  if (!roleIds.length) return [];
  const allRoles = await fetchUserRoles(session.token, session.target);
  return roleIds.map((rid) => {
    const found = allRoles.find((r) => roleId(r) === rid);
    if (!found) {
      throw new Error(
        `Role ID #${rid} tidak ditemukan pada katalog fetchUserRoles backend.`,
      );
    }
    return {
      identUserRole: roleId(found),
      shortname: found.shortname,
      name: found.name,
      activationStatus: found.activationStatus || "Active",
    };
  });
}

export async function prepareCreateUser(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    email: string;
    username: string;
    name: string;
    passwordSecretEnv: string;
    activationType: number;
    expectedProfiles: PermissionProfile[];
  }>
> {
  const name = validateString(domainArgs.name, "name", 120);
  const username = validateString(domainArgs.username, "username", 120);
  const email = validateString(domainArgs.email, "email", 200);
  const passwordSecretEnv = validateString(
    domainArgs.passwordSecretEnv,
    "passwordSecretEnv",
    120,
  );
  // Validate that the host secret exists without storing its value in the preview
  void resolveHostSecretPassword(passwordSecretEnv);

  const activationType =
    domainArgs.activationType !== undefined
      ? validatePositiveInt(domainArgs.activationType, "activationType")
      : 1;

  const roleIds = Array.isArray(domainArgs.roleIds)
    ? domainArgs.roleIds.map((id, i) =>
        validatePositiveInt(id, `roleIds[${i}]`),
      )
    : [];
  const sharedProfileIds = Array.isArray(domainArgs.sharedProfileIds)
    ? domainArgs.sharedProfileIds.map((id, i) =>
        validatePositiveInt(id, `sharedProfileIds[${i}]`),
      )
    : [];

  if (roleIds.length === 0 && sharedProfileIds.length === 0) {
    throw new Error(
      "Pilih sedikitnya satu roleId (untuk profile individual inline) atau satu sharedProfileId.",
    );
  }

  // Check if user already exists
  const existingUsers = await listUsers(session.token, session.target);
  const duplicate = existingUsers.find(
    (u) =>
      u.email?.trim().toLowerCase() === email.toLowerCase() ||
      u.username?.trim().toLowerCase() === username.toLowerCase(),
  );
  if (duplicate) {
    throw new Error(
      `Username "${username}" atau email "${email}" sudah terdaftar (user #${String(duplicate.id)}).`,
    );
  }

  const resolvedRoles = await resolveRolesFromCatalog(session, roleIds);
  const expectedProfiles: PermissionProfile[] = [
    ...sharedProfileIds.map((pid) => ({ identPermissionProfile: pid })),
    ...(resolvedRoles.length > 0
      ? [
          {
            identPermissionProfile: 0,
            individual: true,
            name: `AKN/${username.toUpperCase()}`,
            userRoles: resolvedRoles,
          },
        ]
      : []),
  ];

  return {
    target: `user:new:${username}`,
    title: "Buat user baru",
    scope: `create_user:${username}`,
    scopeLabel: `Buat user ${name} (${username})`,
    changes: {
      name,
      username,
      email,
      passwordSource: `Host env: ${passwordSecretEnv}`,
      activationType,
      individualProfile:
        resolvedRoles.length > 0
          ? {
              identPermissionProfile: 0,
              name: `AKN/${username.toUpperCase()}`,
              roles: resolvedRoles.map((r) => r.shortname || r.name),
            }
          : null,
      sharedProfileIds,
    },
    snapshot: { exists: false, username, email },
    entries: [
      ["Nama", name],
      ["Username", username],
      ["Email", email],
      ["Sumber Password", `Host Secret (${passwordSecretEnv})`],
      [
        "Roles Individual",
        resolvedRoles.map((r) => r.shortname || r.name).join(", ") || "-",
      ],
      ["Shared Profile IDs", sharedProfileIds.join(", ") || "-"],
    ],
    previous: [],
    context: {
      email,
      username,
      name,
      passwordSecretEnv,
      activationType,
      expectedProfiles,
    },
  };
}

export async function handleCreateUser(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "name",
      "username",
      "email",
      "passwordSecretEnv",
      "roleIds",
      "sharedProfileIds",
      "activationType",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "create_user",
  );

  return runMutationTool(
    sessionId,
    "create_user",
    args,
    prepareCreateUser,
    async (session, prepared) => {
      const {
        name,
        username,
        email,
        passwordSecretEnv,
        activationType,
        expectedProfiles,
      } = prepared.context;
      const password = resolveHostSecretPassword(passwordSecretEnv);

      await createUser(
        session.token,
        {
          name,
          username,
          email,
          password,
          activationType,
          permissionProfiles: expectedProfiles,
        },
        session.target,
      );

      // Re-read user list and verify role assignment per USER_PERMISSION_PROFILE_FLOW.md
      const usersAfter = await listUsers(session.token, session.target);
      const saved = usersAfter.find(
        (u) =>
          u.email?.trim().toLowerCase() === email.toLowerCase() ||
          u.username?.trim().toLowerCase() === username.toLowerCase(),
      );

      if (!saved || !userProfilesMatch(saved, expectedProfiles)) {
        throw new Error(
          "User dibuat tetapi verifikasi pembacaan ulang menunjukkan assignment permission profile/role belum sesuai. Periksa data user sebelum mencoba ulang.",
        );
      }

      return {
        message: "Buat user dan verifikasi assignment profile berhasil.",
        recordId: saved.id ?? null,
        verifiedRoles: true,
        user: saved,
      };
    },
    extraMeta,
  );
}

export async function prepareUpdateUser(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    userId: number;
    latest: UserRecord;
    values: {
      name: string;
      username: string;
      email: string;
      activationType: number;
      permissionProfiles: PermissionProfile[];
    };
  }>
> {
  const userId = validatePositiveInt(domainArgs.userId, "userId");
  const hasChange = [
    "name",
    "username",
    "email",
    "activationType",
    "roleIds",
    "sharedProfileIds",
    "profileName",
  ].some((k) => domainArgs[k] !== undefined);

  if (!hasChange) {
    throw new Error(
      "Sebutkan perubahan user yang diinginkan (name, username, email, activationType, roleIds, atau sharedProfileIds).",
    );
  }

  const latest = await freshUser(session.token, userId, session.target);
  if (latest.permissionProfilesLoaded === false) {
    throw new Error(
      "Backend belum mengirim permission profile terbaru untuk user ini. Penyimpanan dibatalkan agar assignment tidak tertimpa.",
    );
  }

  const name =
    domainArgs.name !== undefined
      ? validateString(domainArgs.name, "name", 120)
      : String(latest.name || "").trim();
  const username =
    domainArgs.username !== undefined
      ? validateString(domainArgs.username, "username", 120)
      : String(latest.username || "").trim();
  const email =
    domainArgs.email !== undefined
      ? validateString(domainArgs.email, "email", 200)
      : String(latest.email || "").trim();
  const activationType =
    domainArgs.activationType !== undefined
      ? validatePositiveInt(domainArgs.activationType, "activationType")
      : Number(latest.identActivationType || 1);

  const roleIds = Array.isArray(domainArgs.roleIds)
    ? domainArgs.roleIds.map((id, i) =>
        validatePositiveInt(id, `roleIds[${i}]`),
      )
    : undefined;
  const sharedProfileIds = Array.isArray(domainArgs.sharedProfileIds)
    ? domainArgs.sharedProfileIds.map((id, i) =>
        validatePositiveInt(id, `sharedProfileIds[${i}]`),
      )
    : undefined;
  const profileName =
    domainArgs.profileName !== undefined
      ? validateString(domainArgs.profileName, "profileName", 120)
      : undefined;

  const resolvedRoles = roleIds
    ? await resolveRolesFromCatalog(session, roleIds)
    : undefined;

  const updatedProfiles =
    resolvedRoles !== undefined || sharedProfileIds !== undefined
      ? buildUpdatedUserProfiles(latest, {
          roles: resolvedRoles,
          sharedProfileIds,
          profileName,
        })
      : (latest.permissionProfiles ?? []);

  if (updatedProfiles.length === 0) {
    throw new Error("User harus memiliki sedikitnya satu permission profile yang valid.");
  }

  const existingInd = (latest.permissionProfiles || []).find(
    isIndividualProfile,
  );
  const targetInd = updatedProfiles.find(isIndividualProfile);

  const snapshot = {
    id: latest.id,
    identRevision: latest.identRevision ?? null,
    name: latest.name ?? null,
    username: latest.username ?? null,
    email: latest.email ?? null,
    identActivationType: latest.identActivationType ?? 1,
    profiles: (latest.permissionProfiles || []).map((p) => ({
      id: profileId(p),
      name: p.name,
      individual: isIndividualProfile(p),
      roleIds: (p.userRoles || []).map(roleId),
    })),
  };

  const values = {
    name,
    username,
    email,
    activationType,
    permissionProfiles: updatedProfiles,
  };

  return {
    target: `user:${userId}`,
    title: "Edit user",
    scope: `update_user:${userId}`,
    scopeLabel: `Edit user #${userId} (${latest.username || latest.email})`,
    changes: {
      userId,
      name,
      username,
      email,
      activationType,
      existingIndividualProfileId: existingInd ? profileId(existingInd) : null,
      targetIndividualProfileId: targetInd
        ? (targetInd.identPermissionProfile ?? profileId(targetInd))
        : null,
      permissionProfiles: updatedProfiles,
    },
    snapshot,
    entries: [
      ["User ID", String(userId)],
      ["Nama", name],
      ["Username", username],
      ["Email", email],
      ["Activation Type", String(activationType)],
      [
        "Profile Individual ID",
        targetInd
          ? String(targetInd.identPermissionProfile ?? profileId(targetInd))
          : "(tidak ada)",
      ],
    ],
    previous: [
      ["Nama", String(latest.name || "")],
      ["Username", String(latest.username || "")],
      ["Email", String(latest.email || "")],
      ["Revisi", String(latest.identRevision ?? "")],
    ],
    context: { userId, latest, values },
  };
}

export async function handleUpdateUser(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "userId",
      "name",
      "username",
      "email",
      "activationType",
      "roleIds",
      "sharedProfileIds",
      "profileName",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "update_user",
  );

  return runMutationTool(
    sessionId,
    "update_user",
    args,
    prepareUpdateUser,
    async (session, prepared) => {
      const { userId, latest, values } = prepared.context;
      await updateUser(session.token, latest, values, session.target);

      // Re-read fresh user and verify final roles & details (backend may clone individual profile to a new ID)
      const saved = await freshUser(session.token, userId, session.target);
      const detailsMatch =
        saved.id === userId &&
        String(saved.name || "").trim() === values.name &&
        String(saved.username || "").trim() === values.username &&
        String(saved.email || "").trim() === values.email &&
        Number(saved.identActivationType || 1) === values.activationType;

      const profilesVerified = userProfilesMatch(
        saved,
        values.permissionProfiles,
      );

      if (!detailsMatch || !profilesVerified) {
        throw new Error(
          "Perubahan user belum terkonfirmasi pada pembacaan ulang (detail atau role profile belum sesuai). Penyimpanan tidak diulang otomatis; periksa data user terbaru.",
        );
      }

      return {
        message: "Edit user dan verifikasi role profile berhasil.",
        recordId: saved.id,
        verifiedRoles: true,
        user: saved,
      };
    },
    extraMeta,
  );
}
