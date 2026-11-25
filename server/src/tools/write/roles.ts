/**
 * Role management write tools: create_role, update_role.
 * Follows CONTRACTS.md and src/utils/users.js:
 * - Uses application/x-www-form-urlencoded with nested keys:
 *   userRoleFunctions[i].function.identFunction, .functionName, .accessLevel.identAccessLevel
 * - Resolves accessLevel IDs from `getAccessLevels` (no hardcoded ID assumptions)
 * - Preserves function authLevel metadata from `getAllPermissionFunctions`.
 */
import {
  fetchUserRoles,
  resolveRoleFunctionsFromCatalog,
  createUserRole,
  updateUserRole,
} from "../../api/permissions.js";
import { roleId } from "../../utils/encoding.js";
import {
  validatePositiveInt,
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type {
  RoleFunction,
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

function parseRequestedFunctions(
  rawFunctions: unknown,
): Array<{
  identFunction: number;
  functionName?: string;
  accessLevel: number | string;
}> {
  if (!Array.isArray(rawFunctions) || rawFunctions.length === 0) {
    throw new Error(
      "functions wajib berupa array berisi sedikitnya satu function dan accessLevel.",
    );
  }
  return rawFunctions.map((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`functions[${idx}] harus berupa objek.`);
    }
    const obj = item as Record<string, unknown>;
    const identFunction = validatePositiveInt(
      obj.identFunction,
      `functions[${idx}].identFunction`,
    );
    const accessLevel =
      obj.accessLevel ?? obj.identAccessLevel ?? obj.accessLevelName;
    if (
      accessLevel === undefined ||
      accessLevel === null ||
      String(accessLevel).trim() === ""
    ) {
      throw new Error(
        `functions[${idx}].accessLevel (atau identAccessLevel) wajib diisi.`,
      );
    }
    const functionName =
      obj.functionName !== undefined
        ? validateString(
            obj.functionName,
            `functions[${idx}].functionName`,
            200,
          )
        : undefined;
    return {
      identFunction,
      functionName,
      accessLevel:
        typeof accessLevel === "number" ? accessLevel : String(accessLevel),
    };
  });
}

export async function prepareCreateRole(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    values: {
      shortname: string;
      name: string;
      description: string;
      activationStatus: string;
      applicableForPOA: boolean;
      internal: boolean;
    };
    entries: RoleFunction[];
  }>
> {
  const shortname = validateString(domainArgs.shortname, "shortname", 120);
  const name = validateString(domainArgs.name, "name", 120);
  const description =
    domainArgs.description !== undefined &&
    String(domainArgs.description).trim() !== ""
      ? validateString(domainArgs.description, "description", 500)
      : "";
  const activationStatus =
    domainArgs.activationStatus !== undefined
      ? validateString(domainArgs.activationStatus, "activationStatus", 40)
      : "Active";
  const applicableForPOA = Boolean(domainArgs.applicableForPOA ?? false);
  const internal = Boolean(domainArgs.internal ?? false);

  const reqFns = parseRequestedFunctions(domainArgs.functions);
  const resolvedEntries = await resolveRoleFunctionsFromCatalog(
    session.token,
    reqFns,
    session.target,
  );

  const existingRoles = await fetchUserRoles(session.token, session.target);
  const duplicate = existingRoles.find(
    (r) =>
      String(r.shortname || "")
        .trim()
        .toLowerCase() === shortname.toLowerCase(),
  );
  if (duplicate) {
    throw new Error(
      `Role dengan shortname "${shortname}" sudah ada (role #${String(roleId(duplicate))}).`,
    );
  }

  const values = {
    shortname,
    name,
    description,
    activationStatus,
    applicableForPOA,
    internal,
  };

  return {
    target: `role:new:${shortname}`,
    title: "Buat user role",
    scope: `create_role:${shortname}`,
    scopeLabel: `Buat role ${shortname} (${name})`,
    changes: {
      ...values,
      functions: resolvedEntries.map((e) => ({
        identFunction: e.function?.identFunction,
        functionName: e.function?.functionName,
        identAccessLevel: e.accessLevel?.identAccessLevel,
        accessLevelName: e.accessLevel?.accessLevelName,
      })),
    },
    snapshot: { exists: false, shortname },
    entries: [
      ["Shortname", shortname],
      ["Nama Role", name],
      ["Deskripsi", description || "(kosong)"],
      ["Status", activationStatus],
      [
        "Functions",
        resolvedEntries
          .map(
            (e) =>
              `${e.function?.functionName}:${e.accessLevel?.accessLevelName || e.accessLevel?.identAccessLevel}`,
          )
          .join(", "),
      ],
    ],
    previous: [],
    context: { values, entries: resolvedEntries },
  };
}

