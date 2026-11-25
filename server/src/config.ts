import dotenv from "dotenv";
dotenv.config();

export function normalizeBaseUrl(raw: string, envName: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    throw new Error(`${envName} is not a valid URL: ${trimmed}`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `${envName} must be a clean HTTP/HTTPS origin without credentials, query, or hash.`,
    );
  }
  return parsed.href.replace(/\/+$/, "");
}

export const config = {
  get apiBaseUrl(): string {
    return normalizeBaseUrl(
      process.env.FINTRACK_API_BASE_URL || "https://dev-ifintrack.rafaelvito.online",
      "FINTRACK_API_BASE_URL",
    );
  },
  get scheduleBaseUrl(): string {
    return normalizeBaseUrl(
      process.env.FINTRACK_SCHEDULE_BASE_URL || "",
      "FINTRACK_SCHEDULE_BASE_URL",
    );
  },
  get timezone(): string {
    return process.env.FINTRACK_TIMEZONE || "Asia/Jakarta";
  },
  get port(): number {
    return parseInt(process.env.PORT || "3000", 10);
  },
  get approvalTimeoutMs(): number {
    return parseInt(process.env.APPROVAL_TIMEOUT_MS || "900000", 10); // 15 minutes default
  },
  get maxResultSize(): number {
    return parseInt(process.env.MAX_RESULT_SIZE || "48000", 10);
  },
  get requestTimeoutMs(): number {
    return parseInt(process.env.REQUEST_TIMEOUT_MS || "30000", 10);
  },
  get writeTimeoutMs(): number {
    return parseInt(process.env.WRITE_TIMEOUT_MS || "240000", 10);
  },
  get pingTimeoutMs(): number {
    return parseInt(process.env.SCHEDULE_PING_TIMEOUT_MS || "6000", 10);
  },
  uploadRoles: ["Administration", "Vito_Super"] as const,
  uploadDefaultRole: "Administration",
};

export function validateConfig(): void {
  const api = config.apiBaseUrl;
  if (!api) {
    throw new Error("FINTRACK_API_BASE_URL is required");
  }
  // Access scheduleBaseUrl getter to validate if present
  void config.scheduleBaseUrl;
}
