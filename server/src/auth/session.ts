/**
 * Session manager — isolated per-session authentication state.
 * Each MCP session gets its own token, principal, and permission data.
 * Never uses a single global token shared across all users.
 */
import { config } from "../config.js";
import { buildPermissionIndex } from "../utils/permissions.js";
import type { SessionData, PermissionProfile } from "../types.js";

const sessions = new Map<string, SessionData>();

export function createSession(sessionId: string, target?: string): SessionData {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const session: SessionData = {
    sessionId,
    token: "",
    target: target || config.apiBaseUrl,
    userId: 0,
    username: "",
    email: "",
    principal: "",
    permissions: [],
    permissionIndex: Object.create(null),
    permissionsLoaded: false,
    principalInfo: {},
    loginTimestamp: 0,
    verified: false,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): SessionData | undefined {
  return sessions.get(sessionId);
}

export function requireSession(sessionId: string): SessionData {
  const session = sessions.get(sessionId);
  if (!session || !session.verified || !session.token) {
    throw new Error(
      "Sesi belum terautentikasi. Pastikan sesi telah login atau mengirim Bearer token yang sah.",
    );
  }
  return session;
}

export function updateSession(
  sessionId: string,
  updates: Partial<SessionData>,
): SessionData {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
  }
  if (updates.permissions !== undefined) {
    updates.permissionIndex = buildPermissionIndex(updates.permissions);
  }
  Object.assign(session, updates);
  return session;
}

export function setSessionPermissions(
  sessionId: string,
  profiles: PermissionProfile[],
): void {
  updateSession(sessionId, {
    permissions: profiles,
    permissionIndex: buildPermissionIndex(profiles),
    permissionsLoaded: true,
  });
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function clearAllSessions(): void {
  sessions.clear();
}

export function hasValidSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  return !!session && session.verified && session.token.length > 0;
}

export function getSessionCount(): number {
  return sessions.size;
}
