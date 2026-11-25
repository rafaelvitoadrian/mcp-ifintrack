/**
 * Decimal arithmetic helpers for financial calculations.
 * Matches agent-service/src/money.ts in original repo.
 */
import { Decimal } from "decimal.js";

const MoneyDecimal = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * Parse and validate a monetary nominal into a high-precision Decimal.
 * Rejects numbers that lost precision or negative/malformed strings.
 */
export function money(value: string | number): Decimal {
  if (value === null || value === undefined || value === "") {
    throw new Error("Nominal transaksi tidak boleh kosong.");
  }
  const text = String(value).trim();
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER ||
      text.replace(/[^0-9]/g, "").length > 15)
  ) {
    throw new Error(
      "Presisi nominal tidak dapat diverifikasi; backend perlu mengirim string desimal.",
    );
  }
  if (!/^\d+(?:\.\d{1,12})?$/.test(text) || text.length > 40) {
    throw new Error(
      "Nominal harus desimal non-negatif dengan maksimal 12 angka pecahan.",
    );
  }
  return new MoneyDecimal(text);
}

export const zero = (): Decimal => new MoneyDecimal(0);

export const decimalText = (value: Decimal): string => value.toFixed();

export function toDecimal(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Nominal bukan angka yang valid.");
    }
    return new MoneyDecimal(value);
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    if (cleaned === "" || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
      throw new Error(`Format nominal desimal tidak valid: "${value}"`);
    }
    return new MoneyDecimal(cleaned);
  }
  throw new Error(`Tipe nominal tidak didukung: ${typeof value}`);
}

export function sumDecimals(values: unknown[]): Decimal {
  return values.reduce<Decimal>(
    (acc, v) => acc.plus(toDecimal(v)),
    zero(),
  );
}

export function formatDecimal(d: Decimal, dp: number = 2): string {
  return d.toFixed(dp);
}

export function formatIdr(value: number | string | Decimal): string {
  const num =
    value instanceof Decimal ? value.toNumber() : Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);
}
