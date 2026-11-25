/**
 * Comprehensive Opt-in Live Read-Only & Preview Integration Test against real backend.
 * Run with: FINTRACK_RUN_LIVE_TESTS=true npx vitest run tests/integration/live.test.ts
 *
 * Strictly READ-ONLY (no POST/PUT/DELETE mutations are executed against the backend):
 * - Tests full login flow (POST /api/v1/user/loginv2 -> GET /api/v1/akunkeuangan/test -> GET /api/v2/user/fetchAuthorizedPermissionProfiles)
 * - Tests authorized Read Tools and `prepare_action` previews against the live backend (`https://dev-ifintrack.rafaelvito.online`)
 * - Verifies that tools outside the logged-in user's permission profile are strictly blocked by server-side permission checks
 */
import { describe, it, expect } from "vitest";
import { performLogin } from "../../src/auth/login.js";
import { getSession } from "../../src/auth/session.js";
import { hasPermission } from "../../src/utils/permissions.js";
import { dispatchToolCall } from "../../src/tools/registry.js";

const RUN_LIVE = process.env.FINTRACK_RUN_LIVE_TESTS === "true";
const LIVE_URL =
  process.env.FINTRACK_API_BASE_URL ||
  "https://dev-ifintrack.rafaelvito.online";
const LIVE_USER = process.env.FINTRACK_EMAIL || "AG";
const LIVE_PASS = process.env.FINTRACK_PASSWORD || "1234";

describe.skipIf(!RUN_LIVE)("Comprehensive Live Read-Only & Preview Verification", () => {
  const sessionId = "live-comprehensive-session";

  it("verifies login, permissions enforcement, authorized read tools, and preview generation on live backend", async () => {
    // 1. Login & Verify Principal + Permissions
    const loginRes = await performLogin(
      sessionId,
      LIVE_USER,
      LIVE_PASS,
      LIVE_URL,
    );
    expect(loginRes.success).toBe(true);
    const session = getSession(sessionId)!;
    console.log(
      "[LIVE] Principal:",
      session.principal,
      "| UserId:",
      session.userId,
      "| Username:",
      session.username,
    );
    console.log(
      "[LIVE] Effective Permission Index:",
      JSON.stringify(session.permissionIndex),
    );

    // 2. get_authorized_permission_profiles (always allowed for own session)
    const profilesRes = await dispatchToolCall(
      sessionId,
      "get_authorized_permission_profiles",
      {},
    );
    expect(profilesRes.isError).toBeUndefined();
    const profilesData = JSON.parse(profilesRes.content[0].text);
    console.log(
      "[LIVE] get_authorized_permission_profiles count:",
      profilesData.count,
    );
    expect(profilesData.count).toBeGreaterThan(0);

    // 3. list_accounts & get_spending_summary
    if (hasPermission(session.permissionIndex, "akun", "view")) {
      const accountsRes = await dispatchToolCall(
        sessionId,
        "list_accounts",
        {},
      );
      expect(accountsRes.isError).toBeUndefined();
      const accountsData = JSON.parse(accountsRes.content[0].text);
      console.log("[LIVE] list_accounts count:", accountsData.count);
      expect(Array.isArray(accountsData.accounts)).toBe(true);

      if (accountsData.accounts.length > 0) {
        const sampleAccountId = Number(accountsData.accounts[0].id);
        const accDetailRes = await dispatchToolCall(sessionId, "get_account", {
          accountId: sampleAccountId,
        });
        expect(accDetailRes.isError).toBeUndefined();

        if (hasPermission(session.permissionIndex, "kategori", "view")) {
          const catsRes = await dispatchToolCall(sessionId, "list_categories", {
            accountId: sampleAccountId,
          });
          expect(catsRes.isError).toBeUndefined();
        }

        if (hasPermission(session.permissionIndex, "transaksi", "view")) {
          const txRes = await dispatchToolCall(sessionId, "list_transactions", {
            accountId: sampleAccountId,
            limit: 10,
          });
          expect(txRes.isError).toBeUndefined();
        }
      }

      // get_spending_summary across all owned accounts
      if (
        hasPermission(session.permissionIndex, "kategori", "view") &&
        hasPermission(session.permissionIndex, "transaksi", "view")
      ) {
        const summaryRes = await dispatchToolCall(
          sessionId,
          "get_spending_summary",
          {
            from: "2026-01-01",
            to: "2026-12-31",
          },
        );
        expect(summaryRes.isError).toBeUndefined();
        const summaryData = JSON.parse(summaryRes.content[0].text);
        console.log(
          "[LIVE] get_spending_summary:",
          `txCount=${summaryData.transactionCount}, income=${summaryData.income}, expense=${summaryData.expense}, net=${summaryData.net}, complete=${summaryData.complete}`,
        );
        expect(summaryData.complete).toBe(true);
      }
    }

    // 4. Test Safe Preview Generation (prepare_action) on Live Session (NO write executed!)
    if (hasPermission(session.permissionIndex, "akun", "initiate")) {
      const previewCreateAcc = await dispatchToolCall(
        sessionId,
        "prepare_action",
        {
          tool: "create_account",
          arguments: {
            name: "Rekening Uji Preview (Tidak Disimpan)",
            accountType: 1,
          },
        },
      );
      expect(previewCreateAcc.isError).toBeUndefined();
      const previewData = JSON.parse(previewCreateAcc.content[0].text);
      console.log(
        "[LIVE] prepare_action(create_account) preview:",
        previewData.status,
        "| requestId:",
        previewData.requestId,
        "| fingerprint:",
        previewData.fingerprint.slice(0, 16) + "...",
      );
      expect(previewData.status).toBe("PREVIEW_READY");
      expect(previewData.requiresHostApproval).toBe(true);
    }

    // 5. Users, Roles, and Audit tools: verify execution if permitted, or strict 403 rejection if not in user's profile
    const conditionalChecks: Array<{
      tool: string;
      menu: string;
      args: Record<string, unknown>;
    }> = [
      { tool: "list_users", menu: "users", args: {} },
      { tool: "list_roles", menu: "userroles", args: {} },
      { tool: "list_access_levels", menu: "userroles", args: {} },
      { tool: "search_audit_events", menu: "audit", args: { limit: 5 } },
    ];

    for (const check of conditionalChecks) {
      const res = await dispatchToolCall(sessionId, check.tool, check.args);
      if (hasPermission(session.permissionIndex, check.menu, "view")) {
        expect(res.isError).toBeUndefined();
        console.log(`[LIVE] ${check.tool}: PERMITTED & OK`);
      } else {
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/Izin ditolak/i);
        console.log(
          `[LIVE] ${check.tool}: STRICTLY BLOCKED (user "${session.principal}" does not have "${check.menu}" grant in profile)`,
        );
      }
    }
  }, 90000);
});
