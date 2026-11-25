/**
 * Remote Streamable HTTP Server Transport with per-session authentication & isolation.
 * - Uses official StreamableHTTPServerTransport from @modelcontextprotocol/sdk.
 * - Enforces Origin check and per-session Bearer authentication (never shares a global token).
 * - Verifies principal (/api/v1/akunkeuangan/test) and loads permissions (/api/v2/user/fetchAuthorizedPermissionProfiles) per session.
 * - Binds each MCP session ID to the hash of its Bearer token so one user cannot hijack another user's session ID.
 */
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config, validateConfig } from "./config.js";
import { createFinancialTrackerMcpServer } from "./server.js";
import {
  performLogin,
  verifyAndInitializeSession,
} from "./auth/login.js";
import {
  getSession,
  deleteSession,
  hasValidSession,
} from "./auth/session.js";
import { approvePreview } from "./approval/manager.js";
import { redactStringSecrets } from "./utils/redact.js";

interface ManagedHttpSession {
  sessionId: string;
  tokenHash: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

const activeTransports = new Map<string, ManagedHttpSession>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser MCP clients may not send Origin

  const allowedEnv = (process.env.FINTRACK_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedEnv.includes(origin)) return true;

  const proto =
    req.secure || req.headers["x-forwarded-proto"] === "https"
      ? "https"
      : "http";
  const hostOrigin = `${proto}://${req.headers.host}`;
  return origin === hostOrigin;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!/^Bearer\s+/i.test(authHeader)) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

