/**
 * Local Stdio Entry Point for MCP Financial Tracker Server.
 * Authenticates the local stdio session using host environment variables
 * (FINTRACK_EMAIL / FINTRACK_USERNAME + FINTRACK_PASSWORD, or FINTRACK_TOKEN)
 * so credentials never pass through the LLM conversation.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateConfig } from "./config.js";
import { createFinancialTrackerMcpServer } from "./server.js";
import { createSession } from "./auth/session.js";
import {
  performLogin,
  verifyAndInitializeSession,
} from "./auth/login.js";
import { redactStringSecrets } from "./utils/redact.js";

export const STDIO_SESSION_ID = "stdio-local-session";

export async function initializeStdioSession(): Promise<void> {
  createSession(STDIO_SESSION_ID);

  const token = process.env.FINTRACK_TOKEN?.trim();
  const email = (
    process.env.FINTRACK_EMAIL ||
    process.env.FINTRACK_USERNAME ||
    ""
  ).trim();
  const password = process.env.FINTRACK_PASSWORD || "";

  if (token) {
    const session = await verifyAndInitializeSession(
      STDIO_SESSION_ID,
      token,
      email || undefined,
    );
    console.error(
      `[fintrack-mcp] Stdio session verified via token for principal "${session.principal}" (${session.permissions.length} permission profiles).`,
    );
    return;
  }

  if (email && password) {
    const res = await performLogin(STDIO_SESSION_ID, email, password);
    if (!res.success) {
      throw new Error(res.message);
    }
    console.error(
      `[fintrack-mcp] Stdio session logged in as "${res.principal}" (${res.profileCount} permission profiles).`,
    );
    return;
  }

  console.error(
    "[fintrack-mcp] Warning: No FINTRACK_EMAIL/FINTRACK_PASSWORD or FINTRACK_TOKEN provided in environment. Tools requiring authentication will reject calls until authenticated.",
  );
}

async function main(): Promise<void> {
  validateConfig();
  await initializeStdioSession();

  const server = createFinancialTrackerMcpServer(STDIO_SESSION_ID);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[fintrack-mcp] MCP Financial Tracker Server running on stdio.");
}

// Run only when invoked directly as entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("index.ts"));

if (isMain) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[fintrack-mcp] Fatal startup error: ${redactStringSecrets(msg)}`,
    );
    process.exit(1);
  });
}
