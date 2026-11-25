/**
 * Login & session verification flow:
 * 1. POST /api/v1/user/loginv2 (application/x-www-form-urlencoded: email, password)
 * 2. Verify principal via GET /api/v1/akunkeuangan/test (returns text/xml or plain text principal name)
 * 3. Fetch permissions via GET /api/v2/user/fetchAuthorizedPermissionProfiles
 *
 * Credentials and tokens are stored strictly per session and never returned to the model or logged.
 */
import { config } from "../config.js";
import { apiRequest, authenticatedRequest } from "../api/client.js";
import {
  createSession,
  updateSession,
  setSessionPermissions,
  getSession,
} from "./session.js";
import { rowsOf } from "../utils/dto.js";
import { normalizeUser } from "../utils/redact.js";
import { ApiError } from "../types.js";
import type { PermissionProfile, SessionData } from "../types.js";

export interface LoginResult {
  success: boolean;
  message: string;
  userId?: number;
  username?: string;
  principal?: string;
  profileCount?: number;
}

/**
 * Extract principal string from GET /api/v1/akunkeuangan/test response.
 * Backend returns text/xml or plain text containing principal.getName(), or JSON in some mocks.
 */
export function parsePrincipalResponse(rawResponse: unknown): string {
  if (typeof rawResponse === "string") {
    const trimmed = rawResponse.trim();
    // Handle simple XML tags like <string>vito</string> if present
    const xmlMatch = /^<[^>]+>([^<]+)<\/[^>]+>$/.exec(trimmed);
    const extracted = (xmlMatch ? xmlMatch[1] : trimmed).trim();
    // Or JSON string
    if (extracted.startsWith("{") && extracted.endsWith("}")) {
      try {
        const obj = JSON.parse(extracted) as Record<string, unknown>;
        return String(
          obj.principal ?? obj.username ?? obj.email ?? obj.name ?? "",
        ).trim();
      } catch {
        return extracted;
      }
    }
    return extracted;
  }
  if (rawResponse && typeof rawResponse === "object") {
    const obj = rawResponse as Record<string, unknown>;
    return String(
      obj.principal ?? obj.username ?? obj.email ?? obj.name ?? "",
    ).trim();
  }
  return "";
}

/**
 * Verify an existing Bearer token against /api/v1/akunkeuangan/test and load permissions.
 */
