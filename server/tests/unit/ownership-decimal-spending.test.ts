import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSession,
  setSessionPermissions,
  clearAllSessions,
} from "../../src/auth/session.js";
import { dispatchToolCall } from "../../src/tools/registry.js";
import { money, sumDecimals, decimalText } from "../../src/utils/decimal.js";
import type { PermissionProfile } from "../../src/types.js";

const FULL_FINANCE_PROFILES: PermissionProfile[] = [
  {
    identPermissionProfile: 1,
    name: "AKN/AG",
    activationStatus: "Active",
    userRoles: [
      {
        identUserRole: 1,
        shortname: "FIN_ALL",
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
            function: { identFunction: 3, functionName: "Transaction" },
            accessLevel: { identAccessLevel: 3, accessLevelName: "Initiate" },
          },
        ],
      },
    ],
  },
];

function setupAuthenticatedSession(sessionId = "fin-session"): void {
  const s = createSession(sessionId, "https://finance.test");
  s.token = "valid-token";
  s.principal = "AG";
  s.username = "AG";
  s.verified = true;
  setSessionPermissions(sessionId, FULL_FINANCE_PROFILES);
}

describe("Account Ownership, Decimal Arithmetic, and Spending Summary Completeness", () => {
  beforeEach(() => {
    clearAllSessions();
    vi.restoreAllMocks();
    setupAuthenticatedSession();
  });

  it("performs exact decimal arithmetic without IEEE-754 floating-point drift", () => {
    const a = money("0.1");
    const b = money("0.2");
    expect(decimalText(a.plus(b))).toBe("0.3");

    const total = sumDecimals(["1250000.55", "3499999.45", "0.01"]);
    expect(decimalText(total)).toBe("4750000.01");

    // Rejects negative or >12 decimal places in money()
    expect(() => money("-50")).toThrow();
    expect(() => money("1.1234567890123")).toThrow();
  });

  it("enforces account ownership and rejects access to unowned account IDs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/akunkeuangan")) {
        return new Response(
          JSON.stringify({
            data: [{ id: 10, name: "Kas Utama", accountNumber: "AKN01001" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    // Account #99 is NOT in the user's owned accounts list ([#10])
    const res = await dispatchToolCall("fin-session", "get_account", {
      accountId: 99,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/bukan milik sesi/i);

    const catRes = await dispatchToolCall("fin-session", "list_categories", {
      accountId: 99,
    });
    expect(catRes.isError).toBe(true);
    expect(catRes.content[0].text).toMatch(/bukan milik sesi/i);
  });

  it("computes complete spending summary with Decimal, concrete period, and timezone", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/akunkeuangan")) {
        return new Response(
          JSON.stringify({
            data: [{ id: 10, name: "Kas Harian", accountNumber: "AKN01010" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/category/lists?idAkun=10")) {
        return new Response(
          JSON.stringify({
            IdAkun: 10,
            data: [
              { id: 1, category_name: "Gaji", category_type: 1 },
              { id: 2, category_name: "Konsumsi", category_type: 2 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/transaksikeuangan/lists?idAkun=10")) {
        return new Response(
          JSON.stringify({
            IdAkun: 10,
            data: [
              {
                id: 1001,
                idAkunKeuangan: 10,
                name: "Gaji Bulanan",
                nominal: "5000000.50",
                jenis: 1,
                transactionDate: "2026-10-05T09:00:00",
                category: { id: 1 },
              },
              {
                id: 1002,
                idAkunKeuangan: 10,
                name: "Makan Siang",
                nominal: "45000.25",
                jenis: 2,
                transactionDate: "2026-10-06T12:30:00",
                category: { id: 2 },
              },
              {
                id: 1003,
                idAkunKeuangan: 10,
                name: "Kopi",
                nominal: "25000.25",
                jenis: 2,
                transactionDate: "2026-10-07T15:00:00",
                category: { id: 2 },
              },
              {
                id: 1004,
                idAkunKeuangan: 10,
                name: "Transaksi Bulan Lalu (Di luar periode)",
                nominal: "999999",
                jenis: 2,
                transactionDate: "2026-09-30T23:59:59",
                category: { id: 2 },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const result = await dispatchToolCall(
      "fin-session",
      "get_spending_summary",
      {
        from: "2026-10-01",
        to: "2026-10-31",
      },
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.complete).toBe(true);
    expect(parsed.from).toBe("2026-10-01");
    expect(parsed.to).toBe("2026-10-31");
    expect(parsed.timezone).toBeTruthy();
    expect(parsed.transactionCount).toBe(3);
    expect(parsed.income).toBe("5000000.5");
    expect(parsed.expense).toBe("70000.5");
    expect(parsed.net).toBe("4930000");
    expect(parsed.topCategories).toEqual([
      { name: "Konsumsi", total: "70000.5", count: 2 },
    ]);
  });

  it("fails closed on partial account failure and refuses to claim subtotal as complete total", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/akunkeuangan")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 10, name: "Rekening A" },
              { id: 20, name: "Rekening B" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("idAkun=10")) {
        return new Response(JSON.stringify({ IdAkun: 10, data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("idAkun=20")) {
        return new Response(JSON.stringify({ message: "Database timeout" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const result = await dispatchToolCall(
      "fin-session",
      "get_spending_summary",
      {
        from: "2026-10-01",
        to: "2026-10-31",
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(
      /Gagal membaca 1 dari 2 rekening.*TIDAK dapat diklaim lengkap/i,
    );
  });
});
