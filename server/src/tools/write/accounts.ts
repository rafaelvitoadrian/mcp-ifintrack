import {
  freshAccount,
  createAccount,
  updateAccount,
} from "../../api/accounts.js";
import { akunCreate, akunUpdate } from "../../utils/payload.js";
import { formatIdr } from "../../utils/decimal.js";
import {
  validatePositiveInt,
  validateNonNegativeInt,
  validateString,
  rejectUnknownFields,
} from "../../utils/validation.js";
import { runMutationTool } from "./common.js";
import type { PreparedMutation } from "./common.js";
import type { Account, SessionData, ToolResult } from "../../types.js";

const COMMON_APPROVAL_KEYS = [
  "action",
  "confirmed",
  "approval",
  "_meta",
  "requestId",
  "fingerprint",
  "expiresAt",
];

export async function prepareCreateAccount(
  _session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    values: { name: string; description: string; accountType: number };
    payload: Record<string, unknown>;
  }>
> {
  const name = validateString(domainArgs.name, "name", 120);
  const accountType = validateNonNegativeInt(
    domainArgs.accountType,
    "accountType",
  );
  if (accountType > 999) {
    throw new Error("accountType harus berada di antara 0 dan 999.");
  }
  const description =
    domainArgs.description !== undefined &&
    String(domainArgs.description).trim() !== ""
      ? validateString(domainArgs.description, "description", 2000)
      : "Akun keuangan dibuat melalui MCP";

  const values = { name, description, accountType };
  const payload = akunCreate(values);

  return {
    target: "account:new",
    title: "Buat akun keuangan",
    scope: "create_account:new",
    scopeLabel: "Buat akun keuangan baru",
    canonicalArgs: { name, description, accountType },
    changes: {
      name,
      description,
      accountType,
      initialBalance: 0,
      activationType: 1,
    },
    snapshot: { exists: false },
    entries: [
      ["Nama", name],
      ["Keterangan", description],
      ["Jenis rekening", String(accountType)],
      ["Saldo awal", formatIdr(0)],
    ],
    previous: [],
    context: { values, payload },
  };
}

export async function handleCreateAccount(
  sessionId: string,
  args: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["name", "description", "accountType", ...COMMON_APPROVAL_KEYS]),
    "create_account",
  );

  return runMutationTool(
    sessionId,
    "create_account",
    args,
    prepareCreateAccount,
    async (session, prepared) => {
      const created = await createAccount(
        session.token,
        prepared.context.values,
        session.target,
      );
      return {
        message: "Buat akun keuangan berhasil.",
        recordId: created.id ?? null,
        account: created,
      };
    },
    extraMeta,
  );
}

export async function prepareUpdateAccount(
  session: SessionData,
  domainArgs: Record<string, unknown>,
): Promise<
  PreparedMutation<{
    latest: Account;
    values: { name: string; description: string | null; activationType: number };
    payload: Record<string, unknown>;
  }>
> {
  const accountId = validatePositiveInt(domainArgs.accountId, "accountId");
  if (
    domainArgs.name === undefined &&
    domainArgs.description === undefined &&
    domainArgs.activationType === undefined
  ) {
    throw new Error(
      "Sebutkan perubahan yang diinginkan (name, description, atau activationType).",
    );
  }

  // Read fresh record from backend (also verifies ownership via Principal's account list)
  const latest = await freshAccount(session.token, accountId, session.target);
  if (!latest || Number(latest.id) !== accountId) {
    throw new Error(`Rekening #${accountId} sudah tidak tersedia.`);
  }

  const name =
    domainArgs.name !== undefined
      ? validateString(domainArgs.name, "name", 120)
      : String(latest.name || "").trim();
  const description =
    domainArgs.description !== undefined
      ? domainArgs.description === null ||
        String(domainArgs.description).trim() === ""
        ? null
        : validateString(domainArgs.description, "description", 2000)
      : (latest.description ?? null);
  const activationType =
    domainArgs.activationType !== undefined
      ? validatePositiveInt(domainArgs.activationType, "activationType")
      : Number(latest.identActivationType || 1);

  const values = { name, description, activationType };
  const payload = akunUpdate(latest, values);

  const snapshot = {
    id: latest.id,
    name: latest.name ?? null,
    description: latest.description ?? null,
    identRevision: latest.identRevision ?? null,
    identActivationType: latest.identActivationType ?? 1,
  };

  return {
    target: `account:${accountId}`,
    title: "Edit akun keuangan",
    scope: `update_account:${accountId}`,
    scopeLabel: `Edit akun keuangan pada ${latest.name || "Rekening"}${latest.accountNumber ? ` · ${latest.accountNumber}` : ""}`,
    changes: {
      accountId,
      name,
      description,
      activationType,
      previousRevision: latest.identRevision ?? null,
    },
    snapshot,
    entries: [
      [
        "Rekening",
        `${latest.name || "Tanpa nama"}${latest.accountNumber ? ` · ${latest.accountNumber}` : ""}`,
      ],
      ["Nama", name],
      ["Keterangan", description || "(kosong)"],
    ],
    previous: [
      ["Nama", String(latest.name || "")],
      ...(latest.description ? [["Keterangan", String(latest.description)] as [string, string]] : []),
    ],
    context: { latest, values, payload },
  };
}

export async function handleUpdateAccount(
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
      "activationType",
      ...COMMON_APPROVAL_KEYS,
    ]),
    "update_account",
  );

  return runMutationTool(
    sessionId,
    "update_account",
    args,
    prepareUpdateAccount,
    async (session, prepared) => {
      const updated = await updateAccount(
        session.token,
        prepared.context.latest,
        prepared.context.values,
        session.target,
      );
      return {
        message: "Edit akun keuangan berhasil.",
        recordId: updated.id ?? prepared.context.latest.id,
        account: updated,
      };
    },
    extraMeta,
  );
}