export async function verifyAndInitializeSession(
  sessionId: string,
  token: string,
  identityHint?: string,
  targetUrl?: string,
): Promise<SessionData> {
  const target = targetUrl || config.apiBaseUrl;
  createSession(sessionId, target);

  // Step 1: Verify principal via GET /api/v1/akunkeuangan/test
  const rawPrincipal = await authenticatedRequest<string>(token, {
    method: "GET",
    url: `${target}/api/v1/akunkeuangan/test`,
    raw: true,
    timeoutMs: config.requestTimeoutMs,
  });

  const principal = parsePrincipalResponse(rawPrincipal);
  if (!principal || !/^[\p{L}\p{N}@._+\- ]{1,200}$/u.test(principal)) {
    updateSession(sessionId, { token: "", verified: false });
    throw new ApiError(
      401,
      "Verifikasi principal gagal: respons /api/v1/akunkeuangan/test tidak valid.",
      { code: "INVALID_PRINCIPAL" },
    );
  }

  // Step 2: Fetch authorized permission profiles
  const permsResponse = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${target}/api/v2/user/fetchAuthorizedPermissionProfiles`,
    timeoutMs: config.requestTimeoutMs,
  });

  const permissions = rowsOf(permsResponse) as PermissionProfile[];

  // Optional Step 3: Resolve userId & username from authorized profiles or user list if accessible
  let userId = 0;
  let username = identityHint || principal;
  let email = identityHint || principal;

  // Check if any individual profile in permissions has userAccount info
  for (const prof of permissions) {
    const ua = prof.userAccount;
    if (ua) {
      const uid = Number(
        ua.lifecycleEntity?.identEntity ?? ua.ident ?? ua.id ?? 0,
      );
      if (Number.isSafeInteger(uid) && uid > 0) {
        userId = uid;
      }
    }
    if (prof.name && /^AKN\/[A-Za-z0-9_.-]+$/i.test(prof.name)) {
      username = prof.name.slice(4);
    }
  }

  updateSession(sessionId, {
    token,
    target,
    userId,
    username,
    email,
    principal,
    principalInfo: { principal, username, email, ...(userId ? { userId } : {}) },
    loginTimestamp: Date.now(),
    verified: true,
    scheduleHeadersCache: undefined,
  });
  setSessionPermissions(sessionId, permissions);

  return getSession(sessionId)!;
}

/**
 * Perform full login with email/username & password:
 * POST /api/v1/user/loginv2 (form-urlencoded) -> GET /api/v1/akunkeuangan/test -> GET /api/v2/user/fetchAuthorizedPermissionProfiles
 */
export async function performLogin(
  sessionId: string,
  email: string,
  password: string,
  targetUrl?: string,
): Promise<LoginResult> {
  const target = targetUrl || config.apiBaseUrl;
  createSession(sessionId, target);

  const form = new URLSearchParams();
  form.set("email", email.trim());
  form.set("password", password);

  let loginResponse: Record<string, unknown>;
  try {
    loginResponse = await apiRequest<Record<string, unknown>>({
      method: "POST",
      url: `${target}/api/v1/user/loginv2`,
      body: form,
      timeoutMs: config.requestTimeoutMs,
    });
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.status === 401 ||
        ([400, 403].includes(err.status) &&
          /invalid.*(?:user|password|credential)|bad credentials|password.*(?:wrong|incorrect|salah)/i.test(
            err.message,
          )))
    ) {
      throw new ApiError(
        401,
        "Email / username atau password salah.",
        { code: "INVALID_CREDENTIALS" },
      );
    }
    throw err;
  }

  const token = extractToken(loginResponse);
  if (!token) {
    return {
      success: false,
      message: "Login gagal: backend tidak mengembalikan token.",
    };
  }

  const session = await verifyAndInitializeSession(
    sessionId,
    token,
    email.trim(),
    target,
  );

  // If user has UserAccount View permission and userId is still 0, try resolving from GET /api/v2/user
  if (!session.userId) {
    try {
      const usersRes = await authenticatedRequest<unknown>(token, {
        method: "GET",
        url: `${target}/api/v2/user`,
        timeoutMs: config.requestTimeoutMs,
      });
      const users = rowsOf(usersRes)
        .map(normalizeUser)
        .filter((u): u is NonNullable<typeof u> => u !== null);
      const matched = users.find(
        (u) =>
          u.email?.trim().toLowerCase() === email.trim().toLowerCase() ||
          u.username?.trim().toLowerCase() === email.trim().toLowerCase() ||
          u.email?.trim().toLowerCase() === session.principal.toLowerCase() ||
          u.username?.trim().toLowerCase() === session.principal.toLowerCase(),
      );
      if (matched && matched.id) {
        updateSession(sessionId, {
          userId: matched.id,
          username: matched.username || session.username,
          email: matched.email || session.email,
        });
      }
    } catch {
      // Non-fatal: user may not have permission to list all users
    }
  }

  const finalSession = getSession(sessionId)!;
  return {
    success: true,
    message: "Autentikasi berhasil.",
    userId: finalSession.userId,
    username: finalSession.username,
    principal: finalSession.principal,
    profileCount: finalSession.permissions.length,
  };
}

function extractToken(response: Record<string, unknown>): string | null {
  if (!response || typeof response !== "object") return null;
  if (typeof response.token === "string" && response.token.trim().length > 0) {
    return response.token.trim();
  }
  if (
    typeof response.data === "object" &&
    response.data !== null &&
    typeof (response.data as Record<string, unknown>).token === "string"
  ) {
    return ((response.data as Record<string, unknown>).token as string).trim();
  }
  if (typeof response.accessToken === "string" && response.accessToken.trim()) {
    return response.accessToken.trim();
  }
  return null;
}
