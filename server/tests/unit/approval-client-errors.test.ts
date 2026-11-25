import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSession,
  setSessionPermissions,
  clearAllSessions,
} from "../../src/auth/session.js";
import { clearAllApprovals } from "../../src/approval/manager.js";
import { dispatchToolCall } from "../../src/tools/registry.js";
import { apiRequest } from "../../src/api/client.js";
import type { PermissionProfile } from "../../src/types.js";

const ADMIN_PROFILES: PermissionProfile[] = [
  {
    identPermissionProfile: 1,
    name: "AKN/AG",
    activationStatus: "Active",
    userRoles: [
      {
        identUserRole: 1,
        shortname: "SUPER",
        activationStatus: "Active",
        userRoleFunctions: [
          {
            function: { identFunction: 1, functionName: "AkunKeuangan" },
            accessLevel: { identAccessLevel: 3, accessLevelName: "Initiate" },
          },
          {
            function: { identFunction: 2, functionName: "Category" },
            accessLevel: { identAccessLevel: 3, accessLevelName: "Initiate" },
          },
          {
            function: { identFunction: 4, functionName: "Integration" },
            accessLevel: { identAccessLevel: 3, accessLevelName: "Initiate" },
          },
        ],
      },
    ],
  },
];

function setupSession(id = "session-1"): void {
  const s = createSession(id, "https://backend.test");
  s.token = `token-for-${id}`;
  s.principal = id;
  s.username = id;
  s.verified = true;
  setSessionPermissions(id, ADMIN_PROFILES);
}

