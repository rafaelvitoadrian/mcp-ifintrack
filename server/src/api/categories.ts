import { config } from "../config.js";
import { authenticatedRequest } from "./client.js";
import { assertOwnedAccount } from "./accounts.js";
import {
  normalizeCategoryDto,
  financeRows,
  financeRecord,
} from "../utils/dto.js";
import {
  categoryCreatePayload,
  categoryUpdatePayload,
} from "../utils/payload.js";
import { ApiError } from "../types.js";
import type { Category } from "../types.js";

export async function listCategories(
  token: string,
  accountId: number,
  targetUrl: string = config.apiBaseUrl,
  verifyOwnership: boolean = true,
): Promise<Category[]> {
  if (verifyOwnership) {
    await assertOwnedAccount(token, accountId, targetUrl);
  }
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v1/category/lists?idAkun=${encodeURIComponent(String(accountId))}`,
    timeoutMs: config.requestTimeoutMs,
  });
  const rows = financeRows(res).map(normalizeCategoryDto);
  return rows.filter((row) => {
    const owner = row.akunKeuangan?.id ?? row.idAkunKeuangan;
    return owner == null || Number(owner) === Number(accountId);
  });
}

export async function getCategory(
  token: string,
  accountId: number,
  categoryId: number,
  targetUrl: string = config.apiBaseUrl,
  verifyOwnership: boolean = true,
): Promise<Category> {
  if (verifyOwnership) {
    await assertOwnedAccount(token, accountId, targetUrl);
  }
  const res = await authenticatedRequest<unknown>(token, {
    method: "GET",
    url: `${targetUrl}/api/v1/category/detail?idAkun=${encodeURIComponent(String(accountId))}&idC=${encodeURIComponent(String(categoryId))}`,
    timeoutMs: config.requestTimeoutMs,
    emptyOn200AsNull: true,
  });
  const record = financeRecord(res);
  if (!record) {
    throw new ApiError(
      404,
      `Kategori #${categoryId} pada rekening #${accountId} tidak ditemukan.`,
      { code: "CATEGORY_NOT_FOUND" },
    );
  }
  const normalized = normalizeCategoryDto(record);
  const owner = normalized.akunKeuangan?.id ?? normalized.idAkunKeuangan;
  if (owner != null && Number(owner) !== Number(accountId)) {
    throw new ApiError(
      403,
      `Kategori #${categoryId} bukan milik rekening #${accountId}.`,
      { code: "CATEGORY_OWNERSHIP_MISMATCH" },
    );
  }
  return normalized;
}

export async function createCategory(
  token: string,
  values: { accountId: number; name: string; type: number },
  targetUrl: string = config.apiBaseUrl,
): Promise<Category> {
  const payload = categoryCreatePayload(values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "POST",
    url: `${targetUrl}/api/v1/category`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeCategoryDto(financeRecord(res) ?? res);
}

export async function updateCategory(
  token: string,
  existing: { id: number; category_type: number },
  values: { accountId: number; categoryId: number; name: string },
  targetUrl: string = config.apiBaseUrl,
): Promise<Category> {
  const payload = categoryUpdatePayload(existing, values);
  const res = await authenticatedRequest<unknown>(token, {
    method: "PUT",
    url: `${targetUrl}/api/v1/category`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: config.writeTimeoutMs,
  });
  return normalizeCategoryDto(financeRecord(res) ?? res);
}
