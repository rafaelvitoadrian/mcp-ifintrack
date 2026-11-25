/**
 * Encoding utilities for form-urlencoded, nested form-urlencoded (roles/profiles),
 * and Daily Schedule text/plain columnar TAB-separated responses.
 * Follows src/services/api.js and src/utils/users.js in original repo.
 */
import type { UserRole, PermissionProfile, RoleFunction } from "../types.js";

const positive = (...values: unknown[]): number | undefined =>
  values
    .map(Number)
    .find((value) => Number.isSafeInteger(value) && value > 0);

export const roleId = (role: unknown): number | undefined => {
  if (!role || typeof role !== "object") return undefined;
  const r = role as Record<string, unknown>;
  return positive(r.identUserRole, r.ident, r.id);
};

export const profileId = (profile: unknown): number | undefined => {
  if (!profile || typeof profile !== "object") return undefined;
  const p = profile as Record<string, unknown>;
  return positive(p.identPermissionProfile, p.ident, p.id);
};

export const functionId = (entry: RoleFunction): number | undefined =>
  positive(entry?.function?.identFunction, entry?.function?.ident);

export const accessLevelId = (level: unknown): number | undefined => {
  if (!level || typeof level !== "object") return undefined;
  const l = level as Record<string, unknown>;
  return positive(l.identAccessLevel, l.ident, l.id);
};

/**
 * Build application/x-www-form-urlencoded body from flat key-value pairs.
 */
export function buildFormUrlEncoded(
  params: Record<string, string | number | boolean>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }
  return searchParams.toString();
}

/**
 * Build nested form-urlencoded body from key-value pairs.
 */
export function buildNestedFormUrlEncoded(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    searchParams.set(key, String(value));
  }
  return searchParams.toString();
}

/**
 * Build URLSearchParams for create/update user role.
 * Matches userRoleForm in src/utils/users.js.
 */
export function userRoleForm(
  values: {
    identUserRole?: number;
    id?: number;
    shortname: string;
    name: string;
    description?: string;
    activationStatus?: string;
    applicableForPOA?: boolean;
    internal?: boolean;
  },
  entries: RoleFunction[],
): URLSearchParams {
  if (!values.shortname?.trim() || !values.name?.trim()) {
    throw new Error("Short name dan nama role wajib diisi.");
  }
  const id = roleId(values);
  if (!entries.length && !id) {
    throw new Error("Pilih sedikitnya satu function.");
  }
  const form = new URLSearchParams({
    shortname: values.shortname.trim(),
    name: values.name.trim(),
    description: values.description?.trim() || "",
    activationStatus: values.activationStatus || "Active",
    applicableForPOA: String(!!values.applicableForPOA),
    internal: String(!!values.internal),
  });
  if (id) {
    form.set("identUserRole", String(id));
  }
  entries.forEach((entry, index) => {
    const fn = entry.function;
    const fnId = positive(fn?.identFunction, fn?.ident);
    const access = positive(
      entry.accessLevel?.identAccessLevel,
      entry.accessLevel?.ident,
    );
    if (!fnId || !access || !fn?.functionName) {
      throw new Error("Function atau level akses tidak valid.");
    }
    const prefix = `userRoleFunctions[${index}].`;
    form.set(prefix + "function.identFunction", String(fnId));
    form.set(prefix + "function.functionName", fn.functionName);
    const auth = positive(fn.authLevel?.identAuthLevel, fn.authLevel?.ident);
    if (auth) {
      form.set(prefix + "function.authLevel.identAuthLevel", String(auth));
    }
    if (fn.authLevel?.authLevelName) {
      form.set(
        prefix + "function.authLevel.authLevelName",
        fn.authLevel.authLevelName,
      );
    }
    form.set(prefix + "accessLevel.identAccessLevel", String(access));
  });
  return form;
}

/**
 * Legacy helper compatible with unit tests for building role form key-values.
 */
