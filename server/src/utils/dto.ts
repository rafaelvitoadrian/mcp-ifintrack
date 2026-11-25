import type { Account, Category, Transaction } from "../types.js";
import { parseColumnarText, denormalizeRow, isColumnar } from "./encoding.js";

const first = <T>(...values: T[]): T | undefined =>
  values.find((value) => value !== null && value !== undefined);

function put(record: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) record[key] = value;
}

function normalizeId(record: Record<string, unknown>, ...values: unknown[]): void {
  const val = first(...values);
  if (val !== undefined) {
    const n = Number(val);
    record.id = Number.isFinite(n) && n > 0 ? n : val;
  }
}

function normalizeDate(
  record: Record<string, unknown>,
  key: string,
  ...values: unknown[]
): void {
  put(record, key, first(...values));
}

export function normalizeAccountDto(value: unknown): Account {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value as Account;
  }
  const raw = value as Record<string, unknown>;
  const lifecycle =
    ((raw.lifecycleEntity || raw.lifecycle) as Record<string, unknown>) || {};
  const activation =
    (lifecycle.activationType as Record<string, unknown>) || {};
  const record: Record<string, unknown> = { ...raw };

  normalizeId(
    record,
    raw.id,
    raw.ident,
    raw.identAkunKeuangan,
    lifecycle.identEntity,
  );
  put(record, "name", first(raw.name, raw.accountName, raw.namaAkun));
  put(
    record,
    "accountNumber",
    first(raw.accountNumber, raw.account_number, raw.nomorRekening),
  );
  put(record, "saldo", first(raw.saldo, raw.balance, raw.currentBalance));
  put(
    record,
    "identRevision",
    first(raw.identRevision, lifecycle.identRevision),
  );
  put(
    record,
    "identActivationType",
    first(
      raw.identActivationType,
      activation.identActivationType,
      activation.id,
      activation.ident,
    ),
  );
  normalizeDate(
    record,
    "createdDate",
    raw.createdDate,
    raw.createdAt,
    lifecycle.revisionEffectiveFrom,
    lifecycle.lastUpdateTime,
  );
  normalizeDate(
    record,
    "updatedDate",
    raw.updatedDate,
    raw.updatedAt,
    lifecycle.lastUpdateTime,
  );
  for (const key of [
    "identMaster",
    "identRevision",
    "revisionEffectiveFrom",
    "revisionEffectiveTo",
    "requestedActivationDate",
    "lastUpdateUser",
    "lastUpdateTime",
    "revisionState",
    "workflowStatus",
  ]) {
    if (record[key] === undefined && lifecycle[key] !== undefined) {
      record[key] = lifecycle[key];
    }
  }
  return record as Account;
}

export function normalizeCategoryDto(value: unknown): Category {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value as Category;
  }
  const raw = value as Record<string, unknown>;
  const record: Record<string, unknown> = { ...raw };
  normalizeId(raw && record, raw.id, raw.ident, raw.identCategory, raw.categoryId);
  put(
    record,
    "category_name",
    first(raw.category_name, raw.categoryName, raw.name, raw.namaKategori),
  );
  put(
    record,
    "category_type",
    first(raw.category_type, raw.categoryType, raw.direction, raw.type),
  );
  const account = first(raw.akunKeuangan, raw.account, raw.accountDto);
  if (account && typeof account === "object") {
    record.akunKeuangan = normalizeAccountDto(account);
  }
  normalizeDate(record, "createdDate", raw.createdDate, raw.createdAt);
  normalizeDate(record, "updatedDate", raw.updatedDate, raw.updatedAt);
  return record as Category;
}

function normalizeDirection(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  if (["CREDIT", "INCOME", "PEMASUKAN"].includes(normalized)) return 1;
  if (["DEBIT", "EXPENSE", "PENGELUARAN"].includes(normalized)) return 2;
  const num = Number(normalized);
  if (num === 1 || num === 2) return num;
  return value;
}

