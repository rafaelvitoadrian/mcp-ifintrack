import { listTransactions, getTransaction } from "../../api/transactions.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import { money, decimalText } from "../../utils/decimal.js";
import {
  validatePositiveInt,
  validateNonNegativeInt,
  validateIsoDate,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import { config } from "../../config.js";
import type { ToolResult } from "../../types.js";

export async function handleListTransactions(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["accountId", "from", "to", "offset", "limit"]),
    "list_transactions",
  );
  const accountId = validatePositiveInt(args.accountId, "accountId");
  const from =
    args.from !== undefined ? validateIsoDate(args.from, "from") : undefined;
  const to = args.to !== undefined ? validateIsoDate(args.to, "to") : undefined;
  if (from && to && from > to) {
    throw new Error("Tanggal 'from' tidak boleh melewati tanggal 'to'.");
  }

  const offset =
    args.offset !== undefined
      ? validateNonNegativeInt(args.offset, "offset")
      : 0;
  const limit =
    args.limit !== undefined ? validatePositiveInt(args.limit, "limit") : 25;
  if (limit > 100) {
    throw new Error("Limit paginasi output maksimum adalah 100 item per halaman.");
  }

  const session = requireSession(sessionId);
  assertToolAccess(session, "list_transactions");

  // Fetch full list from backend for this owned account (backend does not support server-side pagination)
  const allRows = await listTransactions(
    session.token,
    accountId,
    session.target,
    true,
  );

  const filtered = allRows
    .filter((row) => {
      const day = String(row.transactionDate || "").slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    })
    .sort(
      (a, b) =>
        String(b.transactionDate || "").localeCompare(
          String(a.transactionDate || ""),
        ) || Number(b.id || 0) - Number(a.id || 0),
    );

  const pageItems = filtered.slice(offset, offset + limit).map((row) => {
    let formattedAmount = String(row.nominal ?? 0);
    try {
      formattedAmount = decimalText(money(row.nominal ?? 0));
    } catch {
      formattedAmount = String(row.nominal ?? 0);
    }
    return {
      id: row.id,
      accountId: row.idAkunKeuangan ?? accountId,
      name: String(row.name || "").slice(0, 200),
      description: row.description
        ? String(row.description).slice(0, 500)
        : null,
      amount: formattedAmount,
      jenis: Number(row.jenis),
      direction:
        Number(row.jenis) === 1
          ? "income"
          : Number(row.jenis) === 2
            ? "expense"
            : "unknown",
      transactionDate: row.transactionDate ?? null,
      category: row.category
        ? {
            id: row.category.id,
            name: row.category.category_name,
            type: row.category.category_type,
          }
        : null,
      externalReference: row.externalreference ?? null,
      internalReference: row.internalreference ?? null,
    };
  });

  const nextOffset =
    offset + limit < filtered.length ? offset + limit : null;

  return formatToolResult(
    {
      accountId,
      period: {
        from: from ?? null,
        to: to ?? null,
        timezone: config.timezone,
      },
      currency: "IDR",
      totalMatchingTransactions: filtered.length,
      totalAccountTransactions: allRows.length,
      offset,
      limit,
      nextOffset,
      paginationNote:
        "Paginasi ini adalah paginasi output tool MCP setelah mengunduh seluruh array transaksi rekening dari backend. Jangan menjumlahkan sampel halaman ini untuk mengklaim total pengeluaran; gunakan get_spending_summary.",
      items: pageItems,
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleGetTransaction(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["accountId", "transactionId"]),
    "get_transaction",
  );
  const accountId = validatePositiveInt(args.accountId, "accountId");
  const transactionId = validatePositiveInt(
    args.transactionId,
    "transactionId",
  );

  const session = requireSession(sessionId);
  assertToolAccess(session, "get_transaction");

  const tx = await getTransaction(
    session.token,
    accountId,
    transactionId,
    session.target,
    true,
  );

  let formattedAmount = String(tx.nominal ?? 0);
  try {
    formattedAmount = decimalText(money(tx.nominal ?? 0));
  } catch {
    formattedAmount = String(tx.nominal ?? 0);
  }

  return formatToolResult(
    {
      transaction: {
        id: tx.id,
        accountId: tx.idAkunKeuangan ?? accountId,
        name: tx.name,
        description: tx.description ?? null,
        amount: formattedAmount,
        jenis: Number(tx.jenis),
        direction:
          Number(tx.jenis) === 1
            ? "income"
            : Number(tx.jenis) === 2
              ? "expense"
              : "unknown",
        transactionDate: tx.transactionDate ?? null,
        category: tx.category
          ? {
              id: tx.category.id,
              name: tx.category.category_name,
              type: tx.category.category_type,
            }
          : null,
        externalReference: tx.externalreference ?? null,
        internalReference: tx.internalreference ?? null,
        createdDate: tx.createdDate ?? null,
        updatedDate: tx.updatedDate ?? null,
      },
    },
    { isUntrustedBackendData: true },
  );
}
