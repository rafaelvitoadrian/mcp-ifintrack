import { config } from "../config.js";
import { authenticatedRequest } from "./client.js";
import { assertOwnedAccount } from "./accounts.js";
import {
  normalizeTransactionDto,
  financeRows,
  financeRecord,
} from "../utils/dto.js";
import { transactionPayload } from "../utils/payload.js";
import { ApiError } from "../types.js";
import type { Transaction } from "../types.js";

export async function listTransactions(
  token: string,
  accountId: number,
  targetUrl: string = config.apiBaseUrl,
  verifyOwnership: boolean = true,
): Promise<Transaction[]> {
  if (verifyOwnership) {
    await assertOwnedAccount(token, accountId, targetUrl);
  }
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v1/transaksikeuangan/lists?idAkun=${encodeURIComponent(String(accountId))}`,
    timeoutMs: config.requestTimeoutMs,
  });
  const rows = financeRows(res).map(normalizeTransactionDto);
  if (rows.length > 10_000) {
    throw new ApiError(
      422,
      "Data transaksi melebihi batas baca aman (10.000 transaksi per rekening).",
      { code: "DATA_LIMIT" },
    );
  }
  // Fail closed if any returned transaction belongs to another account
  if (
    rows.some(
      (row) =>
        row.idAkunKeuangan !== undefined &&
        Number(row.idAkunKeuangan) !== Number(accountId),
    )
  ) {
    throw new ApiError(
      502,
      "Respons transaksi dari backend tidak sesuai dengan rekening yang diminta.",
      { code: "DATA_OWNERSHIP_MISMATCH" },
    );
  }
  return rows;
}

export async function getTransaction(
  token: string,
  accountId: number,
  transactionId: number,
  targetUrl: string = config.apiBaseUrl,
  verifyOwnership: boolean = true,
): Promise<Transaction> {
  if (verifyOwnership) {
    await assertOwnedAccount(token, accountId, targetUrl);
  }
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v1/transaksikeuangan/detail?idAkun=${encodeURIComponent(String(accountId))}&idTk=${encodeURIComponent(String(transactionId))}`,
    timeoutMs: config.requestTimeoutMs,
    emptyOn200AsNull: true,
  });
  const record = financeRecord(res);
  if (!record) {
    throw new ApiError(
      404,
      `Transaksi #${transactionId} pada rekening #${accountId} tidak ditemukan.`,
      { code: "TRANSACTION_NOT_FOUND" },
    );
  }
  const normalized = normalizeTransactionDto(record);
  if (
    normalized.idAkunKeuangan !== undefined &&
    Number(normalized.idAkunKeuangan) !== Number(accountId)
  ) {
    throw new ApiError(
      403,
      `Transaksi #${transactionId} bukan milik rekening #${accountId}.`,
      { code: "TRANSACTION_OWNERSHIP_MISMATCH" },
    );
  }
  return normalized;
}

export async function createTransaction(
  token: string,
  values: Parameters<typeof transactionPayload>[0],
  targetUrl: string = config.apiBaseUrl,
): Promise<Transaction> {
  const payload = transactionPayload(values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "POST",
    url: `${targetUrl}/api/v1/transaksikeuangan`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeTransactionDto(financeRecord(res) ?? res);
}

export async function updateTransaction(
  token: string,
  transactionId: number,
  values: Parameters<typeof transactionPayload>[0],
  targetUrl: string = config.apiBaseUrl,
): Promise<Transaction> {
  const payload = transactionPayload(values, transactionId);
  const res = await authenticatedRequest<unknown>(token, {
    method: "PUT",
    url: `${targetUrl}/api/v1/transaksikeuangan`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeTransactionDto(financeRecord(res) ?? res);
}
