/**
 * Credential redaction & user normalization utilities.
 * Ensures hash, salt, password, pwdHash, token, secret, authorization never leak to the model.
 */
import type { UserRecord, PermissionProfile } from "../types.js";

const SENSITIVE_KEY_REGEX =
  /^(?:password|newPassword|oldPassword|passwordHash|passwordSalt|pwd|pwdHash|hash|salt|token|accessToken|refreshToken|access_token|refresh_token|secret|apiKey|api_key|credential|credentials|authorization)$/i;

const SENSITIVE_SUBSTRING_REGEX =
  /(?:password|pwdhash|hash|salt|token|secret|credential|apikey|authorization)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_REGEX.test(key) || SENSITIVE_SUBSTRING_REGEX.test(key);
}

const positive = (...values: unknown[]): number | undefined =>
  values
    .map(Number)
    .find((value) => Number.isSafeInteger(value) && value > 0);

/**
 * Redact a user record specifically — removes credential fields entirely and normalizes lifecycle fields.
 * Follows src/utils/users.js normalizeUser in original repo.
 */
export function normalizeUser(record: unknown): UserRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const raw = record as Record<string, unknown>;
  if (Object.keys(raw).length === 0) return null;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isSensitiveKey(key)) continue;
    if (typeof value === "object" && value !== null) {
      cleaned[key] = redactCredentials(value);
    } else {
      cleaned[key] = value;
    }
  }

  const lifecycle = (cleaned.lifecycleEntity as Record<string, unknown>) || {};
  const activation =
    (lifecycle.activationType as Record<string, unknown>) || {};

  const id = positive(lifecycle.identEntity, raw.id, raw.ident, raw.identUser);
  const identRevision = positive(lifecycle.identRevision, raw.identRevision);
  const identActivationType = positive(
    activation.identActivationType,
    raw.identActivationType,
  );

  return {
    ...cleaned,
    ...(id !== undefined ? { id } : {}),
    ...(identRevision !== undefined ? { identRevision } : {}),
    ...(identActivationType !== undefined ? { identActivationType } : {}),
    permissionProfilesLoaded:
      typeof raw.permissionProfilesLoaded === "boolean"
        ? raw.permissionProfilesLoaded
        : Array.isArray(raw.permissionProfiles),
    permissionProfiles: Array.isArray(cleaned.permissionProfiles)
      ? (cleaned.permissionProfiles as PermissionProfile[])
      : [],
  } as UserRecord;
}

/**
 * Removes sensitive fields from a user object completely.
 */
export function redactUserRecord(
  user: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = normalizeUser(user);
  return (normalized || {}) as Record<string, unknown>;
}

/**
 * Deep-redact sensitive fields from any object or array.
 * Sensitive keys have their values replaced with "[REDACTED]".
 */
export function redactCredentials<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    return redactStringSecrets(data) as unknown as T;
  }
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => redactCredentials(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactCredentials(value);
    } else if (typeof value === "string") {
      result[key] = redactStringSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Audit value redaction — matches src/utils/audit.js redactAuditValue in original repo.
 * Handles objects, arrays, JSON embedded in strings, and Java toString format UserPO[password=..., salt=...].
 */
export function redactAuditValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, data]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : redactAuditValue(data),
      ]),
    ) as unknown as T;
  }
  if (typeof value !== "string") return value;

  // Check if string is JSON
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        return JSON.stringify(redactAuditValue(parsed)) as unknown as T;
      }
    } catch {
      // Fall through to regex replacement
    }
  }

  return redactStringSecrets(value) as unknown as T;
}

export function redactStringSecrets(text: string): string {
  return text
    .replace(
      /(\b(?:password|newPassword|oldPassword|passwordHash|passwordSalt|pwdHash|pwd|salt|hash|token|access_token|refresh_token|secret|apiKey|authorization)\s*[=:]\s*)(?:\[disamarkan\]|\[REDACTED\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\]\r\n;}\s]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
}
