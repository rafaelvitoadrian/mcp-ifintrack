/**
 * get_spending_summary tool.
 * Follows agent-service/src/tools.ts and CONTRACTS.md:
 * - Requires View permission on AkunKeuangan, Category, and Transaction.
 * - Uses high-precision Decimal.js (never floating point).
 * - Requires concrete date period (from, to in YYYY-MM-DD) and reports timezone & included accounts.
 * - Distinguishes transaction direction (jenis: 1=income, 2=expense) vs category report classification (category_type).
 * - Only claims `complete: true` when ALL required accounts, categories, and transactions are read without error.
 *   Never claims a partial subtotal as a complete total across accounts!
 */
import { listAccounts } from "../../api/accounts.js";
import { listCategories } from "../../api/categories.js";
import { listTransactions } from "../../api/transactions.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import { money, zero, decimalText } from "../../utils/decimal.js";
import {
  validatePositiveInt,
  validateIsoDate,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import { config } from "../../config.js";
import { ApiError } from "../../types.js";
import type { ToolResult } from "../../types.js";

export async function handleGetSpendingSummary(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["from", "to", "accountId"]),
    "get_spending_summary",
  );

  const from = validateIsoDate(args.from, "from");
  const to = validateIsoDate(args.to, "to");
  if (from > to) {
    throw new Error("Tanggal awal ('from') tidak boleh melewati tanggal akhir ('to').");
  }
  const requestedAccountId =
    args.accountId !== undefined
      ? validatePositiveInt(args.accountId, "accountId")
      : undefined;

  const session = requireSession(sessionId);
  assertToolAccess(session, "get_spending_summary");

  const ownedAccounts = await listAccounts(session.token, session.target);
  const targetAccounts = requestedAccountId
    ? ownedAccounts.filter((acc) => Number(acc.id) === requestedAccountId)
    : ownedAccounts;

  if (requestedAccountId && targetAccounts.length === 0) {
    throw new ApiError(
      403,
      `Rekening #${requestedAccountId} tidak ditemukan atau bukan milik sesi ini.`,
      { code: "ACCOUNT_FORBIDDEN" },
    );
  }

  if (targetAccounts.length > 20) {
    throw new Error(
      "Jumlah rekening melebihi batas analisis (maksimum 20 rekening sekaligus). Pilih satu accountId spesifik.",
    );
  }

  // Track both category-report classification (matching UI report) and raw transaction jenis direction
  let reportIncome = zero();
  let reportExpense = zero();
  let directionIncome = zero();
  let directionExpense = zero();
  let totalTransactionsInPeriod = 0;

  const expenseCategories = new Map<
    string,
    { total: ReturnType<typeof zero>; count: number }
  >();
  const accountSummaries: Array<{
    accountId: number;
    accountName: string;
    accountNumber: string | null;
    transactionCount: number;
    income: string;
    expense: string;
    net: string;
  }> = [];
  const failedAccounts: Array<{
    accountId: number;
    accountName: string;
    error: string;
  }> = [];

  for (const account of targetAccounts) {
    const accId = Number(account.id);
    const accName = String(account.name || `Rekening #${accId}`).slice(0, 120);

    let rows;
    let categories;
    try {
      [rows, categories] = await Promise.all([
        listTransactions(session.token, accId, session.target, false),
        listCategories(session.token, accId, session.target, false),
      ]);
    } catch (err) {
      failedAccounts.push({
        accountId: accId,
        accountName: accName,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const categoryMap = new Map(
      categories.map((cat) => [Number(cat.id), cat]),
    );

    let accIncome = zero();
    let accExpense = zero();
    let accCount = 0;

    for (const row of rows) {
      const day = String(row.transactionDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new Error(
          `Tanggal transaksi #${String(row.id)} pada rekening "${accName}" tidak valid ("${String(row.transactionDate)}"); total lengkap tidak dapat dipastikan.`,
        );
      }
      if (day < from || day > to) continue;

      const amount = money(row.nominal ?? 0);
      const rawJenis = Number(row.jenis);
      if (![1, 2].includes(rawJenis)) {
        throw new Error(
          `Arah jenis transaksi #${String(row.id)} tidak diketahui (${String(row.jenis)}); total tidak dapat dipastikan.`,
        );
      }

      if (rawJenis === 1) {
        directionIncome = directionIncome.plus(amount);
      } else {
        directionExpense = directionExpense.plus(amount);
      }

      const category = categoryMap.get(Number(row.category?.id));
      const categoryType = Number(category?.category_type);
      const effectiveReportType = [1, 2].includes(categoryType)
        ? categoryType
        : rawJenis;

      if (effectiveReportType === 1) {
        reportIncome = reportIncome.plus(amount);
        accIncome = accIncome.plus(amount);
      } else {
        reportExpense = reportExpense.plus(amount);
        accExpense = accExpense.plus(amount);
        const catName = String(
          category?.category_name || "Tanpa kategori",
        ).slice(0, 120);
        const current = expenseCategories.get(catName) || {
          total: zero(),
          count: 0,
        };
        current.total = current.total.plus(amount);
        current.count += 1;
        expenseCategories.set(catName, current);
      }

      accCount += 1;
      totalTransactionsInPeriod += 1;
      if (totalTransactionsInPeriod > 20_000) {
        throw new Error(
          "Jumlah transaksi dalam periode melewati batas analisis (20.000 transaksi). Persempit rentang tanggal atau pilih satu rekening.",
        );
      }
    }

    accountSummaries.push({
      accountId: accId,
      accountName: accName,
      accountNumber: account.accountNumber ?? null,
      transactionCount: accCount,
      income: decimalText(accIncome),
      expense: decimalText(accExpense),
      net: decimalText(accIncome.minus(accExpense)),
    });
  }

  // If ANY account failed to read, do NOT claim complete=true or present subtotal as full total!
  if (failedAccounts.length > 0) {
    throw new ApiError(
      502,
      `Gagal membaca ${failedAccounts.length} dari ${targetAccounts.length} rekening (${failedAccounts.map((f) => `${f.accountName}: ${f.error}`).join("; ")}). ` +
        `Total pengeluaran TIDAK dapat diklaim lengkap karena sebagian rekening gagal dibaca.`,
      {
        code: "PARTIAL_DATA_FAILURE",
        details: {
          complete: false,
          failedAccounts,
          readAccountsCount: accountSummaries.length,
          totalTargetAccounts: targetAccounts.length,
        },
      },
    );
  }

  const topCategories = [...expenseCategories.entries()]
    .sort((a, b) => b[1].total.comparedTo(a[1].total))
    .slice(0, 10)
    .map(([name, entry]) => ({
      name,
      total: decimalText(entry.total),
      count: entry.count,
    }));

  return formatToolResult(
    {
      from,
      to,
      timezone: config.timezone,
      currency: "IDR",
      complete: true,
      completenessStatus:
        "COMPLETE: Seluruh rekening, kategori, dan transaksi yang diotorisasi pada periode ini berhasil dibaca penuh.",
      accountsIncluded: accountSummaries,
      transactionCount: totalTransactionsInPeriod,
      income: decimalText(reportIncome),
      expense: decimalText(reportExpense),
      net: decimalText(reportIncome.minus(reportExpense)),
      byTransactionDirection: {
        creditIncome: decimalText(directionIncome),
        debitExpense: decimalText(directionExpense),
        net: decimalText(directionIncome.minus(directionExpense)),
      },
      topCategories,
    },
    { isUntrustedBackendData: true },
  );
}