export function createHttpApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  // Origin protection middleware
  app.use((req: Request, res: Response, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isOriginAllowed(req)) {
      res.status(403).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Origin tidak diizinkan." },
      });
      return;
    }
    next();
  });

  /**
   * Host login endpoint (POST /auth/login)
   * Allows a host application to authenticate a user via form-urlencoded or JSON
   * and receive a verified MCP sessionId without exposing the raw backend token to the LLM.
   */
  app.post("/auth/login", async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || "").trim();
      const password = String(req.body?.password || "");
      if (!email || !password) {
        res.status(400).json({
          error: "Field email dan password wajib diisi.",
        });
        return;
      }
      const sessionId = randomUUID();
      const loginResult = await performLogin(sessionId, email, password);
      if (!loginResult.success) {
        deleteSession(sessionId);
        res.status(401).json({ error: loginResult.message });
        return;
      }
      res.status(200).json({
        ok: true,
        mcpSessionId: sessionId,
        principal: loginResult.principal,
        username: loginResult.username,
        userId: loginResult.userId,
        profileCount: loginResult.profileCount,
      });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 401
          : 500;
      const msg = err instanceof Error ? err.message : "Autentikasi gagal.";
      res.status(status).json({ error: redactStringSecrets(msg) });
    }
  });

  /**
   * Host logout / switch-account endpoint (POST /auth/logout)
   * Terminates an active MCP HTTP session so the host can switch to another user account cleanly.
   */
  app.post("/auth/logout", async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    const sessionId = String(
      req.headers["mcp-session-id"] || req.body?.sessionId || "",
    ).trim();

    if (!sessionId) {
      res.status(400).json({ error: "sessionId (atau header mcp-session-id) wajib diisi." });
      return;
    }

    const session = getSession(sessionId);
    if (session && token && hashToken(token) !== hashToken(session.token)) {
      res.status(403).json({ error: "Token tidak cocok dengan pemilik sesi." });
      return;
    }

    const managed = activeTransports.get(sessionId);
    if (managed) {
      await managed.transport.close().catch(() => {});
      activeTransports.delete(sessionId);
    }
    deleteSession(sessionId);
    res.status(200).json({ ok: true, message: "Sesi berhasil diakhiri. Silakan login ulang dengan akun baru." });
  });

  /**
   * Host approval endpoint (POST /auth/approve)
   * Allows the host UI to record user approval for a pending preview requestId.
   */
  app.post("/auth/approve", async (req: Request, res: Response) => {
    try {
      const token = extractBearerToken(req);
      const sessionId = String(
        req.headers["mcp-session-id"] || req.body?.sessionId || "",
      ).trim();
      const requestId = String(req.body?.requestId || "").trim();

      if (!sessionId || !requestId) {
        res.status(400).json({
          error: "sessionId (atau header mcp-session-id) dan requestId wajib diisi.",
        });
        return;
      }

      const session = getSession(sessionId);
      if (!session || !session.verified) {
        res.status(401).json({ error: "Sesi tidak ditemukan atau belum terverifikasi." });
        return;
      }
      if (token && hashToken(token) !== hashToken(session.token)) {
        res.status(403).json({ error: "Token tidak cocok dengan pemilik sesi." });
        return;
      }

      const approved = approvePreview(requestId, sessionId, session.principal);
      res.status(200).json({
        ok: true,
        requestId: approved.requestId,
        fingerprint: approved.fingerprint,
        expiresAt: approved.expiresAt,
        approvedAt: approved.approvedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menyetujui preview.";
      res.status(400).json({ error: redactStringSecrets(msg) });
    }
  });

  /**
   * MCP Streamable HTTP Endpoint (/mcp)
   * Requires Bearer token authentication (or a pre-authenticated host mcp-session-id).
   */
  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const token = extractBearerToken(req);
      const headerSessionId = String(
        req.headers["mcp-session-id"] || "",
      ).trim();

      if (!token) {
        res.status(401).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32001,
            message: "Header Authorization: Bearer <token> wajib disertakan.",
          },
        });
        return;
      }

      const callerTokenHash = hashToken(token);

      // Existing session lookup
      if (headerSessionId && activeTransports.has(headerSessionId)) {
        const managed = activeTransports.get(headerSessionId)!;
        // Enforce session isolation: prevent another user/token from using this sessionId
        if (managed.tokenHash !== callerTokenHash) {
          res.status(403).json({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32003,
              message: "Sesi MCP ini milik pengguna yang berbeda.",
            },
          });
          return;
        }
        await managed.transport.handleRequest(req, res, req.body);
        return;
      }

      // New session initialization requires POST
      if (req.method !== "POST") {
        res.status(405).setHeader("Allow", "POST").json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32000,
            message: "Inisialisasi sesi MCP baru harus menggunakan HTTP POST.",
          },
        });
        return;
      }

      const newSessionId = headerSessionId || randomUUID();
      if (!hasValidSession(newSessionId)) {
        await verifyAndInitializeSession(newSessionId, token);
      } else {
        const existingSession = getSession(newSessionId)!;
        if (hashToken(existingSession.token) !== callerTokenHash) {
          res.status(403).json({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32003,
              message: "Token tidak cocok dengan sesi yang dipilih.",
            },
          });
          return;
        }
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });
      const mcpServer = createFinancialTrackerMcpServer(newSessionId);

      transport.onclose = () => {
        activeTransports.delete(newSessionId);
        deleteSession(newSessionId);
      };

      activeTransports.set(newSessionId, {
        sessionId: newSessionId,
        tokenHash: callerTokenHash,
        transport,
        server: mcpServer,
        createdAt: Date.now(),
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 401
          : 500;
      const msg =
        err instanceof Error
          ? redactStringSecrets(err.message)
          : "Internal server error";
      if (!res.headersSent) {
        res.status(status === 401 || status === 403 ? status : 500).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: msg },
        });
      }
    }
  });

  return app;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("http-server.js") ||
    process.argv[1].endsWith("http-server.ts"));

if (isMain) {
  validateConfig();
  const app = createHttpApp();
  app.listen(config.port, () => {
    console.error(
      `[fintrack-mcp] Streamable HTTP MCP Server listening on port ${config.port}`,
    );
  });
}
