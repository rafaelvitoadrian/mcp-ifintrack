/**
 * HTTP API client with comprehensive error handling.
 * Follows src/services/api.js and mcp.js from the original repository:
 * - Handles HTML responses (ngrok/proxy pages), malformed JSON, 401/403/429,
 *   empty body on 200, timeouts (30s read, 240s write), abort signals, and response size limit.
 * - Never sends Accept: application/json to Daily Schedule (which responds 406).
 * - Never auto-retries mutations.
 */
import { ApiError } from "../types.js";
import { config } from "../config.js";
import { redactStringSecrets } from "../utils/redact.js";

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData | Buffer;
  timeoutMs?: number;
  signal?: AbortSignal;
  raw?: boolean;
  emptyOn200AsNull?: boolean;
  maxBytes?: number;
}

export function ngrokHeaders(targetUrl: string): Record<string, string> {
  try {
    const hostname = new URL(targetUrl).hostname;
    return /(?:^|\.)ngrok(?:-free)?\.(?:app|dev)$|(?:^|\.)ngrok\.io$/i.test(
      hostname,
    )
      ? { "ngrok-skip-browser-warning": "1" }
      : {};
  } catch {
    return {};
  }
}

function isDailyScheduleUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return /^\/dailyschedule(?:\/|$)/i.test(pathname);
  } catch {
    return /\/dailyschedule(?:\/|$)/i.test(url);
  }
}

function extractValidationMessages(payload: unknown, status: number): string[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const source =
    obj.errors ?? obj.validationErrors ?? obj.violations ?? obj.fieldErrors;
  if (!source) {
    const message = obj.message ?? obj.detail ?? obj.error;
    return (status === 400 || status === 422) &&
      /validasi|validation|field error|constraint violation/i.test(
        String(message || ""),
      )
      ? [String(message)]
      : [];
  }
  if (Array.isArray(source)) {
    return source
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          return [
            rec.field ?? rec.propertyPath,
            rec.defaultMessage ?? rec.message,
          ]
            .filter(Boolean)
            .join(": ");
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof source === "object" && source !== null) {
    return Object.entries(source as Record<string, unknown>)
      .flatMap(([field, value]) =>
        (Array.isArray(value) ? value : [value]).map(
          (msg) => `${field}: ${String(msg)}`,
        ),
      )
      .filter(Boolean);
  }
  return [];
}

function extractErrorMessage(
  payload: unknown,
  status: number,
  method: string,
  url: string,
): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const validation = extractValidationMessages(payload, status);
    if (validation.length > 0) {
      return `Validasi ditolak (HTTP ${status}): ${validation.join("; ")}`;
    }
    if (obj.error) return String(obj.error);
    if (obj.message) return String(obj.message);
    if (obj.detail) return String(obj.detail);
    if (typeof obj.response === "string") return obj.response;
  }
  if (typeof payload === "string" && payload.trim()) {
    const t = redactStringSecrets(payload.trim());
    return t.length < 300 ? t : `${t.slice(0, 300)}…`;
  }
  if (status === 401) {
    return "Autentikasi diperlukan atau token kedaluwarsa (HTTP 401).";
  }
  if (status === 403) {
    return "Akses ditolak oleh backend (HTTP 403). Anda tidak memiliki izin untuk operasi ini.";
  }
  if (status === 404) {
    return `Resource tidak ditemukan (HTTP 404): ${method} ${url}`;
  }
  if (status === 429) {
    return "Batas laju permintaan terlampaui (HTTP 429). Tunggu sebelum mengirim permintaan lagi.";
  }
  if (status >= 500) {
    return `Kesalahan server backend (HTTP ${status}) pada ${method}.`;
  }
  return `Permintaan gagal (HTTP ${status}).`;
}

