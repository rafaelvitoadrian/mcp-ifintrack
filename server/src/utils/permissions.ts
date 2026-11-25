/**
 * Permission index and authorization enforcement.
 * Follows src/utils/permissions.js and src/services/authorization.js in the original repository.
 *
 * Access levels:
 *   View = rank 1 (fallback ID 2)
 *   Initiate = rank 2 (fallback ID 3)
 *   Approve = rank 3 (fallback ID 4)
 */
import { ApiError } from "../types.js";
import type {
  PermissionProfile,
  PermissionMap,
  AccessLevelName,
  SessionData,
} from "../types.js";

export const menuFunctions: Record<string, string> = {
  akun: "AkunKeuangan",
  kategori: "Category",
  transaksi: "Transaction",
  integrasi: "Integration",
  apidocs: "API Documentation",
  ai: "AI Chatbot",
  log: "API Logging",
  audit: "AuditTrail",
  dailyschedule: "DailySchedule",
  fileupload: "FileUpload",
  settlement: "SettlementInstruction",
  pengaturan: "SystemProperties",
  users: "UserAccount",
  permissionprofile: "PermissionProfile",
  userroles: "UserRoleManagement",
};

const ranks: Record<string, number> = {
  view: 1,
  initiate: 2,
  approve: 3,
};

const fallbackIds: Record<number, number> = {
  2: 1, // View
  3: 2, // Initiate
  4: 3, // Approve
};

const key = (value: unknown): string =>
  String(value || "")
    .trim()
    .toLowerCase();

const isActive = (record: unknown): boolean => {
  if (!record || typeof record !== "object") return false;
  const status = (record as Record<string, unknown>).activationStatus;
  return !status || key(status) === "active";
};

/**
 * Build a functionName -> highest rank map from authorized permission profiles.
 */
export function buildPermissionIndex(
  profiles: PermissionProfile[] = [],
): PermissionMap {
  const result: PermissionMap = Object.create(null);
  for (const profile of profiles) {
    if (!isActive(profile)) continue;
    for (const role of profile?.userRoles || []) {
      if (!isActive(role)) continue;
      for (const entry of role.userRoleFunctions || []) {
        if (!entry?.function) continue;
        const fnName = key(entry.function?.functionName);
        const level = entry.accessLevel;
        const levelName = key(level?.accessLevelName ?? level?.name);
        const levelId = Number(level?.identAccessLevel ?? level?.ident);
        const rank =
          ranks[levelName] ||
          (Number.isFinite(levelId) ? fallbackIds[levelId] : 0) ||
          0;
        if (fnName && rank) {
          result[fnName] = Math.max(result[fnName] || 0, rank);
        }
      }
    }
  }
  return result;
}

export function hasPermission(
  index: PermissionMap | undefined,
  functionOrMenu: string,
  level: AccessLevelName = "view",
): boolean {
  if (!index) return false;
  const fnName = menuFunctions[functionOrMenu] || functionOrMenu;
  const required = ranks[key(level)];
  return !!required && (index[key(fnName)] || 0) >= required;
}

/**
 * Enforce required permissions on the current session before calling backend.
 * Throws 403 ApiError if any required function/level is missing.
 */
export function assertSessionPermissions(
  session: SessionData,
  requirements: Array<[string, AccessLevelName]>,
  operationLabel?: string,
): void {
  if (!session || !session.verified) {
    throw new ApiError(401, "Sesi belum terautentikasi. Silakan login terlebih dahulu.", {
      code: "UNAUTHENTICATED",
    });
  }
  if (!session.permissionsLoaded) {
    throw new ApiError(
      403,
      "Permission profile sesi belum berhasil dimuat dari backend; akses ditolak.",
      { code: "PERMISSION_NOT_LOADED" },
    );
  }
  for (const [fnOrMenu, minLevel] of requirements) {
    // Allow "users|permissionprofile" OR-style fallback for permission profile tools
    const alternatives = fnOrMenu.split("|");
    const allowed = alternatives.some((alt) =>
      hasPermission(session.permissionIndex, alt, minLevel),
    );
    if (!allowed) {
      const fnName = alternatives
        .map((alt) => menuFunctions[alt] || alt)
        .join(" / ");
      throw new ApiError(
        403,
        `Izin ditolak${operationLabel ? ` untuk ${operationLabel}` : ""}: membutuhkan function "${fnName}" dengan level minimal "${minLevel}".`,
        { code: "PERMISSION_DENIED" },
      );
    }
  }
}

/**
 * Map every MCP tool to its required permission checks.
 */
export const TOOL_PERMISSIONS: Record<
  string,
  Array<[string, AccessLevelName]>
> = {
  // Read tools - Financial
  list_accounts: [["akun", "view"]],
  get_account: [["akun", "view"]],
  list_categories: [["kategori", "view"]],
  get_category: [["kategori", "view"]],
  list_transactions: [["transaksi", "view"]],
  get_transaction: [["transaksi", "view"]],
  get_spending_summary: [
    ["akun", "view"],
    ["kategori", "view"],
    ["transaksi", "view"],
  ],

  // Read tools - Users & Permissions
  list_users: [["users", "view"]],
  get_user: [["users", "view"]],
  list_roles: [["userroles", "view"]],
  search_roles: [["userroles", "view"]],
  list_permission_functions: [["userroles", "view"]],
  list_access_levels: [["userroles", "view"]],
  list_auth_levels: [["userroles", "view"]],
  get_authorized_permission_profiles: [], // own session permissions

  // Read tools - Audit & Schedule
  search_audit_events: [["audit", "view"]],
  get_audit_entries: [["audit", "view"]],
  list_scheduled_events: [["dailyschedule", "view"]],
  get_scheduled_event: [["dailyschedule", "view"]],

  // Write tools - Financial
  create_account: [["akun", "initiate"]],
  update_account: [["akun", "initiate"]],
  create_category: [["kategori", "initiate"]],
  update_category: [["kategori", "initiate"]],
  create_transaction: [["transaksi", "initiate"]],
  update_transaction: [["transaksi", "initiate"]],

  // Write tools - Administrative
  create_user: [["users", "initiate"]],
  update_user: [["users", "initiate"]],
  change_user_password: [["users", "initiate"]],
  delete_user_revision: [["users", "initiate"]],
  create_role: [["userroles", "initiate"]],
  update_role: [["userroles", "initiate"]],
  create_permission_profile: [["users|permissionprofile", "initiate"]],
  update_permission_profile: [["users|permissionprofile", "initiate"]],

  // Write tools - Special / Operational
  upload_file: [["fileupload", "initiate"]],
  replay_settlement: [["integrasi", "initiate"]],
  trigger_scheduled_event: [["dailyschedule", "initiate"]],
  repeat_scheduled_event: [["dailyschedule", "initiate"]],
  force_scheduled_event: [["dailyschedule", "approve"]],
};

export function assertToolAccess(session: SessionData, toolName: string): void {
  const reqs = TOOL_PERMISSIONS[toolName];
  if (!reqs) {
    throw new ApiError(403, `Tool "${toolName}" tidak dikenal dalam matriks izin.`, {
      code: "UNKNOWN_TOOL_PERMISSION",
    });
  }
  assertSessionPermissions(session, reqs, toolName);
}