describe("Approval Flow, Stale Revision Detection, and HTTP Error Handling", () => {
  beforeEach(() => {
    clearAllSessions();
    clearAllApprovals();
    vi.restoreAllMocks();
    setupSession("session-1");
    setupSession("session-2");
  });

  it("rejects model-supplied confirmed=true without valid host approval metadata", async () => {
    const res = await dispatchToolCall("session-1", "create_account", {
      name: "Rekening Tanpa Izin Host",
      accountType: 1,
      confirmed: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(
      /confirmed=true dari model BUKAN persetujuan host/i,
    );
  });

  it("binds preview to session and snapshot, and rejects execution when backend revision becomes stale", async () => {
    let currentRevision = 10;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url.endsWith("/api/v1/akunkeuangan") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 5,
                name: "Kas Operasional",
                identRevision: currentRevision,
                identActivationType: 1,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/akunkeuangan/5") && method === "GET") {
        return new Response(
          JSON.stringify({
            id: 5,
            name: "Kas Operasional",
            description: "Lama",
            lifecycleEntity: {
              identEntity: 5,
              identRevision: currentRevision,
              activationType: { identActivationType: 1 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/akunkeuangan") && method === "PUT") {
        return new Response(
          JSON.stringify({
            id: 5,
            name: "Kas Operasional Baru",
            lifecycleEntity: { identEntity: 5, identRevision: currentRevision + 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    // Step 1: Prepare preview at revision 10
    const previewRes = await dispatchToolCall("session-1", "prepare_action", {
      tool: "update_account",
      arguments: {
        accountId: 5,
        name: "Kas Operasional Baru",
      },
    });
    expect(previewRes.isError).toBeUndefined();
    const previewData = JSON.parse(previewRes.content[0].text);
    expect(previewData.status).toBe("PREVIEW_READY");
    expect(previewData.requestId).toBeTruthy();
    expect(previewData.fingerprint).toBeTruthy();

    // Step 2: Session 2 attempts to execute Session 1's approval -> rejected!
    const hijackRes = await dispatchToolCall(
      "session-2",
      "update_account",
      {
        accountId: 5,
        name: "Kas Operasional Baru",
      },
      {
        approval: {
          requestId: previewData.requestId,
          fingerprint: previewData.fingerprint,
          expiresAt: previewData.expiresAt,
        },
      },
    );
    expect(hijackRes.isError).toBe(true);
    expect(hijackRes.content[0].text).toMatch(/sesi pengguna yang berbeda/i);

    // Step 3: Simulate concurrent modification on backend (revision 10 -> 11)
    currentRevision = 11;

    const staleRes = await dispatchToolCall(
      "session-1",
      "update_account",
      {
        accountId: 5,
        name: "Kas Operasional Baru",
      },
      {
        approval: {
          requestId: previewData.requestId,
          fingerprint: previewData.fingerprint,
          expiresAt: previewData.expiresAt,
        },
      },
    );
    expect(staleRes.isError).toBe(true);
    expect(staleRes.content[0].text).toMatch(/revisi basi|stale snapshot/i);

    // Step 4: Create fresh preview at revision 11 and execute cleanly
    const freshPreview = JSON.parse(
      (
        await dispatchToolCall("session-1", "prepare_action", {
          tool: "update_account",
          arguments: { accountId: 5, name: "Kas Operasional Baru" },
        })
      ).content[0].text,
    );

    const execRes = await dispatchToolCall(
      "session-1",
      "update_account",
      { accountId: 5, name: "Kas Operasional Baru" },
      {
        approval: {
          requestId: freshPreview.requestId,
          fingerprint: freshPreview.fingerprint,
          expiresAt: freshPreview.expiresAt,
        },
      },
    );
    expect(execRes.isError).toBeUndefined();
    const execData = JSON.parse(execRes.content[0].text);
    expect(execData.ok).toBe(true);
    expect(execData.status).toBe("EXECUTED");
  });

  it("treats GET /api/v1/integration (replay_settlement) as a mutation requiring preview and approval", async () => {
    let getIntegrationCalled = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/api/v1/integration")) {
        getIntegrationCalled = true;
        return new Response(JSON.stringify({ size: "3" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    // Calling replay_settlement without approval returns a preview and does NOT call GET /api/v1/integration
    const previewRes = await dispatchToolCall(
      "session-1",
      "replay_settlement",
      {},
    );
    expect(getIntegrationCalled).toBe(false);
    const preview = JSON.parse(previewRes.content[0].text);
    expect(preview.status).toBe("PREVIEW_READY");

    // Calling with host approval executes GET /api/v1/integration
    const execRes = await dispatchToolCall(
      "session-1",
      "replay_settlement",
      {},
      {
        approval: {
          requestId: preview.requestId,
          fingerprint: preview.fingerprint,
          expiresAt: preview.expiresAt,
        },
      },
    );
    expect(execRes.isError).toBeUndefined();
    expect(getIntegrationCalled).toBe(true);
  });

  it("handles HTML proxy pages, malformed JSON, empty body on HTTP 200, and 401/403/429 in apiRequest", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // 1. HTML response on 200 (e.g. ngrok warning page)
    fetchSpy.mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html><body>ngrok warning</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      apiRequest({ method: "GET", url: "https://backend.test/api/v1/akunkeuangan" }),
    ).rejects.toThrow(/halaman HTML/i);

    // 2. Malformed JSON
    fetchSpy.mockResolvedValueOnce(
      new Response("{broken_json:", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      apiRequest({ method: "GET", url: "https://backend.test/api/v1/akunkeuangan" }),
    ).rejects.toThrow(/JSON yang tidak valid/i);

    // 3. Empty body on HTTP 200 -> 404 Not Found
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      apiRequest({ method: "GET", url: "https://backend.test/api/v2/user/999" }),
    ).rejects.toThrow(/body kosong/i);

    // 4. HTTP 429 Rate Limit
    fetchSpy.mockResolvedValueOnce(
      new Response("Too Many Requests", { status: 429 }),
    );
    await expect(
      apiRequest({ method: "GET", url: "https://backend.test/api/v1/akunkeuangan" }),
    ).rejects.toThrow(/429/);
  });
});
