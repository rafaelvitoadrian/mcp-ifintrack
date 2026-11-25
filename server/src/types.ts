// ── Session & Permissions ────────────────────────────────────────────────────
export type AccessLevelRank = 1 | 2 | 3; // 1 = view, 2 = initiate, 3 = approve
export type AccessLevelName = "view" | "initiate" | "approve";
export type PermissionMap = Record<string, number>;

export interface SessionData {
  sessionId: string;
  token: string;
  target: string;
  userId: number;
  username: string;
  email: string;
  principal: string;
  permissions: PermissionProfile[];
  permissionIndex: PermissionMap;
   permissionsLoaded: boolean;
  principalInfo: Record<string, unknown>;
  loginTimestamp: number;
  verified: boolean;
  scheduleHeadersCache?: Record<string, string>;
}

// ── Financial ────────────────────────────────────────────────────────────────
export interface LifecycleEntity {
  identEntity?: number;
  identRevision?: number;
  identMaster?: number | null;
  activationType?: {
    identActivationType?: number;
    id?: number;
    ident?: number;
    typeName?: string;
  };
  revisionEffectiveFrom?: string | null;
  revisionEffectiveTo?: string | null;
  requestedActivationDate?: string | null;
  lastUpdateUser?: string | null;
  lastUpdateTime?: string | null;
  revisionState?: {
    identActivationState?: number;
    name?: string;
    ready?: boolean;
    [key: string]: unknown;
  };
  workflowStatus?: unknown;
  [key: string]: unknown;
}

export interface Account {
  id?: number;
  ident?: number;
  identAkunKeuangan?: number;
  name?: string;
  description?: string | null;
  accountType?: number;
  saldo?: number | string;
  balance?: number | string;
  accountNumber?: string;
  identRevision?: number;
  identActivationType?: number;
  createdDate?: string | null;
  updatedDate?: string | null;
  lifecycleEntity?: LifecycleEntity;
  [key: string]: unknown;
}

export interface Category {
  id?: number;
  ident?: number;
  identCategory?: number;
  category_name?: string;
  category_type?: number;
  name?: string;
  type?: number;
  akunKeuangan?: Account;
  idAkunKeuangan?: number;
  createdDate?: string | null;
  updatedDate?: string | null;
  [key: string]: unknown;
}

export interface Transaction {
  id?: number;
  ident?: number;
  identTransaksi?: number;
  name?: string;
  description?: string | null;
  nominal?: number | string;
  amount?: number | string;
  jenis?: number; // 1 = CREDIT (income), 2 = DEBIT (expense)
  transactionDate?: string;
  idAkunKeuangan?: number;
  category?: Category | null;
  externalreference?: string | null;
  internalreference?: string | null;
  createdDate?: string | null;
  updatedDate?: string | null;
  [key: string]: unknown;
}

// ── Users / Permissions ──────────────────────────────────────────────────────
export interface UserRecord {
  id?: number;
  ident?: number;
  identUser?: number;
  email?: string;
  name?: string;
  username?: string;
  identRevision?: number;
  identActivationType?: number;
  permissionProfilesLoaded?: boolean;
  permissionProfiles?: PermissionProfile[];
  lifecycleEntity?: LifecycleEntity;
  revisionState?: {
    ready?: boolean;
    name?: string;
    [key: string]: unknown;
  };
  revisionEffectiveFrom?: string | null;
  revisionEffectiveTo?: string | null;
  [key: string]: unknown;
}

export interface PermissionProfile {
  identPermissionProfile?: number;
  ident?: number;
  id?: number;
  name?: string;
  individual?: boolean;
  activationStatus?: string;
  deactivationDate?: string;
  userAccount?: {
    ident?: number;
    id?: number;
    lifecycleEntity?: LifecycleEntity;
    [key: string]: unknown;
  };
  userRoles?: UserRole[];
  [key: string]: unknown;
}

export interface UserRole {
  identUserRole?: number;
  ident?: number;
  id?: number;
  shortname?: string;
  name?: string;
  description?: string;
  activationStatus?: string;
  applicableForPOA?: boolean;
  internal?: boolean;
  userRoleFunctions?: RoleFunction[];
  [key: string]: unknown;
}

export interface RoleFunction {
  function?: {
    identFunction?: number;
    ident?: number;
    functionName?: string;
    authLevel?: {
      identAuthLevel?: number;
      ident?: number;
      authLevelName?: string;
    };
  };
  accessLevel?: {
    identAccessLevel?: number;
    ident?: number;
    accessLevelName?: string;
    name?: string;
  };
  authLevel?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Audit ────────────────────────────────────────────────────────────────────
export interface AuditEvent {
  eventId: string;
  type: string;
  name: string;
  timeStamp?: unknown;
  nanoSecondsOnTimestamp?: unknown;
  user: string;
  participant: string;
  parentId?: unknown;
  remoteHost?: unknown;
  [key: string]: unknown;
}

export interface AuditEntry {
  id?: number;
  name?: string;
  entryName?: string;
  entryData?: unknown;
  entityName?: string;
  entityType?: string;
  businessIdentifier?: string;
  entryBusinessId?: string;
  timeStamp?: unknown;
  timestamp?: unknown;
  revisionId?: number;
  masterId?: number;
  [key: string]: unknown;
}

// ── Schedule ─────────────────────────────────────────────────────────────────
export interface ScheduledEvent {
  id?: number | string;
  name?: string;
  status?: string;
  scheduled_time?: string;
  scheduledTime?: string;
  scheduleddatetime?: string;
  executiondatetime?: string;
  eventaction?: string;
  eventactionbean?: string;
  scheduleday?: string;
  dailyschedulestatus?: string;
  business_service?: number | string;
  visible_to?: string;
  hasdependencies?: number | string;
  islocked?: number | string;
  operationType?: string | null;
  [key: string]: unknown;
}

// ── Approval ─────────────────────────────────────────────────────────────────
export interface ApprovalMeta {
  requestId: string;
  fingerprint: string;
  expiresAt: number;
}

export interface ApprovalRequest {
  requestId: string;
  sessionId: string;
  tool: string;
  title: string;
  arguments: Record<string, unknown>;
  preview: {
    target: string;
    scope: string;
    scopeLabel: string;
    entries: Array<[string, string]>;
    previous: Array<[string, string]>;
    changes: Record<string, unknown>;
    snapshot: Record<string, unknown>;
  };
  fingerprint: string;
  createdAt: string;
  expiresAt: number;
  expiresAtIso: string;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

// ── API Error ────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  public status: number;
  public code?: string;
  public details?: unknown;
  public hint?: string;
  public isNetwork: boolean;
  public validation?: string[];

  constructor(
    status: number,
    message: string,
    options?: {
      code?: string;
      details?: unknown;
      hint?: string;
      validation?: string[];
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isNetwork = !status;
    this.code = options?.code;
    this.details = options?.details;
    this.hint = options?.hint;
    this.validation = options?.validation;
  }
}

// ── Tool result helper ───────────────────────────────────────────────────────
export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
