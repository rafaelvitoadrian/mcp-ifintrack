import { listAccounts, getAccount } from "../../api/accounts.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import {
  validatePositiveInt,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import type { ToolResult } from "../../types.js";

export async function handleListAccounts(
  sessionId: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(), "list_accounts");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_accounts");

  const accounts = await listAccounts(session.token, session.target);
  return formatToolResult(
    {
      count: accounts.length,
      accounts: accounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        description: acc.description ?? null,
        accountNumber: acc.accountNumber ?? null,
        accountType: acc.accountType ?? null,
        saldo: acc.saldo ?? 0,
        identRevision: acc.identRevision ?? null,
        identActivationType: acc.identActivationType ?? null,
        createdDate: acc.createdDate ?? null,
        updatedDate: acc.updatedDate ?? null,
      })),
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleGetAccount(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(["accountId"]), "get_account");
  const accountId = validatePositiveInt(args.accountId, "accountId");
  const session = requireSession(sessionId);
  assertToolAccess(session, "get_account");

  const account = await getAccount(
    session.token,
    accountId,
    session.target,
    true,
  );
  return formatToolResult(
    {
      account: {
        id: account.id,
        name: account.name,
        description: account.description ?? null,
        accountNumber: account.accountNumber ?? null,
        accountType: account.accountType ?? null,
        saldo: account.saldo ?? 0,
        identRevision: account.identRevision ?? null,
        identActivationType: account.identActivationType ?? null,
        createdDate: account.createdDate ?? null,
        updatedDate: account.updatedDate ?? null,
      },
    },
    { isUntrustedBackendData: true },
  );
}
