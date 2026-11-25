/**
 * Payload builders and lifecycle contract helpers.
 * Directly follows src/utils/payload.js, src/utils/users.js, and src/utils/transactions.js
 * from the original repository.
 */
import type {
  Account,
  UserRecord,
  PermissionProfile,
  UserRole,
} from "../types.js";
import { roleId, profileId } from "./encoding.js";

export const ACTIVATION_TYPES = [
  { value: 1, label: "1 - Active" },
  { value: 5, label: "5 - InActive" },
  { value: 4, label: "4 - Suspended" },
  { value: 2, label: "2 - Deactivated" },
] as const;

export const DEFAULT_ACTIVATION = 1;

const positive = (...values: unknown[]): number | undefined =>
  values
    .map(Number)
    .find((value) => Number.isSafeInteger(value) && value > 0);

export const isIndividualProfile = (profile: PermissionProfile): boolean =>
  profile?.individual === true || !!profile?.userAccount;

export const profileOwnerId = (
  profile: PermissionProfile,
): number | undefined =>
  positive(
    profile?.userAccount?.lifecycleEntity?.identEntity,
    profile?.userAccount?.id,
    profile?.userAccount?.ident,
  );

export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== "") {
      out[k] = v;
    }
  }
  return out as Partial<T>;
}

