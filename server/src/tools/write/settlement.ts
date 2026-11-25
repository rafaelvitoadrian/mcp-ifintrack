/**
 * Replay settlement tool: replay_settlement.
 * Follows ENDPOINTS.md, CONTRACTS.md, and src/services/config.js:
 * - GET /api/v1/integration is a MUTATION despite using HTTP GET!
 * - It resends/replays all unprocessed transactions to the settlement engine.
 * - Requires Bearer token (without token backend responds 403), `Integration: Initiate` permission,
 *   and explicit preview + host approval.
 */
import { config } from "../../config.js";
import { authenticatedRequest } from "../../api/client.js";
import { rejectUnknownFields } from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type { SessionData, ToolResult } from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

export async function prepareReplaySettlement(
  session: SessionData,
  _domainArgs: Record<string, unknown>,
): Promise<PreparedMutation<Record<string, never>>> {
  return {
    target: "integration:replay_settlement",
    title: "Replay settlement transaksi",
    scope: "replay_settlement:global",
    scopeLabel:
      "Kirim ulang (replay) seluruh transaksi yang belum diproses ke settlement engine",
    changes: {
      endpoint: "GET /api/v1/integration",
      effect:
        "Mengirim ulang seluruh transaksi yang belum masuk settlement engine via JMS.",
      initiatedBy: session.principal,
    },
    snapshot: {
      target: session.target,
      principal: session.principal,
    },
    entries: [
      ["Endpoint", "GET /api/v1/integration (Mutasi)"],
      [
        "Efek Samping",
        "Mengirim ulang seluruh transaksi yang belum diproses ke settlement engine",
      ],
      ["Operator", session.principal],
    ],
    previous: [],
    context: {},
  };
}

export async function handleReplaySettlement(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([...COMMON_APPROVAL_KEYS]),
    "replay_settlement",
  );

  return runMutationTool(
    sessionId,
    "replay_settlement",
    args,
    prepareReplaySettlement,
    async (session) => {
      const res = await authenticatedRequest<Record<string, unknown>>(
        session.token,
        {
          method: "GET",
          url: `${session.target}/api/v1/integration`,
          timeoutMs: config.writeTimeoutMs,
        },
      );
      return {
        message: "Replay settlement berhasil dijalankan.",
        result: res,
      };
    },
    extraMeta,
  );
}