export async function apiRequest<T>(options: RequestOptions): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    raw = false,
    emptyOn200AsNull = false,
    maxBytes = 8 * 1024 * 1024,
  } = options;

  const isWrite = ["POST", "PUT", "DELETE"].includes(method);
  const timeoutMs =
    options.timeoutMs ??
    (isWrite ? config.writeTimeoutMs : config.requestTimeoutMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  const finalHeaders: Record<string, string> = {
    ...ngrokHeaders(url),
    ...headers,
  };

  if (body instanceof URLSearchParams && !finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] =
      "application/x-www-form-urlencoded;charset=UTF-8";
  }

  // Note: Daily Schedule returns 406 if Accept: application/json is sent on text/plain endpoints
  if (isDailyScheduleUrl(url) && finalHeaders["Accept"] === "application/json") {
    delete finalHeaders["Accept"];
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: finalHeaders,
      signal,
      redirect: "manual",
    };

    if (body !== undefined && method !== "GET") {
      fetchOptions.body =
        body instanceof URLSearchParams ? body.toString() : (body as BodyInit);
    }

    const response = await fetch(url, fetchOptions);

    // Read body with size cap
    let responseText = "";
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let totalSize = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        totalSize += next.value.byteLength;
        if (totalSize > maxBytes) {
          await reader.cancel();
          throw new ApiError(
            413,
            `Respons backend melebihi batas ukuran aman (${maxBytes} bytes).`,
            { code: "RESPONSE_TOO_LARGE" },
          );
        }
        chunks.push(Buffer.from(next.value));
      }
      responseText = Buffer.concat(chunks).toString("utf-8");
    } else {
      responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf-8") > maxBytes) {
        throw new ApiError(
          413,
          `Respons backend melebihi batas ukuran aman (${maxBytes} bytes).`,
          { code: "RESPONSE_TOO_LARGE" },
        );
      }
    }

    const contentType = response.headers.get("content-type") || "";
    const looksLikeHtml =
      /text\/html/i.test(contentType) ||
      /^\s*<!doctype\s+html\b|^\s*<html\b/i.test(responseText);

    // Always detect HTML responses (ngrok warning page, proxy error page, login redirect)
    if (!raw && looksLikeHtml) {
      throw new ApiError(
        response.ok ? 502 : response.status,
        "Server mengembalikan halaman HTML, bukan data API. Periksa URL server dan konfigurasi proxy/ngrok.",
        {
          code: "INVALID_API_RESPONSE",
          details: {
            contentType,
            bodyPreview: redactStringSecrets(responseText.slice(0, 200)),
          },
        },
      );
    }

    if (response.status === 401) {
      throw new ApiError(
        401,
        "Autentikasi ditolak atau sesi berakhir (HTTP 401). Silakan login kembali.",
        { code: "UNAUTHORIZED" },
      );
    }
    if (response.status === 403) {
      throw new ApiError(
        403,
        "Akses ditolak oleh backend (HTTP 403). Anda tidak memiliki hak akses untuk endpoint ini.",
        { code: "FORBIDDEN" },
      );
    }
    if (response.status === 429) {
      throw new ApiError(
        429,
        "Terlalu banyak permintaan (HTTP 429). Tunggu beberapa saat sebelum mencoba lagi.",
        { code: "RATE_LIMITED" },
      );
    }

    if (!response.ok) {
      let parsedError: unknown = responseText;
      if (responseText && /json/i.test(contentType)) {
        try {
          parsedError = JSON.parse(responseText);
        } catch {
          parsedError = responseText;
        }
      }
      const validation = extractValidationMessages(parsedError, response.status);
      throw new ApiError(
        response.status,
        extractErrorMessage(parsedError, response.status, method, url),
        {
          code: `HTTP_${response.status}`,
          details: redactStringSecrets(
            typeof parsedError === "string"
              ? parsedError.slice(0, 500)
              : JSON.stringify(parsedError).slice(0, 500),
          ),
          validation,
        },
      );
    }

    // Raw text/plain or text/xml response
    if (raw || contentType.includes("text/plain") || contentType.includes("text/xml")) {
      return responseText as unknown as T;
    }

    // Empty body on HTTP 200 means record not found per backend contract
    if (!responseText || responseText.trim() === "") {
      if (emptyOn200AsNull) {
        return null as unknown as T;
      }
      throw new ApiError(
        404,
        "Data tidak ditemukan (respons HTTP 200 dengan body kosong).",
        { code: "EMPTY_BODY_NOT_FOUND" },
      );
    }

    try {
      return JSON.parse(responseText) as T;
    } catch {
      throw new ApiError(
        502,
        "Server mengembalikan data JSON yang tidak valid (malformed JSON).",
        {
          code: "INVALID_API_RESPONSE",
          details: {
            bodyPreview: redactStringSecrets(responseText.slice(0, 200)),
          },
        },
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if (err instanceof Error) {
      if (err.name === "AbortError" || err.name === "TimeoutError") {
        const writeNote = isWrite
          ? " Operasi tulis TIDAK diulang otomatis; periksa data terbaru di backend sebelum mencoba kembali."
          : "";
        throw new ApiError(
          408,
          `Permintaan dihentikan atau timeout setelah ${Math.round(timeoutMs / 1000)} detik.${writeNote}`,
          { code: "REQUEST_TIMEOUT" },
        );
      }
      const causeMsg =
        err.cause && typeof err.cause === "object" && "message" in err.cause
          ? ` (${String((err.cause as { message: unknown }).message)})`
          : err.cause
            ? ` (${String(err.cause)})`
            : "";
      throw new ApiError(
        0,
        `Kegagalan jaringan saat menghubungi backend: ${redactStringSecrets(err.message + causeMsg)}`,
        { code: "NETWORK_ERROR" },
      );
    }
    throw new ApiError(0, "Kesalahan permintaan tidak diketahui.", {
      code: "UNKNOWN_ERROR",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Make an authenticated request to the main API using session Bearer token.
 * Never call this for Daily Schedule endpoints!
 */
export async function authenticatedRequest<T>(
  token: string,
  options: Omit<RequestOptions, "headers"> & {
    headers?: Record<string, string>;
  },
): Promise<T> {
  if (!token) {
    throw new ApiError(401, "Bearer token sesi tidak tersedia.", {
      code: "MISSING_TOKEN",
    });
  }
  if (isDailyScheduleUrl(options.url)) {
    throw new ApiError(
      400,
      "Daily Schedule tidak boleh menerima Bearer token backend utama.",
      { code: "SCHEDULE_BEARER_FORBIDDEN" },
    );
  }
  return apiRequest<T>({
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}
