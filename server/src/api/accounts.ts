import { config } from "../config.js";
import { authenticatedRequest } from "./client.js";
import {
  normalizeAccountDto,
  financeRows,
  financeRecord,
} from "../utils/dto.js";
import { akunCreate, akunUpdate } from "../utils/payload.js";
import { ApiError } from "../types.js";
import type { Account } from "../types.js";

const AKUN_LIST_500_HINT =
  "GET /api/v1/akunkeuangan membalas HTTP 500 untuk user ini. Gejala terverifikasi pada backend tertentu ketika user memiliki jumlah rekening besar (named query FIND_ALL_BY_EMAIL); setiap rekening masih dapat diambil lewat GET /api/v1/akunkeuangan/{id}.";

export async function listAccounts(
  token: string,
  targetUrl: string = config.apiBaseUrl,
): Promise<Account[]> {
  try {
    const res = await authenticatedRequest<unknown>(token, {
      method: "GET",
      url: `${targetUrl}/api/v1/akunkeuangan`,
      timeoutMs: config.requestTimeoutMs,
    });
    return financeRows(res).map(normalizeAccountDto);
  } catch (err) {
    if (err instanceof ApiError && err.status === 500 && !err.hint) {
      err.hint = AKUN_LIST_500_HINT;
    }
    throw err;
  }
}

/**
 * Verify that accountId belongs to the authenticated principal's account list.
 * Never trust accountId or owner passed by the model without verifying ownership.
 */
export async function assertOwnedAccount(
  token: string,
  accountId: number,
  targetUrl: string = config.apiBaseUrl,
): Promise<Account> {
  const accounts = await listAccounts(token, targetUrl);
  const owned = accounts.find((acc) => Number(acc.id) === Number(accountId));
  if (!owned) {
    throw new ApiError(
      403,
      `Rekening #${accountId} tidak ditemukan atau bukan milik sesi pengguna yang sedang login.`,
      { code: "ACCOUNT_FORBIDDEN" },
    );
  }
  return owned;
}

export async function getAccount(
  token: string,
  id: number,
  targetUrl: string = config.apiBaseUrl,
  verifyOwnership: boolean = true,
): Promise<Account> {
  if (verifyOwnership) {
    await assertOwnedAccount(token, id, targetUrl);
  }
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v1/akunkeuangan/${encodeURIComponent(String(id))}`,
    timeoutMs: config.requestTimeoutMs,
    emptyOn200AsNull: true,
  });
  const record = financeRecord(res);
  if (!record) {
    throw new ApiError(
      404,
      `Rekening #${id} tidak ditemukan (respons kosong dari backend).`,
      { code: "ACCOUNT_NOT_FOUND" },
    );
  }
  return normalizeAccountDto(record);
}

/**
 * Fetch fresh account record from backend — mandatory before any PUT /api/v1/akunkeuangan.
 */
export async function freshAccount(
  token: string,
  id: number,
  targetUrl: string = config.apiBaseUrl,
): Promise<Account> {
  return getAccount(token, id, targetUrl, true);
}

export async function createAccount(
  token: string,
  values: Parameters<typeof akunCreate>[0],
  targetUrl: string = config.apiBaseUrl,
): Promise<Account> {
  const payload = akunCreate(values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "POST",
    url: `${targetUrl}/api/v1/akunkeuangan`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeAccountDto(financeRecord(res) ?? res);
}

export async function updateAccount(
  token: string,
  latestRecord: Account,
  values: Parameters<typeof akunUpdate>[1],
  targetUrl: string = config.apiBaseUrl,
): Promise<Account> {
  const payload = akunUpdate(latestRecord, values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "PUT",
    url: `${targetUrl}/api/v1/akunkeuangan`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeAccountDto(financeRecord(res) ?? res);
}
