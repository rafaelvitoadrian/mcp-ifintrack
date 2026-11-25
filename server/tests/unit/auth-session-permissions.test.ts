import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSession,
  getSession,
  requireSession,
  setSessionPermissions,
  clearAllSessions,
} from "../../src/auth/session.js";
import { performLogin, parsePrincipalResponse } from "../../src/auth/login.js";
import {
  buildPermissionIndex,
  hasPermission,
  assertToolAccess,
} from "../../src/utils/permissions.js";
import type { PermissionProfile } from "../../src/types.js";

const SAMPLE_PROFILES: PermissionProfile[] = [
  {
    identPermissionProfile: 101,
    name: "AKN/OPERATOR1",
    activationStatus: "Active",
    userRoles: [
      {
        identUserRole: 10,
        shortname: "FIN_INIT",
        name: "Finance Initiator",
        activationStatus: "Active",
        userRoleFunctions: [
          {
            function: { identFunction: 1, functionName: "AkunKeuangan" },
            accessLevel: { identAccessLevel: 3, accessLevelName: "Initiate" },
          },
          {
            function: { identFunction: 2, functionName: "Category" },
            accessLevel: { identAccessLevel: 2, accessLevelName: "View" },
          },
          {
            function: { identFunction: 3, functionName: "Transaction" },
            accessLevel: { identAccessLevel: 2, accessLevelName: "View" },
          },
          {
            function: { identFunction: 9, functionName: "DailySchedule" },
            accessLevel: { identAccessLevel: 3, accessLevelName: "Initiate" },
          },
        ],
      },
      {
        identUserRole: 11,
        shortname: "INACTIVE_ROLE",
        name: "Disabled Admin",
        activationStatus: "InActive",
        userRoleFunctions: [
          {
            function: { identFunction: 9, functionName: "DailySchedule" },
            accessLevel: { identAccessLevel: 4, accessLevelName: "Approve" },
          },
        ],
      },
    ],
  },
];

describe("Auth, Session Isolation, and Permissions", () => {
  beforeEach(() => {
    clearAllSessions();
    vi.restoreAllMocks();
  });

  it("parses principal name from XML, plain text, and JSON responses", () => {
    expect(parsePrincipalResponse("<string>AG</string>")).toBe("AG");
    expect(parsePrincipalResponse("  vito@example.com \n")).toBe(
      "vito@example.com",
    );
    expect(parsePrincipalResponse('{"principal":"operator1"}')).toBe(
      "operator1",
    );
  });

  it("isolates sessions per sessionId and never shares tokens globally", () => {
    createSession("session-a", "https://host-a.example");
    createSession("session-b", "https://host-b.example");

    const sA = getSession("session-a")!;
    const sB = getSession("session-b")!;
    sA.token = "token-secret-a";
    sA.principal = "userA";
    sA.verified = true;
    setSessionPermissions("session-a", SAMPLE_PROFILES);

    sB.token = "token-secret-b";
    sB.principal = "userB";
    sB.verified = true;
    setSessionPermissions("session-b", []);

    expect(requireSession("session-a").token).toBe("token-secret-a");
    expect(requireSession("session-b").token).toBe("token-secret-b");
    expect(requireSession("session-a").principal).toBe("userA");
    expect(requireSession("session-b").principal).toBe("userB");

    // Session A has AkunKeuangan Initiate, Session B has no permissions
    expect(() =>
      assertToolAccess(requireSession("session-a"), "create_account"),
    ).not.toThrow();
    expect(() =>
      assertToolAccess(requireSession("session-b"), "list_accounts"),
    ).toThrow(/Izin ditolak/);
  });

  it("merges active roles by highest rank and ignores inactive roles/profiles", () => {
    const idx = buildPermissionIndex(SAMPLE_PROFILES);

    // AkunKeuangan has Initiate (rank 2) -> allows view and initiate, denies approve
    expect(hasPermission(idx, "akun", "view")).toBe(true);
    expect(hasPermission(idx, "akun", "initiate")).toBe(true);
    expect(hasPermission(idx, "akun", "approve")).toBe(false);

    // Category only has View (rank 1) -> denies initiate
    expect(hasPermission(idx, "kategori", "view")).toBe(true);
    expect(hasPermission(idx, "kategori", "initiate")).toBe(false);

    // DailySchedule has Initiate from active role; inactive role's Approve is ignored
    expect(hasPermission(idx, "dailyschedule", "initiate")).toBe(true);
    expect(hasPermission(idx, "dailyschedule", "approve")).toBe(false);
  });

  it("enforces special permissions for force_scheduled_event, replay_settlement, and get_spending_summary", () => {
    const s = createSession("session-1");
    s.token = "tok-1";
    s.verified = true;
    setSessionPermissions("session-1", SAMPLE_PROFILES);

    // get_spending_summary requires View on AkunKeuangan, Category, and Transaction -> all 3 present
    expect(() => assertToolAccess(s, "get_spending_summary")).not.toThrow();

    // trigger_scheduled_event requires DailySchedule Initiate -> allowed
    expect(() => assertToolAccess(s, "trigger_scheduled_event")).not.toThrow();

    // force_scheduled_event requires DailySchedule Approve -> denied!
    expect(() => assertToolAccess(s, "force_scheduled_event")).toThrow(
      /DailySchedule.*approve/i,
    );

    // replay_settlement requires Integration Initiate -> denied!
    expect(() => assertToolAccess(s, "replay_settlement")).toThrow(
      /Integration.*initiate/i,
    );
  });

  it("performs login flow: POST form-urlencoded loginv2 -> GET akunkeuangan/test -> GET fetchAuthorizedPermissionProfiles", async () => {
    const calls: Array<{ url: string; method: string; contentType?: string; body?: string }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method || "GET";
      const headers = (init?.headers as Record<string, string>) || {};
      calls.push({
        url,
        method,
        contentType: headers["Content-Type"],
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url.endsWith("/api/v1/user/loginv2")) {
        return new Response(JSON.stringify({ token: "jwt-secret-token-123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/akunkeuangan/test")) {
        expect(headers["Authorization"]).toBe("Bearer jwt-secret-token-123");
        return new Response("<string>AG</string>", {
          status: 200,
          headers: { "content-type": "text/xml" },
        });
      }
      if (url.endsWith("/api/v2/user/fetchAuthorizedPermissionProfiles")) {
        return new Response(JSON.stringify(SAMPLE_PROFILES), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v2/user")) {
        return new Response(
          JSON.stringify([
            {
              username: "AG",
              email: "ag@example.com",
              lifecycleEntity: { identEntity: 77 },
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const res = await performLogin(
      "login-test-session",
      "AG",
      "1234",
      "https://example.test",
    );

    expect(res.success).toBe(true);
    expect(res.principal).toBe("AG");
    expect(res.profileCount).toBe(1);
    // Login result must NOT contain token or password
    expect(JSON.stringify(res)).not.toContain("jwt-secret-token-123");
    expect(JSON.stringify(res)).not.toContain("1234");

    // Verify first call was form-urlencoded POST /api/v1/user/loginv2
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://example.test/api/v1/user/loginv2");
    expect(calls[0].contentType).toContain("application/x-www-form-urlencoded");
    expect(calls[0].body).toBe("email=AG&password=1234");
  });
});
