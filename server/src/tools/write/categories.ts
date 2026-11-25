import { assertOwnedAccount } from "../../api/accounts.js";
import {
  listCategories,
  createCategory,
  updateCategory,
} from "../../api/categories.js";
import {
  validatePositiveInt,
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type { Category, SessionData, ToolResult } from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

export async function prepareCreateCategory(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    values: { accountId: number; name: string; type: number };
  }>
> {
  const accountId = validatePositiveInt(domainArgs.accountId, "accountId");
  const name = validateString(domainArgs.name, "name", 120);
  const type = validatePositiveInt(domainArgs.type, "type");
  if (![1, 2].includes(type)) {
    throw new Error("Tipe kategori harus 1 (CREDIT / Pemasukan) atau 2 (DEBIT / Pengeluaran).");
  }

  const account = await assertOwnedAccount(
    session.token,
    accountId,
    session.target,
  );

  const values = { accountId, name, type };
  const directionLabel =
    type === 1 ? "CREDIT / Pemasukan" : "DEBIT / Pengeluaran";

  return {
    target: `account:${accountId}:category:new`,
    title: "Buat kategori",
    scope: `create_category:${accountId}`,
    scopeLabel: `Buat kategori pada ${account.name || "Rekening"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
    canonicalArgs: values,
    changes: {
      accountId,
      category_name: name,
      category_type: type,
      direction: directionLabel,
    },
    snapshot: { accountId, exists: false },
    entries: [
      [
        "Rekening",
        `${account.name || "Tanpa nama"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
      ],
      ["Nama kategori", name],
      ["Arah", directionLabel],
    ],
    previous: [],
    context: { values },
  };
}

export async function handleCreateCategory(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["accountId", "name", "type", ...COMMON_APPROVAL_KEYS]),
    "create_category",
  );

  return runMutationTool(
    sessionId,
    "create_category",
    args,
    prepareCreateCategory,
    async (session, prepared) => {
      const created = await createCategory(
        session.token,
        prepared.context.values,
        session.target,
      );
      return {
        message: "Buat kategori berhasil.",
        recordId: created.id ?? null,
        category: created,
      };
    },
    extraMeta,
  );
}

export async function prepareUpdateCategory(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    existing: Category;
    values: { accountId: number; categoryId: number; name: string };
  }>
> {
  const accountId = validatePositiveInt(domainArgs.accountId, "accountId");
  const categoryId = validatePositiveInt(domainArgs.categoryId, "categoryId");
  const name = validateString(domainArgs.name, "name", 120);

  const account = await assertOwnedAccount(
    session.token,
    accountId,
    session.target,
  );
  const categories = await listCategories(
    session.token,
    accountId,
    session.target,
    false,
  );
  const existing = categories.find((c) => Number(c.id) === categoryId);
  if (!existing) {
    throw new Error(
      `Kategori #${categoryId} tidak ditemukan pada rekening #${accountId}.`,
    );
  }

  const categoryType = Number(existing.category_type);
  const directionLabel =
    categoryType === 1 ? "CREDIT / Pemasukan" : "DEBIT / Pengeluaran";

  const snapshot = {
    id: existing.id,
    name: existing.category_name,
    type: categoryType,
    updatedDate: existing.updatedDate ?? null,
  };

  const values = { accountId, categoryId, name };

  return {
    target: `account:${accountId}:category:${categoryId}`,
    title: "Edit kategori",
    scope: `update_category:${accountId}`,
    scopeLabel: `Edit kategori pada ${account.name || "Rekening"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
    canonicalArgs: values,
    changes: {
      accountId,
      categoryId,
      category_name: name,
      category_type: categoryType,
    },
    snapshot,
    entries: [
      [
        "Rekening",
        `${account.name || "Tanpa nama"}${account.accountNumber ? ` · ${account.accountNumber}` : ""}`,
      ],
      ["Nama kategori", name],
      ["Arah", directionLabel],
    ],
    previous: [
      ["Nama", String(existing.category_name || "")],
      ["Jenis", categoryType === 1 ? "CREDIT" : "DEBIT"],
    ],
    context: { existing, values },
  };
}

export async function handleUpdateCategory(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["accountId", "categoryId", "name", ...COMMON_APPROVAL_KEYS]),
    "update_category",
  );

  return runMutationTool(
    sessionId,
    "update_category",
    args,
    prepareUpdateCategory,
    async (session, prepared) => {
      const updated = await updateCategory(
        session.token,
        {
          id: Number(prepared.context.existing.id),
          category_type: Number(prepared.context.existing.category_type),
        },
        prepared.context.values,
        session.target,
      );
      return {
        message: "Edit kategori berhasil.",
        recordId: updated.id ?? prepared.context.values.categoryId,
        category: updated,
      };
    },
    extraMeta,
  );
}
