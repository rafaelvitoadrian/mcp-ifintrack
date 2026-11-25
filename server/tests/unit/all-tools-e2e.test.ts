import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFinancialTrackerMcpServer } from "../../src/server.js";
import {
  createSession,
  setSessionPermissions,
  clearAllSessions,
} from "../../src/auth/session.js";
import { clearAllApprovals } from "../../src/approval/manager.js";
import type { PermissionProfile } from "../../src/types.js";

const ALL_GRANTS_PROFILES: PermissionProfile[] = [
  {
    identPermissionProfile: 1,
    name: "AKN/AG",
    activationStatus: "Active",
    userRoles: [
      {
        identUserRole: 1,
        shortname: "SUPER_ADMIN",
        name: "Super Admin",
        activationStatus: "Active",
        userRoleFunctions: [
          "AkunKeuangan",
          "Category",
          "Transaction",
          "Integration",
          "AuditTrail",
          "DailySchedule",
          "FileUpload",
          "UserAccount",
          "UserRoleManagement",
        ].map((fnName, idx) => ({
          function: { identFunction: idx + 1, functionName: fnName },
          accessLevel: { identAccessLevel: 4, accessLevelName: "Approve" },
        })),
      },
    ],
  },
];

describe("End-to-End MCP Protocol Verification of All 39 Registered Tools", () => {
  const sessionId = "e2e-mcp-session";
  let tmpUploadDir: string;

  beforeEach(async () => {
    clearAllSessions();
    clearAllApprovals();
    vi.restoreAllMocks();

    process.env.FINTRACK_API_BASE_URL = "https://backend.test";
    process.env.FINTRACK_SCHEDULE_BASE_URL = "https://schedule.test";
    process.env.TEST_NEW_USER_PWD = "SafeHostSecret#2026";

    tmpUploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "fintrack-upload-"));
    await fs.writeFile(path.join(tmpUploadDir, "batch.csv"), "id,amount\n1,5000\n");
    process.env.FINTRACK_UPLOAD_DIR = tmpUploadDir;

    const s = createSession(sessionId, "https://backend.test");
    s.token = "e2e-jwt-token";
    s.userId = 77;
    s.username = "AG";
    s.email = "ag@example.com";
    s.principal = "AG";
    s.verified = true;
    setSessionPermissions(sessionId, ALL_GRANTS_PROFILES);
  });

  afterEach(async () => {
    if (tmpUploadDir) {
      await fs.rm(tmpUploadDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("lists all 39 tools via MCP tools/list and executes read, preview, and approved write flows", async () => {
    // Comprehensive mock backend covering every endpoint in ENDPOINTS.md
    let userUpdated = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method || "GET";

      // 1. Accounts
      if (url.endsWith("/api/v1/akunkeuangan") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 10,
                name: "Kas Operasional",
                description: "Kas utama",
                accountNumber: "AKN01010",
                accountType: 1,
                saldo: 500000,
                lifecycleEntity: {
                  identEntity: 10,
                  identRevision: 20,
                  activationType: { identActivationType: 1 },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/akunkeuangan/10") && method === "GET") {
        return new Response(
          JSON.stringify({
            id: 10,
            name: "Kas Operasional",
            description: "Kas utama",
            accountNumber: "AKN01010",
            accountType: 1,
            saldo: 500000,
            lifecycleEntity: {
              identEntity: 10,
              identRevision: 20,
              activationType: { identActivationType: 1 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/akunkeuangan") && (method === "POST" || method === "PUT")) {
        return new Response(
          JSON.stringify({
            id: method === "POST" ? 11 : 10,
            name: "Kas Baru",
            lifecycleEntity: { identEntity: method === "POST" ? 11 : 10, identRevision: 21 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // 2. Categories
      if (url.includes("/api/v1/category/lists?idAkun=10")) {
        return new Response(
          JSON.stringify({
            IdAkun: 10,
            data: [
              {
                id: 2,
                category_name: "Makan",
                category_type: 2,
                akunKeuangan: { id: 10 },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/category/detail?idAkun=10&idC=2")) {
        return new Response(
          JSON.stringify({
            id: 2,
            category_name: "Makan",
            category_type: 2,
            akunKeuangan: { id: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/category") && (method === "POST" || method === "PUT")) {
        return new Response(
          JSON.stringify({ id: 2, category_name: "Konsumsi", category_type: 2 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // 3. Transactions
      if (url.includes("/api/v1/transaksikeuangan/lists?idAkun=10")) {
        return new Response(
          JSON.stringify({
            IdAkun: 10,
            data: [
              {
                id: 100,
                idAkunKeuangan: 10,
                name: "Makan Siang",
                nominal: "35000",
                jenis: 2,
                transactionDate: "2026-10-18T12:00:00",
                category: { id: 2, category_name: "Makan", category_type: 2 },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/transaksikeuangan/detail?idAkun=10&idTk=100")) {
        return new Response(
          JSON.stringify({
            IdAkun: 10,
            data: {
              id: 100,
              idAkunKeuangan: 10,
              name: "Makan Siang",
              nominal: "35000",
              jenis: 2,
              transactionDate: "2026-10-18T12:00:00",
              category: { id: 2, category_name: "Makan", category_type: 2 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/transaksikeuangan") && (method === "POST" || method === "PUT")) {
        return new Response(
          JSON.stringify({ id: 100, name: "Makan Siang", nominal: 40000, jenis: 2 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // 4. Users & Permissions
      if (url.endsWith("/api/v2/user") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: 77,
              name: "Operator AG",
              username: "AG",
              email: "ag@example.com",
              password: "secret",
              pwdHash: "hash",
              salt: "salt",
              lifecycleEntity: {
                identEntity: 77,
                identRevision: 80,
                activationType: { identActivationType: 1 },
              },
              permissionProfiles: [
                {
                  identPermissionProfile: 102,
                  individual: true,
                  name: "AKN/AG",
                  userAccount: { ident: 77 },
                  userRoles: [{ identUserRole: 1, shortname: "SUPER_ADMIN" }],
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/77") && method === "GET") {
        return new Response(
          JSON.stringify({
            id: 77,
            name: userUpdated ? "Operator AG Updated" : "Operator AG",
            username: "AG",
            email: "ag@example.com",
            password: "secret",
            lifecycleEntity: {
              identEntity: 77,
              identRevision: 80,
              activationType: { identActivationType: 1 },
            },
            permissionProfiles: [
              {
                identPermissionProfile: userUpdated ? 103 : 102,
                individual: true,
                name: "AKN/AG",
                userAccount: { ident: 77 },
                userRoles: [{ identUserRole: 1, shortname: "SUPER_ADMIN" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/88") && method === "GET") {
        // Future-ready revision for delete_user_revision test
        return new Response(
          JSON.stringify({
            id: 88,
            username: "TEMP_REV",
            email: "temp@example.com",
            lifecycleEntity: { identEntity: 88, identRevision: 88 },
            revisionState: { ready: true, name: "Ready" },
            revisionEffectiveFrom: null,
            revisionEffectiveTo: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/88") && method === "DELETE") {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v2/user") && method === "PUT") {
        userUpdated = true;
        return new Response(JSON.stringify({ id: 77 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v2/user/change-password") && method === "POST") {
        return new Response(JSON.stringify({ id: 77 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v2/user/fetchUserRoles") || url.includes("/api/v2/user/getUserRoles/")) {
        return new Response(
          JSON.stringify([
            {
              identUserRole: 1,
              shortname: "SUPER_ADMIN",
              name: "Super Admin",
              activationStatus: "Active",
              userRoleFunctions: [
                {
                  function: { identFunction: 1, functionName: "AkunKeuangan" },
                  accessLevel: { identAccessLevel: 2, accessLevelName: "View" },
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/getAccessLevels")) {
        return new Response(
          JSON.stringify([
            { identAccessLevel: 2, accessLevelName: "View" },
            { identAccessLevel: 3, accessLevelName: "Initiate" },
            { identAccessLevel: 4, accessLevelName: "Approve" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/getAuthLevels")) {
        return new Response(
          JSON.stringify([{ identAuthLevel: 1, authLevelName: "Level1" }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/getAllPermissionFunctions")) {
        return new Response(
          JSON.stringify([
            {
              function: {
                identFunction: 1,
                functionName: "AkunKeuangan",
                authLevel: { identAuthLevel: 1, authLevelName: "Level1" },
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v2/user/fetchAuthorizedPermissionProfiles")) {
        return new Response(JSON.stringify(ALL_GRANTS_PROFILES), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url.endsWith("/api/v2/user/create-user-role") ||
        url.endsWith("/api/v2/user/update-user-role")
      ) {
        return new Response(
          JSON.stringify({ identUserRole: 2, shortname: "NEW_ROLE", name: "New Role" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith("/api/v2/user/create-permission-profile") ||
        url.endsWith("/api/v2/user/update-permission-profile")
      ) {
        return new Response(
          JSON.stringify({ identPermissionProfile: 200, name: "SHARED_PROF" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // 5. Audit, Upload, Integration
      if (url.endsWith("/event/eventtypes")) {
        return new Response(JSON.stringify(["WEB_REQUEST", "SYSTEM_EVENT"]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/event/evententrynames")) {
        return new Response(JSON.stringify(["START", "STOP", "UPDATED"]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/event/events?")) {
        return new Response(
          JSON.stringify([
            {
              id: 901,
              eventType: "WEB_REQUEST",
              eventName: "LOGIN",
              userName: "AG",
              participantMainId: "AKN/AG",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/event/evententries?")) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: "UPDATED",
              entryData: 'UserPO[username=AG,password="hidden123"]',
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/fileupload/")) {
        return new Response(JSON.stringify({ filename: "batch.csv" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/integration")) {
        return new Response(JSON.stringify({ size: "2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // 6. Daily Schedule (Separate Host)
      if (url.endsWith("/dailyschedule/ping")) {
        return new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (url.includes("/dailyschedule/event/scheduled?")) {
        const text = [
          "Name=id;Type=4;Visibility=3\tName=name;Type=6;Visibility=3\tName=status;Type=6;Visibility=3\tName=business_service;Type=4;Visibility=3",
          "501\tEOD_RECONCILE\tAWAITING_TRIGGER\t1",
        ].join("\n");
        return new Response(text, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (url.endsWith("/dailyschedule/scheduledEvent/501")) {
        return new Response(
          JSON.stringify({
            id: 501,
            name: "EOD_RECONCILE",
            status: "AWAITING_TRIGGER",
            scheduledTime: "2026-10-18T17:00:00Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith("/dailyschedule/scheduledEvent/triggerEvent") ||
        url.endsWith("/dailyschedule/scheduledEvent/triggerEvent/forcedRun") ||
        url.endsWith("/dailyschedule/scheduledEvent/repeat")
      ) {
        return new Response(JSON.stringify({ status: "TRIGGERED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not Found: " + url, { status: 404 });
    });

    // Connect official MCP Client to our McpServer via InMemoryTransport
    const server = createFinancialTrackerMcpServer(sessionId);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-mcp-client", version: "1.0.0" });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // 1. Verify tools/list returns all 39 tools
    const { tools } = await client.listTools();
    expect(tools.length).toBe(39);

    // 2. Call every Read Tool via MCP Client
    const readCalls: Array<[string, Record<string, unknown>]> = [
      ["list_accounts", {}],
      ["get_account", { accountId: 10 }],
      ["list_categories", { accountId: 10 }],
      ["get_category", { accountId: 10, categoryId: 2 }],
      ["list_transactions", { accountId: 10, limit: 5 }],
      ["get_transaction", { accountId: 10, transactionId: 100 }],
      ["get_spending_summary", { from: "2026-10-01", to: "2026-10-31", accountId: 10 }],
      ["list_users", {}],
      ["get_user", { userId: 77 }],
      ["list_roles", {}],
      ["search_roles", { pattern: "SUPER" }],
      ["list_permission_functions", {}],
      ["list_access_levels", {}],
      ["list_auth_levels", {}],
      ["get_authorized_permission_profiles", {}],
      ["search_audit_events", { limit: 10 }],
      ["get_audit_entries", { eventId: 901, limit: 10 }],
      ["list_scheduled_events", { scheduleDay: "2026-10-18" }],
      ["get_scheduled_event", { eventId: 501 }],
    ];

    for (const [name, args] of readCalls) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError, `Read tool ${name} failed`).toBeFalsy();
    }

    // 3. Test Preview -> Execute via MCP Client for representative Write Tools across all domains
    const writeScenarios: Array<[string, Record<string, unknown>]> = [
      ["create_account", { name: "Kas Baru", accountType: 1 }],
      ["update_account", { accountId: 10, name: "Kas Operasional 2" }],
      ["create_category", { accountId: 10, name: "Transport", type: 2 }],
      ["update_category", { accountId: 10, categoryId: 2, name: "Konsumsi" }],
      [
        "create_transaction",
        {
          accountId: 10,
          name: "Beli Bensin",
          amount: 50000,
          type: 2,
          date: "2026-10-18T14:00:00",
          categoryId: 2,
        },
      ],
      [
        "update_transaction",
        { accountId: 10, transactionId: 100, amount: 40000 },
      ],
      ["update_user", { userId: 77, name: "Operator AG Updated" }],
      [
        "create_role",
        {
          shortname: "NEW_ROLE",
          name: "New Role",
          functions: [{ identFunction: 1, accessLevel: "View" }],
        },
      ],
      [
        "update_role",
        {
          roleId: 1,
          name: "Super Admin Updated",
          functions: [{ identFunction: 1, accessLevel: "Approve" }],
        },
      ],
      ["create_permission_profile", { name: "SHARED_PROF", roleIds: [1] }],
      [
        "update_permission_profile",
        { profileId: 1, name: "AKN/AG", roleIds: [1] },
      ],
      [
        "change_user_password",
        { userId: 77, passwordSecretEnv: "TEST_NEW_USER_PWD" },
      ],
      ["delete_user_revision", { revisionId: 88 }],
      ["upload_file", { fileName: "batch.csv", folder: "dashboard" }],
      ["replay_settlement", {}],
      ["trigger_scheduled_event", { eventId: 501 }],
      ["force_scheduled_event", { eventId: 501 }],
      [
        "repeat_scheduled_event",
        { eventId: 501, scheduledTime: "2026-10-18T18:00:00Z" },
      ],
    ];

    for (const [toolName, toolArgs] of writeScenarios) {
      // Phase 1: Prepare preview via prepare_action
      const prepRes = await client.callTool({
        name: "prepare_action",
        arguments: { tool: toolName, arguments: toolArgs },
      });
      expect(prepRes.isError, `Preview for ${toolName} failed`).toBeFalsy();
      const contentArr = prepRes.content as Array<{ type: string; text: string }>;
      const preview = JSON.parse(contentArr[0].text);
      expect(preview.status).toBe("PREVIEW_READY");

      // Phase 2: Execute with approval binding
      const execRes = await client.callTool({
        name: toolName,
        arguments: {
          ...toolArgs,
          action: "execute",
          approval: {
            requestId: preview.requestId,
            fingerprint: preview.fingerprint,
            expiresAt: preview.expiresAt,
          },
        },
      });
      const execContent = execRes.content as Array<{ type: string; text: string }>;
      expect(
        execRes.isError,
        `Execution for ${toolName} failed: ${execContent[0]?.text}`,
      ).toBeFalsy();
      const execData = JSON.parse(execContent[0].text);
      expect(execData.status).toBe("EXECUTED");
    }

    await client.close();
    await server.close();
  });
});