export function buildRoleFormData(role: {
  identUserRole?: number;
  shortname: string;
  name: string;
  description?: string;
  activationStatus?: string;
  applicableForPOA?: boolean;
  internal?: boolean;
  functions?: Array<{
    identFunction: number;
    functionName: string;
    identAccessLevel: number;
    identAuthLevel?: number;
    authLevelName?: string;
  }>;
}): Record<string, string | number> {
  const entries: RoleFunction[] = (role.functions || []).map((fn) => ({
    function: {
      identFunction: fn.identFunction,
      functionName: fn.functionName,
      ...(fn.identAuthLevel || fn.authLevelName
        ? {
            authLevel: {
              identAuthLevel: fn.identAuthLevel,
              authLevelName: fn.authLevelName,
            },
          }
        : {}),
    },
    accessLevel: {
      identAccessLevel: fn.identAccessLevel,
    },
  }));
  const params = userRoleForm(role, entries);
  const out: Record<string, string | number> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Build URLSearchParams for creating a permission profile.
 * Matches permissionProfileForm in src/utils/users.js.
 */
export function permissionProfileForm(
  nameOrUsername: string,
  roles: UserRole[],
  isRawProfileName: boolean = false,
): URLSearchParams {
  if (
    !nameOrUsername?.trim() ||
    !roles.length ||
    roles.some((role) => !roleId(role))
  ) {
    throw new Error("Isi nama profile/username dan pilih role yang sudah tersimpan.");
  }
  const trimmed = nameOrUsername.trim();
  const profileName =
    isRawProfileName || trimmed.includes("/") ? trimmed : `AKN/${trimmed}`;
  const form = new URLSearchParams({ name: profileName });
  roles.forEach((role, index) => {
    const prefix = `userRoles[${index}].`;
    form.set(prefix + "identUserRole", String(roleId(role)));
    for (const field of ["shortname", "name", "activationStatus"] as const) {
      if (role[field] != null) {
        form.set(prefix + field, String(role[field]));
      }
    }
  });
  return form;
}

/**
 * Build URLSearchParams for updating a permission profile.
 * Matches permissionProfileUpdateForm in src/utils/users.js.
 */
export function permissionProfileUpdateForm(
  profile: PermissionProfile,
): URLSearchParams {
  const id = profileId(profile);
  if (!id || !profile.name?.trim() || !profile.userRoles?.length) {
    throw new Error("ID, nama profile, dan sedikitnya satu role wajib diisi.");
  }
  const form = permissionProfileForm(profile.name.trim(), profile.userRoles, true);
  form.set("identPermissionProfile", String(id));
  form.set("name", profile.name.trim());
  if (profile.deactivationDate) {
    form.set("deactivationDate", profile.deactivationDate);
  }
  if (profile.userAccount) {
    const owner = positive(
      profile.userAccount.ident,
      profile.userAccount.id,
      profile.userAccount.lifecycleEntity?.identEntity,
    );
    if (!owner) {
      throw new Error(
        "Identitas pemilik profile tidak valid. Muat ulang data profile.",
      );
    }
    form.set("userAccount.ident", String(owner));
  }
  return form;
}

export function buildProfileFormData(profile: {
  identPermissionProfile?: number;
  name: string;
  userAccountIdent?: number;
  roles: UserRole[];
}): Record<string, string | number> {
  const form = profile.identPermissionProfile
    ? permissionProfileUpdateForm({
        identPermissionProfile: profile.identPermissionProfile,
        name: profile.name,
        userRoles: profile.roles,
        ...(profile.userAccountIdent
          ? { userAccount: { ident: profile.userAccountIdent } }
          : {}),
      })
    : permissionProfileForm(profile.name, profile.roles, true);
  const out: Record<string, string | number> = {};
  form.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/* ── Daily Schedule Columnar & TAB-separated Parser ───────────────────────── */

export interface ColumnDef {
  name: string;
  type: number;
}

const DESCRIPTOR_HEAD = /^Name=[^;\t]+;Type=-?\d+/;

export function parseColumnDescriptor(desc: string): ColumnDef[] {
  const cols: ColumnDef[] = [];
  const re = /Name=([^;\t]+);Type=(-?\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(desc))) !== null) {
    cols.push({ name: m[1].trim(), type: Number(m[2]) });
  }
  return cols;
}

export function isColumnar(row: unknown): row is Record<string, string> {
  return (
    !!row &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    Object.keys(row as object).length === 1 &&
    DESCRIPTOR_HEAD.test(Object.keys(row as object)[0])
  );
}

export function zipColumns(
  cols: ColumnDef[],
  line: string,
): Record<string, unknown> {
  const values = String(line == null ? "" : line).split("\t");
  const row: Record<string, unknown> = {};
  cols.forEach((c, i) => {
    let v: string | undefined = values[i];
    if (v === undefined) v = "";
    if (c.type === 4 && v !== "") {
      const n = Number(v);
      row[c.name] = Number.isFinite(n) ? n : v;
    } else {
      row[c.name] = v;
    }
  });
  return row;
}

export function denormalizeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (!isColumnar(row)) return row;
  const key = Object.keys(row)[0];
  return zipColumns(parseColumnDescriptor(key), String(row[key] ?? ""));
}

/**
 * Parse text/plain columnar TAB-separated response from Daily Schedule.
 * Supports both descriptor header ("Name=id;Type=4;...\tName=...") and plain TAB headers.
 * Never splits on commas because values may contain commas.
 */
export function parseColumnarText(text: string): Record<string, unknown>[] {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (!lines.length) return [];
  if (DESCRIPTOR_HEAD.test(lines[0])) {
    const cols = parseColumnDescriptor(lines[0]);
    return lines.slice(1).map((l) => zipColumns(cols, l));
  }
  // Plain TAB-separated header fallback (still TAB-delimited, never comma-split if tabs exist)
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const row: Record<string, unknown> = {};
    headers.forEach((h, j) => {
      row[h] = cols[j] === undefined ? "" : cols[j];
    });
    rows.push(row);
  }
  return rows;
}

export const parseTabSeparated = parseColumnarText;

export function toScheduleDay(value?: string): string {
  if (!value) return "";
  const s = String(value).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 8) {
    throw new Error(
      `Format tanggal scheduleDay harus YYYYMMDD atau YYYY-MM-DD (8 digit), diterima: "${value}"`,
    );
  }
  return digits;
}