export async function handleCreateRole(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "shortname",
      "name",
      "description",
      "activationStatus",
      "applicableForPOA",
      "internal",
      "functions",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "create_role",
  );

  return runMutationTool(
    sessionId,
    "create_role",
    args,
    prepareCreateRole,
    async (session, prepared) => {
      const created = await createUserRole(
        session.token,
        prepared.context.values,
        prepared.context.entries,
        session.target,
      );
      return {
        message: "Buat user role berhasil.",
        recordId: roleId(created) ?? null,
        role: created,
      };
    },
    extraMeta,
  );
}

export async function prepareUpdateRole(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    existing: UserRole;
    values: {
      identUserRole: number;
      shortname: string;
      name: string;
      description: string;
      activationStatus: string;
      applicableForPOA: boolean;
      internal: boolean;
    };
    entries: RoleFunction[];
  }>
> {
  const identUserRole = validatePositiveInt(
    domainArgs.roleId ?? domainArgs.identUserRole,
    "roleId",
  );

  const allRoles = await fetchUserRoles(session.token, session.target);
  const existing = allRoles.find((r) => roleId(r) === identUserRole);
  if (!existing) {
    throw new Error(`Role #${identUserRole} tidak ditemukan di backend.`);
  }

  const shortname =
    domainArgs.shortname !== undefined
      ? validateString(domainArgs.shortname, "shortname", 120)
      : String(existing.shortname || "").trim();
  const name =
    domainArgs.name !== undefined
      ? validateString(domainArgs.name, "name", 120)
      : String(existing.name || "").trim();
  const description =
    domainArgs.description !== undefined
      ? String(domainArgs.description).trim()
      : String(existing.description || "").trim();
  const activationStatus =
    domainArgs.activationStatus !== undefined
      ? validateString(domainArgs.activationStatus, "activationStatus", 40)
      : String(existing.activationStatus || "Active");
  const applicableForPOA =
    domainArgs.applicableForPOA !== undefined
      ? Boolean(domainArgs.applicableForPOA)
      : Boolean(existing.applicableForPOA);
  const internal =
    domainArgs.internal !== undefined
      ? Boolean(domainArgs.internal)
      : Boolean(existing.internal);

  const resolvedEntries =
    domainArgs.functions !== undefined
      ? await resolveRoleFunctionsFromCatalog(
          session.token,
          parseRequestedFunctions(domainArgs.functions),
          session.target,
        )
      : (existing.userRoleFunctions ?? []);

  const snapshot = {
    identUserRole,
    shortname: existing.shortname,
    name: existing.name,
    description: existing.description ?? "",
    activationStatus: existing.activationStatus ?? "Active",
    functions: (existing.userRoleFunctions || []).map((f) => ({
      fnId: f.function?.identFunction,
      accessId: f.accessLevel?.identAccessLevel,
    })),
  };

  const values = {
    identUserRole,
    shortname,
    name,
    description,
    activationStatus,
    applicableForPOA,
    internal,
  };

  return {
    target: `role:${identUserRole}`,
    title: "Edit user role",
    scope: `update_role:${identUserRole}`,
    scopeLabel: `Edit role #${identUserRole} (${shortname})`,
    changes: {
      ...values,
      functions: resolvedEntries.map((e) => ({
        identFunction: e.function?.identFunction,
        functionName: e.function?.functionName,
        identAccessLevel: e.accessLevel?.identAccessLevel,
      })),
    },
    snapshot,
    entries: [
      ["Role ID", String(identUserRole)],
      ["Shortname", shortname],
      ["Nama Role", name],
      ["Deskripsi", description || "(kosong)"],
      ["Status", activationStatus],
      [
        "Functions",
        resolvedEntries
          .map(
            (e) =>
              `${e.function?.functionName}:${e.accessLevel?.accessLevelName || e.accessLevel?.identAccessLevel}`,
          )
          .join(", "),
      ],
    ],
    previous: [
      ["Shortname", String(existing.shortname || "")],
      ["Nama Role", String(existing.name || "")],
      ["Deskripsi", String(existing.description || "")],
    ],
    context: { existing, values, entries: resolvedEntries },
  };
}

export async function handleUpdateRole(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "roleId",
      "identUserRole",
      "shortname",
      "name",
      "description",
      "activationStatus",
      "applicableForPOA",
      "internal",
      "functions",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "update_role",
  );

  return runMutationTool(
    sessionId,
    "update_role",
    args,
    prepareUpdateRole,
    async (session, prepared) => {
      const updated = await updateUserRole(
        session.token,
        prepared.context.values,
        prepared.context.entries,
        session.target,
      );
      return {
        message: "Edit user role berhasil.",
        recordId: roleId(updated) ?? prepared.context.values.identUserRole,
        role: updated,
      };
    },
    extraMeta,
  );
}
