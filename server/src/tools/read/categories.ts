import { listCategories, getCategory } from "../../api/categories.js";
import { requireSession } from "../../auth/session.js";
import { assertToolAccess } from "../../utils/permissions.js";
import {
  validatePositiveInt,
  rejectUnknownFields,
  formatToolResult,
} from "../../utils/validation.js";
import type { ToolResult } from "../../types.js";

export async function handleListCategories(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(args, new Set(["accountId"]), "list_categories");
  const accountId = validatePositiveInt(args.accountId, "accountId");
  const session = requireSession(sessionId);
  assertToolAccess(session, "list_categories");

  const categories = await listCategories(
    session.token,
    accountId,
    session.target,
    true,
  );
  return formatToolResult(
    {
      accountId,
      count: categories.length,
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.category_name,
        type: cat.category_type,
        direction:
          Number(cat.category_type) === 1
            ? "CREDIT"
            : Number(cat.category_type) === 2
              ? "DEBIT"
              : "UNKNOWN",
        accountId: cat.akunKeuangan?.id ?? accountId,
        createdDate: cat.createdDate ?? null,
        updatedDate: cat.updatedDate ?? null,
      })),
    },
    { isUntrustedBackendData: true },
  );
}

export async function handleGetCategory(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  rejectUnknownFields(
    args,
    new Set(["accountId", "categoryId"]),
    "get_category",
  );
  const accountId = validatePositiveInt(args.accountId, "accountId");
  const categoryId = validatePositiveInt(args.categoryId, "categoryId");
  const session = requireSession(sessionId);
  assertToolAccess(session, "get_category");

  const cat = await getCategory(
    session.token,
    accountId,
    categoryId,
    session.target,
    true,
  );
  return formatToolResult(
    {
      category: {
        id: cat.id,
        name: cat.category_name,
        type: cat.category_type,
        direction:
          Number(cat.category_type) === 1
            ? "CREDIT"
            : Number(cat.category_type) === 2
              ? "DEBIT"
              : "UNKNOWN",
        accountId: cat.akunKeuangan?.id ?? accountId,
        createdDate: cat.createdDate ?? null,
        updatedDate: cat.updatedDate ?? null,
      },
    },
    { isUntrustedBackendData: true },
  );
}
