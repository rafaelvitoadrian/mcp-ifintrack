import { describe, it, expect } from "vitest";
import {
  userRoleForm,
  permissionProfileForm,
  permissionProfileUpdateForm,
  parseColumnarText,
  toScheduleDay,
} from "../../src/utils/encoding.js";
import {
  akunCreate,
  akunUpdate,
  userCreate,
  userUpdate,
  buildUpdatedUserProfiles,
  userProfilesMatch,
} from "../../src/utils/payload.js";
import {
  normalizeUser,
  redactCredentials,
  redactAuditValue,
} from "../../src/utils/redact.js";
import { isFutureReadyUserRevision } from "../../src/api/users.js";
import { buildAuditEventsQuery } from "../../src/api/audit.js";

describe("Encoding, Lifecycle Payloads, User Profiles, and Credential Redaction", () => {
  it("builds nested form-urlencoded keys for roles and permission profiles (not JSON arrays)", () => {
    const roleForm = userRoleForm(
      {
        identUserRole: 15,
        shortname: "FIN_ROLE",
        name: "Finance Role",
        description: "Test role",
        activationStatus: "Active",
      },
      [
        {
          function: {
            identFunction: 10,
            functionName: "AkunKeuangan",
            authLevel: { identAuthLevel: 1, authLevelName: "Standard" },
          },
          accessLevel: { identAccessLevel: 2 },
        },
      ],
    );

    expect(roleForm.get("identUserRole")).toBe("15");
    expect(roleForm.get("shortname")).toBe("FIN_ROLE");
    expect(roleForm.get("userRoleFunctions[0].function.identFunction")).toBe(
      "10",
    );
    expect(roleForm.get("userRoleFunctions[0].function.functionName")).toBe(
      "AkunKeuangan",
    );
    expect(
      roleForm.get("userRoleFunctions[0].function.authLevel.identAuthLevel"),
    ).toBe("1");
    expect(
      roleForm.get("userRoleFunctions[0].accessLevel.identAccessLevel"),
    ).toBe("2");

    const profForm = permissionProfileForm("budi", [
      {
        identUserRole: 15,
        shortname: "FIN_ROLE",
        name: "Finance Role",
        activationStatus: "Active",
      },
    ]);
    expect(profForm.get("name")).toBe("AKN/budi");
    expect(profForm.get("userRoles[0].identUserRole")).toBe("15");
    expect(profForm.get("userRoles[0].shortname")).toBe("FIN_ROLE");

    const updateProfForm = permissionProfileUpdateForm({
      identPermissionProfile: 102,
      name: "AKN/BUDI",
      userAccount: { ident: 162 },
      userRoles: [{ identUserRole: 15, shortname: "FIN_ROLE" }],
    });
    expect(updateProfForm.get("identPermissionProfile")).toBe("102");
    expect(updateProfForm.get("userAccount.ident")).toBe("162");
    expect(updateProfForm.get("userRoles[0].identUserRole")).toBe("15");
  });

  it("parses Daily Schedule text/plain columnar descriptor + TAB-separated rows containing commas", () => {
    const rawScheduleText = [
      "Name=id;Type=4;Visibility=3\tName=name;Type=6;Visibility=3\tName=eventaction;Type=6;Visibility=3\tName=business_service;Type=4;Visibility=3",
      "2277\tEOD_SETTLEMENT\tRun settlement, reconcile, and archive\t1",
      "2278\tMORNING_CHECK\tCheck queue, notify operator",
    ].join("\n");

    const rows = parseColumnarText(rawScheduleText);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 2277, // Type=4 parsed as integer
      name: "EOD_SETTLEMENT",
      eventaction: "Run settlement, reconcile, and archive", // commas preserved!
      business_service: 1,
    });
    // Truncated row fills missing trailing column with empty string
    expect(rows[1]).toEqual({
      id: 2278,
      name: "MORNING_CHECK",
      eventaction: "Check queue, notify operator",
      business_service: "",
    });

    expect(toScheduleDay("2025-03-31")).toBe("20250331");
  });

  it("enforces lifecycle contract on akunCreate (no identEntity) and akunUpdate (with identEntity & identRevision)", () => {
    const createdPayload = akunCreate({
      name: "Kas Operasional",
      description: "Dana harian",
      accountType: 85,
    });
    expect(createdPayload).toEqual({
      name: "Kas Operasional",
      description: "Dana harian",
      accountType: 85,
      lifecycleEntity: {
        activationType: { identActivationType: 1 },
      },
    });
    expect(
      (createdPayload.lifecycleEntity as Record<string, unknown>).identEntity,
    ).toBeUndefined();

    const updatedPayload = akunUpdate(
      { id: 140, name: "Kas Lama", identRevision: 194, identActivationType: 1 },
      { name: "Kas Operasional 2026" },
    );
    expect(updatedPayload).toEqual({
      name: "Kas Operasional 2026",
      lifecycleEntity: {
        identEntity: 140,
        identRevision: 194,
        activationType: { identActivationType: 1 },
      },
    });
  });

  it("preserves existing individual profile ID on user update (never forces ID 0) and verifies cloned profile roles", () => {
    // On create: inline individual profile uses identPermissionProfile: 0
    const createPayload = userCreate({
      name: "Budi",
      username: "budi",
      email: "budi@example.com",
      password: "secretPassword",
      permissionProfiles: [
        {
          identPermissionProfile: 0,
          individual: true,
          name: "AKN/BUDI",
          userRoles: [{ identUserRole: 5, shortname: "AKUN_USER" }],
        },
      ],
    });
    expect(createPayload.permissionProfiles).toEqual([
      {
        identPermissionProfile: 0,
        name: "AKN/BUDI",
        userRoles: [{ identUserRole: 5, shortname: "AKUN_USER" }],
      },
    ]);

    // On update: user #162 already has individual profile #102
    const existingUser = {
      id: 162,
      identRevision: 163,
      name: "Budi",
      username: "budi",
      email: "budi@example.com",
      permissionProfilesLoaded: true,
      permissionProfiles: [
        {
          identPermissionProfile: 102,
          individual: true,
          name: "AKN/BUDI",
          userAccount: { ident: 162 },
          userRoles: [{ identUserRole: 5, shortname: "AKUN_USER" }],
        },
      ],
    };

    const updatedProfiles = buildUpdatedUserProfiles(existingUser, {
      roles: [{ identUserRole: 9, shortname: "TST_VIEW" }],
    });
    const updatePayload = userUpdate(existingUser, {
      name: "Budi Santoso",
      permissionProfiles: updatedProfiles,
    });

    // Must keep identPermissionProfile: 102 and userAccount: { ident: 162 }, NOT 0!
    expect(updatePayload.permissionProfiles).toEqual([
      {
        identPermissionProfile: 102,
        name: "AKN/BUDI",
        userAccount: { ident: 162 },
        userRoles: [{ identUserRole: 9, shortname: "TST_VIEW" }],
      },
    ]);

    // Backend clones individual profile 102 -> 103 on save; userProfilesMatch verifies by owner, name, and role set
    const savedUserFromBackend = {
      ...existingUser,
      name: "Budi Santoso",
      identRevision: 165,
      permissionProfiles: [
        {
          identPermissionProfile: 103, // New cloned ID from backend
          individual: true,
          name: "AKN/BUDI",
          userAccount: { ident: 162 },
          userRoles: [{ identUserRole: 9, shortname: "TST_VIEW" }],
        },
      ],
    };
    expect(userProfilesMatch(savedUserFromBackend, updatedProfiles)).toBe(true);
  });

  it("allows delete_user_revision only for future-ready revisions with empty effectiveFrom and rejects master records", () => {
    const masterRecord = {
      id: 31,
      revisionState: { ready: true, name: "Ready" },
      revisionEffectiveFrom: "2026-10-01 10:00:00",
      revisionEffectiveTo: null,
    };
    expect(isFutureReadyUserRevision(masterRecord)).toBe(false);

    const futureReadyRevision = {
      id: 62,
      revisionState: { ready: true, name: "Ready" },
      revisionEffectiveFrom: null,
      revisionEffectiveTo: null,
    };
    expect(isFutureReadyUserRevision(futureReadyRevision)).toBe(true);
  });

  it("redacts password, hash, salt, pwdHash, token from user records and embedded audit strings", () => {
    const rawUser = {
      id: 1,
      username: "vito",
      email: "vito@example.com",
      password: "plaintext-password",
      pwdHash: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
      salt: "random-salt-999",
      token: "jwt-token-xyz",
      lifecycleEntity: { identEntity: 1, identRevision: 2 },
    };

    const normalized = normalizeUser(rawUser)!;
    expect(normalized.id).toBe(1);
    expect(normalized.username).toBe("vito");
    expect("password" in normalized).toBe(false);
    expect("pwdHash" in normalized).toBe(false);
    expect("salt" in normalized).toBe(false);
    expect("token" in normalized).toBe(false);

    const auditEntry = {
      id: 500,
      entryName: "UPDATED",
      entryData:
        'UserPO[ident=1,username=vito,password="mySecret123",pwdHash=abc123hash,salt=xyzSalt]',
      nestedJson: JSON.stringify({
        user: "vito",
        newPassword: "superSecretPassword",
        token: "bearer-123",
      }),
    };

    const redactedAudit = redactAuditValue(auditEntry);
    expect(redactedAudit.entryData).not.toContain("mySecret123");
    expect(redactedAudit.entryData).not.toContain("abc123hash");
    expect(redactedAudit.entryData).not.toContain("xyzSalt");
    expect(redactedAudit.entryData).toContain("password=[REDACTED]");
    expect(redactedAudit.nestedJson).not.toContain("superSecretPassword");
    expect(redactedAudit.nestedJson).toContain("[REDACTED]");

    const genericRedacted = redactCredentials({
      user: "AG",
      accessToken: "tok_123",
      passwordSalt: "slt_456",
    });
    expect(genericRedacted.accessToken).toBe("[REDACTED]");
    expect(genericRedacted.passwordSalt).toBe("[REDACTED]");
  });

  it("builds audit query with required blank fields and repeated eventType/entryName enums", () => {
    const query = buildAuditEventsQuery({
      userId: "AG",
      limit: 50,
    });
    expect(query.get("userId")).toBe("AG");
    expect(query.get("eventId")).toBe("");
    expect(query.get("entryData")).toBe("");
    expect(query.getAll("eventType").length).toBeGreaterThan(1);
    expect(query.getAll("entryName").length).toBeGreaterThan(1);
  });
});
