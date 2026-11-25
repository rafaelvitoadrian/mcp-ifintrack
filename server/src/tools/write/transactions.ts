import { assertOwnedAccount } from "../../api/accounts.js";
import { listCategories } from "../../api/categories.js";
import {
  listTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
} from "../../api/transactions.js";
import { toTransactionDateTime } from "../../utils/payload.js";
import { formatIdr } from "../../utils/decimal.js";
import {
  validatePositiveInt,
  validateString,
  validateIsoDate,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type { Transaction, SessionData, ToolResult } from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

function validateAmount(value: unknown): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0) {
    throw new Error("Nominal transaksi harus angka non-negatif yang valid.");
  }
  return num;
}

export async function prepareCreateTransaction(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    values: {
      accountId: number;
      name: string;
      description: string | null;
      amount: number;
      type: number;
      date: string;
      categoryId: number | null;
      externalReference: string | null;
    };
  }>
> {
  const accountId = validatePositiveInt(domainArgs.accountId, "accountId");
  const name = validateString(domainArgs.name, "name", 120);
  const amount = validateAmount(domainArgs.amount);
  const type = validatePositiveInt(domainArgs.type, "type");
  if (![1, 2].includes(type)) {
    throw new Error("Jenis transaksi harus 1 (CREDIT / Pemasukan) atau 2 (DEBIT / Pengeluaran).");
  }
  const date = toTransactionDateTime(domainArgs.date);
  const description =
    domainArgs.description !== undefined &&
    domainArgs.description !== null &&
    String(domainArgs.description).trim() !== ""
      ? validateString(domainArgs.description, "description", 2000)
      : null;
  const categoryId =
    domainArgs.categoryId !== undefined && domainArgs.categoryId !== null
      ? validatePositiveInt(domainArgs.categoryId, "categoryId")
      : null;
  const externalReference =
    domainArgs.externalReference !== undefined &&
    domainArgs.externalReference !== null &&
    String(domainArgs.externalReference).trim() !== ""
      ? validateString(domainArgs.externalReference, "externalReference", 200)
      : null;

  const account = await assertOwnedAccount(
    session.token,
    accountId,
    session.target,
  );

  let categoryName = "Tanpa kategori";
  if (categoryId !== null) {
    const categories = await listCategories(
      session.token,
      accountId,
      session.target,
      false,
    );
    const category = categories.find((c) => Number(c.id) === categoryId);
    if (!category) {
      throw new Error(
        `Kategori #${categoryId} tidak ditemukan pada rekening #${accountId}.`,
      );
    }
    if (Number(category.category_type) !== type) {
      throw new Error("Arah kategori tidak sesuai dengan jenis transaksi.");
    }
    categoryName = String(category.category_name || `Kategori #${categoryId}`);
  }

  const values = {
    accountId,
    name,
    description,
    amount,
    type,
    date,
    categoryId,
    externalReference,
  };

  const entries: Array<[string, string]> = [
    [
      "Rekening",
      `${account.name || "Tanpa nama"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
    ],
    ["Nama transaksi", name],
    ["Nominal", formatIdr(amount)],
    ["Jenis", type === 1 ? "CREDIT / Pemasukan" : "DEBIT / Pengeluaran"],
    ["Tanggal", date.replace("T", " ")],
    ["Kategori", categoryName],
  ];
  if (description !== null) {
    entries.push(["Keterangan", description]);
  }
  if (externalReference !== null) {
    entries.push(["Referensi eksternal", externalReference]);
  }

  return {
    target: `account:${accountId}:transaction:new`,
    title: "Buat transaksi",
    scope: `create_transaction:${accountId}`,
    scopeLabel: `Buat transaksi pada ${account.name || "Rekening"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
    canonicalArgs: {
      accountId,
      name,
      ...(description !== null ? { description } : {}),
      amount,
      type,
      date,
      ...(categoryId !== null ? { categoryId } : {}),
      ...(externalReference !== null ? { externalReference } : {}),
    },
    changes: values,
    snapshot: { accountId, exists: false },
    entries,
    previous: [],
    context: { values },
  };
}

export async function handleCreateTransaction(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "accountId",
      "name",
      "description",
      "amount",
      "type",
      "date",
      "categoryId",
      "externalReference",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "create_transaction",
  );

  return runMutationTool(
    sessionId,
    "create_transaction",
    args,
    prepareCreateTransaction,
    async (session, prepared) => {
      const created = await createTransaction(
        session.token,
        prepared.context.values,
        session.target,
      );
      return {
        message: "Buat transaksi berhasil.",
        recordId: created.id ?? null,
        transaction: created,
      };
    },
    extraMeta,
  );
}

export async function prepareUpdateTransaction(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    transactionId: number;
    fresh: Transaction;
    values: {
      accountId: number;
      name: string;
      description: string | null;
      amount: number;
      type: number;
      date: string;
      categoryId: number | null;
    };
  }>
> {
  const accountId = validatePositiveInt(domainArgs.accountId, "accountId");
  let transactionId =
    domainArgs.transactionId !== undefined
      ? validatePositiveInt(domainArgs.transactionId, "transactionId")
      : undefined;
  const matchName =
    domainArgs.matchName !== undefined
      ? validateString(domainArgs.matchName, "matchName", 120)
      : undefined;
  const matchDate =
    domainArgs.matchDate !== undefined
      ? validateIsoDate(domainArgs.matchDate, "matchDate")
      : undefined;

  if (!transactionId && !matchName) {
    throw new Error(
      "Sebutkan transactionId atau matchName (nama transaksi lama) yang akan diedit.",
    );
  }

  const hasChanges = [
    "name",
    "description",
    "amount",
    "type",
    "date",
    "categoryId",
  ].some((k) => domainArgs[k] !== undefined);
  if (!hasChanges) {
    throw new Error("Sebutkan perubahan transaksi yang diinginkan.");
  }

  const account = await assertOwnedAccount(
    session.token,
    accountId,
    session.target,
  );

  if (!transactionId && matchName) {
    const allTx = await listTransactions(
      session.token,
      accountId,
      session.target,
      false,
    );
    if (allTx.length > 5000) {
      throw new Error(
        "Daftar transaksi terlalu besar untuk memastikan kecocokan nama. Gunakan transactionId secara eksplisit.",
      );
    }
    const matches = allTx.filter(
      (row) =>
        String(row.name || "")
          .trim()
          .toLocaleLowerCase("id-ID") === matchName.toLocaleLowerCase("id-ID") &&
        (!matchDate || String(row.transactionDate || "").startsWith(matchDate)),
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length > 1
          ? "Ada beberapa transaksi dengan nama tersebut. Sebutkan matchDate (YYYY-MM-DD) atau transactionId agar tidak salah mengedit."
          : "Nama transaksi tidak ditemukan pada rekening ini.",
      );
    }
    transactionId = validatePositiveInt(matches[0].id, "transactionId");
  }

  const fresh = await getTransaction(
    session.token,
    accountId,
    transactionId!,
    session.target,
    false,
  );

  const name =
    domainArgs.name !== undefined
      ? validateString(domainArgs.name, "name", 120)
      : String(fresh.name || "").trim();
  const description =
    domainArgs.description !== undefined
      ? domainArgs.description === null ||
        String(domainArgs.description).trim() === ""
        ? null
        : validateString(domainArgs.description, "description", 2000)
      : (fresh.description ?? null);
  const amount =
    domainArgs.amount !== undefined
      ? validateAmount(domainArgs.amount)
      : Number(fresh.nominal ?? 0);
  const type =
    domainArgs.type !== undefined
      ? validatePositiveInt(domainArgs.type, "type")
      : Number(fresh.jenis);
  if (![1, 2].includes(type)) {
    throw new Error("Jenis transaksi harus 1 (CREDIT) atau 2 (DEBIT).");
  }
  const date =
    domainArgs.date !== undefined
      ? toTransactionDateTime(domainArgs.date)
      : toTransactionDateTime(fresh.transactionDate);
  const categoryId =
    domainArgs.categoryId !== undefined
      ? domainArgs.categoryId === null
        ? null
        : validatePositiveInt(domainArgs.categoryId, "categoryId")
      : (fresh.category?.id !== undefined ? Number(fresh.category.id) : null);

  let categoryName = "Tanpa kategori";
  if (categoryId !== null) {
    const categories = await listCategories(
      session.token,
      accountId,
      session.target,
      false,
    );
    const category = categories.find((c) => Number(c.id) === categoryId);
    if (!category) {
      throw new Error(
        `Kategori #${categoryId} tidak ditemukan pada rekening #${accountId}.`,
      );
    }
    if (Number(category.category_type) !== type) {
      throw new Error("Arah kategori tidak sesuai jenis transaksi.");
    }
    categoryName = String(category.category_name || `Kategori #${categoryId}`);
  }

  const snapshot = {
    id: fresh.id,
    name: fresh.name,
    description: fresh.description ?? null,
    amount: fresh.nominal,
    type: fresh.jenis,
    date: fresh.transactionDate,
    categoryId: fresh.category?.id ?? null,
  };

  const values = {
    accountId,
    name,
    description,
    amount,
    type,
    date,
    categoryId,
  };

  return {
    target: `account:${accountId}:transaction:${transactionId}`,
    title: "Edit transaksi",
    scope: `update_transaction:${accountId}`,
    scopeLabel: `Edit transaksi pada ${account.name || "Rekening"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
    changes: {
      transactionId,
      ...values,
    },
    snapshot,
    entries: [
      [
        "Rekening",
        `${account.name || "Tanpa nama"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
      ],
      ["Nama transaksi", name],
      ["Nominal", formatIdr(amount)],
      ["Jenis", type === 1 ? "CREDIT / Pemasukan" : "DEBIT / Pengeluaran"],
      ["Tanggal", date.replace("T", " ")],
      ["Kategori", categoryName],
      ...(description !== null
        ? [["Keterangan", description] as [string, string]]
        : []),
    ],
    previous: [
      ["Nama", String(fresh.name || "")],
      ...(fresh.description
        ? [["Keterangan", String(fresh.description)] as [string, string]]
        : []),
      ["Nominal", formatIdr(Number(fresh.nominal ?? 0))],
      ["Jenis", Number(fresh.jenis) === 1 ? "CREDIT" : "DEBIT"],
      ["Tanggal", String(fresh.transactionDate || "")],
    ],
    context: { transactionId: transactionId!, fresh, values },
  };
}

export async function handleUpdateTransaction(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set([
      "accountId",
      "transactionId",
      "matchName",
      "matchDate",
      "name",
      "description",
      "amount",
      "type",
      "date",
      "categoryId",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "update_transaction",
  );

  return runMutationTool(
    sessionId,
    "update_transaction",
    args,
    prepareUpdateTransaction,
    async (session, prepared) => {
      const updated = await updateTransaction(
        session.token,
        prepared.context.transactionId,
        prepared.context.values,
        session.target,
      );
      return {
        message: "Edit transaksi berhasil.",
        recordId: updated.id ?? prepared.context.transactionId,
        transaction: updated,
      };
    },
    extraMeta,
  );
}