export function normalizeTransactionDto(value: unknown): Transaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value as Transaction;
  }
  const raw = value as Record<string, unknown>;
  const record: Record<string, unknown> = { ...raw };
  normalizeId(
    record,
    raw.id,
    raw.ident,
    raw.identTransaksi,
    raw.transactionId,
  );
  put(
    record,
    "name",
    first(
      raw.name,
      raw.transactionName,
      raw.transaksiName,
      raw.namaTransaksi,
    ),
  );
  put(
    record,
    "nominal",
    first(raw.nominal, raw.amount, raw.transactionAmount, raw.value),
  );
  put(
    record,
    "jenis",
    normalizeDirection(
      first(raw.jenis, raw.transactionType, raw.direction, raw.type),
    ),
  );
  normalizeDate(
    record,
    "transactionDate",
    raw.transactionDate,
    raw.transactionAt,
    raw.transactedAt,
    raw.date,
  );
  put(
    record,
    "idAkunKeuangan",
    first(raw.idAkunKeuangan, raw.accountId, raw.akunKeuanganId),
  );
  const category = first(raw.category, raw.kategori, raw.categoryDto);
  const categoryId = first(
    raw.categoryId,
    raw.idCategory,
    raw.idKategori,
    raw.identCategory,
  );
  if (category && typeof category === "object") {
    record.category = normalizeCategoryDto(category);
  } else if (categoryId !== undefined) {
    record.category = normalizeCategoryDto({
      id: categoryId,
      category_name: first(raw.categoryName, raw.namaKategori),
      category_type: first(raw.categoryType, raw.jenisKategori),
    });
  }
  normalizeDate(record, "createdDate", raw.createdDate, raw.createdAt);
  normalizeDate(record, "updatedDate", raw.updatedDate, raw.updatedAt);
  return record as Transaction;
}

export function financeRows<T = Record<string, unknown>>(response: unknown): T[] {
  if (!response) return [];
  const rows = Array.isArray(response)
    ? response
    : typeof response === "object" && response !== null
      ? (response as Record<string, unknown>).data
      : null;
  if (!Array.isArray(rows)) {
    throw new Error("Bentuk daftar dari backend tidak valid.");
  }
  return rows.filter((item): item is T => item !== null && item !== undefined);
}

export function financeRecord<T = Record<string, unknown>>(
  response: unknown,
): T | null {
  if (response === null || response === undefined || response === "") {
    return null;
  }
  if (
    typeof response === "object" &&
    !Array.isArray(response) &&
    Object.prototype.hasOwnProperty.call(response, "data")
  ) {
    const inner = (response as Record<string, unknown>).data;
    if (inner === null || inner === undefined || inner === "") return null;
    if (
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      Object.keys(inner as object).length === 0
    ) {
      return null;
    }
    return inner as T;
  }
  if (
    typeof response === "object" &&
    !Array.isArray(response) &&
    Object.keys(response as object).length === 0
  ) {
    return null;
  }
  return response as T;
}

export function rowsOf(data: unknown): Record<string, unknown>[] {
  if (data === null || data === undefined || data === "") return [];
  if (Array.isArray(data)) {
    return data
      .filter((d) => d !== null && d !== undefined)
      .map((item) => (isColumnar(item) ? denormalizeRow(item) : item));
  }
  if (typeof data === "string") return parseColumnarText(data);
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = ["data", "rows", "records", "content", "items", "result"];
    for (const k of keys) {
      if (Array.isArray(obj[k])) {
        return (obj[k] as unknown[])
          .filter((d): d is Record<string, unknown> => d !== null && d !== undefined)
          .map((item) => (isColumnar(item) ? denormalizeRow(item) : item));
      }
    }
    for (const k of keys) {
      if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) {
        const nested = rowsOf(obj[k]);
        if (nested.length) return nested;
      }
    }
    if (!Object.keys(obj).length) return [];
    return [obj];
  }
  return [];
}