/** LocalDateTime -> "yyyy-MM-dd HH:mm:ss" (format @JsonFormat di LifecycleEntity). */
export function toBackendDateTime(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return null;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** LocalDate -> "yyyy-MM-dd" (format requestedActivationDate di LifecycleEntity). */
export function toBackendDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** TransaksiKeuanganPO transactionDate format: "yyyy-MM-dd'T'HH:mm:ss" */
export function toTransactionDateTime(value: unknown): string {
  if (!value || typeof value !== "string") {
    throw new Error("Tanggal transaksi wajib berupa string YYYY-MM-DDTHH:mm:ss.");
  }
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s)) {
    throw new Error("Tanggal transaksi harus berformat YYYY-MM-DDTHH:mm:ss.");
  }
  const normalized = s.length === 16 ? `${s}:00` : s;
  const parsed = new Date(`${normalized}Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== normalized
  ) {
    throw new Error("Tanggal transaksi tidak valid.");
  }
  return normalized;
}

export function activationType(value?: number): {
  identActivationType: number;
} {
  const id = Number(value);
  return {
    identActivationType:
      Number.isFinite(id) && id > 0 ? id : DEFAULT_ACTIVATION,
  };
}

/**
 * lifecycleEntity for CREATE — MUST NOT include identEntity!
 */
export function lifecycleForCreate(opts?: {
  activationType?: number;
  requestedActivationDate?: string;
}): Record<string, unknown> {
  return compact({
    activationType: activationType(opts?.activationType),
    requestedActivationDate: toBackendDate(opts?.requestedActivationDate),
  });
}

/**
 * lifecycleEntity for UPDATE — MUST include identEntity from latest record.
 */
export function lifecycleForUpdate(
  record: { id?: number; identRevision?: number },
  opts?: { activationType?: number },
): Record<string, unknown> {
  if (!record || !record.id || !Number.isSafeInteger(Number(record.id))) {
    throw new Error(
      "Record tanpa id tidak bisa di-update: lifecycleEntity.identEntity wajib diisi.",
    );
  }
  return compact({
    identEntity: Number(record.id),
    identRevision: record.identRevision
      ? Number(record.identRevision)
      : undefined,
    activationType: activationType(opts?.activationType),
  });
}

/* ── Akun Keuangan Payloads ─────────────────────────────────────────────── */

export function akunCreate(v: {
  name: string;
  description?: string | null;
  accountType: number;
  activationType?: number;
  requestedActivationDate?: string;
}): Record<string, unknown> {
  const accountType = Number(v.accountType);
  if (!Number.isFinite(accountType) || accountType < 0 || accountType > 999) {
    throw new Error(
      "accountType wajib diisi dengan bilangan bulat 0-999 (dipakai server untuk menyusun nomor rekening).",
    );
  }
  const name = (v.name || "").trim();
  if (!name) {
    throw new Error("Nama rekening wajib diisi.");
  }
  return compact({
    name,
    description: v.description ? String(v.description).trim() : null,
    accountType,
    lifecycleEntity: lifecycleForCreate(v),
  });
}

export function akunUpdate(
  record: Account,
  v: {
    name?: string;
    description?: string | null;
    activationType?: number;
  },
): Record<string, unknown> {
  const name = (v.name ?? record.name ?? "").trim();
  if (!name) {
    throw new Error("Nama rekening wajib diisi.");
  }
  const desc =
    v.description !== undefined ? v.description : record.description;
  return compact({
    name,
    description: desc ? String(desc).trim() : null,
    lifecycleEntity: lifecycleForUpdate(record, {
      activationType: v.activationType ?? record.identActivationType ?? 1,
    }),
  });
}

/* ── Category & Transaction Payloads ────────────────────────────────────── */

export function categoryCreatePayload(v: {
  accountId: number;
  name: string;
  type: number;
}): Record<string, unknown> {
  if (![1, 2].includes(Number(v.type))) {
    throw new Error("Tipe kategori harus 1 (CREDIT) atau 2 (DEBIT).");
  }
  return {
    category_name: v.name.trim(),
    category_type: Number(v.type),
    akunKeuangan: { id: Number(v.accountId) },
  };
}

export function categoryUpdatePayload(
  existing: { id: number; category_type: number },
  v: { accountId: number; categoryId: number; name: string },
): Record<string, unknown> {
  return {
    id: Number(v.categoryId),
    category_name: v.name.trim(),
    category_type: Number(existing.category_type),
    akunKeuangan: { id: Number(v.accountId) },
  };
}

export function transactionPayload(
  v: {
    accountId: number;
    name: string;
    description?: string | null;
    amount: number;
    type: number;
    date: string;
    categoryId?: number | null;
    externalReference?: string | null;
  },
  existingId?: number,
): Record<string, unknown> {
  if (![1, 2].includes(Number(v.type))) {
    throw new Error("Jenis transaksi harus 1 (CREDIT) atau 2 (DEBIT).");
  }
  const payload: Record<string, unknown> = {
    ...(existingId !== undefined
      ? { id: Number(existingId) }
      : { externalreference: v.externalReference?.trim() || null }),
    name: v.name.trim(),
    description: v.description?.trim() || null,
    nominal: Number(v.amount),
    jenis: Number(v.type),
    transactionDate: toTransactionDateTime(v.date),
    idAkunKeuangan: Number(v.accountId),
    category:
      v.categoryId !== null && v.categoryId !== undefined
        ? { id: Number(v.categoryId) }
        : null,
  };
  return payload;
}

/* ── User & Profile Payloads ────────────────────────────────────────────── */

export function profileReferences(
  profiles: PermissionProfile[] = [],
  { inline = false, ownerId }: { inline?: boolean; ownerId?: number } = {},
): Record<string, unknown>[] {
  return profiles.map((profile) => {
    const id = Number(
      profile.identPermissionProfile ?? profile.ident ?? profile.id,
    );
    const individual = isIndividualProfile(profile);
    if (
      inline &&
      individual &&
      (id === 0 || (ownerId && Number.isSafeInteger(id) && id > 0))
    ) {
      if (!profile.name?.trim() || !profile.userRoles?.length) {
        throw new Error(
          "Nama profile individual dan sedikitnya satu role wajib diisi.",
        );
      }
      return {
        identPermissionProfile: id,
        name: profile.name.trim(),
        ...(id > 0 && ownerId ? { userAccount: { ident: Number(ownerId) } } : {}),
        userRoles: profile.userRoles.map((role) => {
          const rId = roleId(role);
          if (!rId) {
            throw new Error("ID role tidak valid.");
          }
          return compact({
            identUserRole: rId,
            shortname: role.shortname,
            name: role.name,
            activationStatus: role.activationStatus,
          });
        }),
      };
    }
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(
        "ID permission profile tidak valid. Gunakan ID profile tersimpan (>0) atau profile individual dengan identPermissionProfile: 0.",
      );
    }
    return { identPermissionProfile: id };
  });
}

export function userCreate(v: {
  name: string;
  username: string;
  email: string;
  password: string;
  activationType?: number;
  requestedActivationDate?: string;
  permissionProfiles?: PermissionProfile[];
}): Record<string, unknown> {
  const password = v.password == null ? "" : String(v.password);
  if (!password) throw new Error("Password wajib diisi saat membuat user.");
  const email = (v.email || "").trim();
  const username = (v.username || "").trim();
  const name = (v.name || "").trim();
  if (!email || !username || !name) {
    throw new Error("Nama, username, dan email wajib diisi.");
  }
  return compact({
    name,
    username,
    email,
    password,
    lifecycleEntity: lifecycleForCreate(v),
    ...(v.permissionProfiles
      ? {
          permissionProfiles: profileReferences(v.permissionProfiles, {
            inline: true,
          }),
        }
      : {}),
  });
}

export function userUpdate(
  record: UserRecord,
  v: {
    name?: string;
    username?: string;
    email?: string;
    activationType?: number;
    permissionProfiles?: PermissionProfile[];
  },
): Record<string, unknown> {
  if (record?.permissionProfilesLoaded === false) {
    throw new Error(
      "Permission profile user belum diterima dari backend. Muat ulang dari backend terbaru sebelum menyimpan user.",
    );
  }
  const name = (v.name ?? record.name ?? "").trim();
  const username = (v.username ?? record.username ?? "").trim();
  const email = (v.email ?? record.email ?? "").trim();
  return compact({
    name: name || null,
    username: username || null,
    email,
    lifecycleEntity: lifecycleForUpdate(
      { id: record.id, identRevision: record.identRevision },
      {
        activationType:
          v.activationType ?? record.identActivationType ?? DEFAULT_ACTIVATION,
      },
    ),
    permissionProfiles: profileReferences(
      v.permissionProfiles ?? record.permissionProfiles ?? [],
      {
        inline: v.permissionProfiles !== undefined,
        ownerId: record.id,
      },
    ),
  });
}

const sameIds = <T>(
  left: T[],
  right: T[],
  identify: (item: T) => number | undefined,
): boolean => {
  const a = [...new Set(left.map(identify).filter((x): x is number => x !== undefined))].sort(
    (x, y) => x - y,
  );
  const b = [...new Set(right.map(identify).filter((x): x is number => x !== undefined))].sort(
    (x, y) => x - y,
  );
  return a.length === b.length && a.every((id, index) => id === b[index]);
};

/**
 * Verify that saved user permission profiles match expected profiles.
 * Individual profiles may be cloned with a new ID by the backend, so we match
 * by owner user ID, uppercase profile name, and exact role IDs.
 */
export function userProfilesMatch(
  user: UserRecord | null,
  expected: PermissionProfile[],
): boolean {
  if (!user || user.permissionProfilesLoaded === false) return false;
  const actual = user.permissionProfiles || [];
  return (
    actual.length === expected.length &&
    expected.every((profile) =>
      actual.some((saved) =>
        isIndividualProfile(profile)
          ? isIndividualProfile(saved) &&
            (profileOwnerId(saved) === undefined ||
              profileOwnerId(saved) === user.id) &&
            saved.name?.trim().toUpperCase() ===
              profile.name?.trim().toUpperCase() &&
            sameIds(saved.userRoles || [], profile.userRoles || [], roleId)
          : profileId(saved) === profileId(profile),
      ),
    )
  );
}

/**
 * Build updated user permission profiles array when updating individual roles or shared profile refs.
 * Preserves existing individual profile ID and sets userAccount.ident = user.id (never blindly forces ID 0 on update!).
 */
export function buildUpdatedUserProfiles(
  existingUser: UserRecord,
  options: {
    roles?: UserRole[];
    sharedProfileIds?: number[];
    profileName?: string;
  },
): PermissionProfile[] {
  const currentProfiles = existingUser.permissionProfiles || [];
  const existingIndividual = currentProfiles.find(isIndividualProfile);
  const result: PermissionProfile[] = [];

  if (options.sharedProfileIds && options.sharedProfileIds.length > 0) {
    for (const pid of options.sharedProfileIds) {
      result.push({ identPermissionProfile: pid });
    }
  } else if (!options.roles) {
    // Keep existing shared profiles if neither sharedProfileIds nor roles replaced them
    for (const p of currentProfiles) {
      if (!isIndividualProfile(p) && profileId(p)) {
        result.push({ identPermissionProfile: profileId(p) });
      }
    }
  }

  if (options.roles && options.roles.length > 0) {
    const existingId = existingIndividual
      ? profileId(existingIndividual) ?? 0
      : 0;
    const uname = (existingUser.username || "USER").trim().toUpperCase();
    const name =
      options.profileName?.trim() ||
      existingIndividual?.name?.trim() ||
      `AKN/${uname}`;
    result.push({
      identPermissionProfile: existingId,
      individual: true,
      name,
      ...(existingId > 0 && existingUser.id
        ? { userAccount: { ident: Number(existingUser.id) } }
        : {}),
      userRoles: options.roles,
    });
  } else if (existingIndividual && !options.sharedProfileIds) {
    result.push(existingIndividual);
  }

  return result;
}
