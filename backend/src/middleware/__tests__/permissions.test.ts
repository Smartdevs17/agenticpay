/**
 * permissions.test.ts — Tests for Issue #362
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Role,
  roleAtLeast,
  PermissionEngine,
  AbacContext,
  createRole,
  updateRole,
  deleteRole,
  getRole,
  listRoles,
  resolveRolePermissions,
  addTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
  getTeamMembers,
  grantTemporaryPermission,
  revokeTemporaryPermission,
  getActiveTemporaryPermissions,
  cleanupExpiredPermissions,
  createApiKey,
  revokeApiKey,
  getApiKeyPermissions,
  listApiKeys,
  EnhancedPermissionEngine,
  getAuditLogs,
} from "../permissions.js";

describe("Role Hierarchy", () => {
  it("should correctly evaluate role hierarchy", () => {
    expect(roleAtLeast("super_admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "operator")).toBe(true);
    expect(roleAtLeast("operator", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "guest")).toBe(true);
    expect(roleAtLeast("guest", "admin")).toBe(false);
    expect(roleAtLeast("operator", "super_admin")).toBe(false);
  });

  it("should handle same role comparison", () => {
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });
});

describe("Permission Engine", () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine([]);
  });

  it("should allow admin to read payments", () => {
    expect(engine.can("admin", "payments", "read")).toBe(true);
  });

  it("should allow operator to write payments", () => {
    expect(engine.can("operator", "payments", "write")).toBe(true);
  });

  it("should deny viewer from writing payments", () => {
    expect(engine.can("viewer", "payments", "write")).toBe(false);
  });

  it("should allow super_admin to admin settings", () => {
    expect(engine.can("super_admin", "settings", "admin")).toBe(true);
  });

  it("should deny admin from admin settings", () => {
    expect(engine.can("admin", "settings", "admin")).toBe(false);
  });

  it("should evaluate ABAC context", () => {
    const ctx: AbacContext = {
      userId: "user1",
      tenantId: "tenant1",
      role: "admin",
      requestTime: new Date().toISOString(),
    };

    expect(engine.evaluate(ctx, "payments", "read")).toBe("allow");
    expect(engine.evaluate(ctx, "settings", "admin")).toBe("deny");
  });
});

describe("Custom Roles", () => {
  it("should create a custom role", () => {
    const role = createRole(
      "Project Manager",
      "Can manage projects",
      [
        { resource: "projects", actions: ["read", "write"] },
        { resource: "users", actions: ["read"] },
      ],
      "tenant1",
      "admin1",
    );

    expect(role.name).toBe("Project Manager");
    expect(role.permissions).toHaveLength(2);
    expect(role.tenantId).toBe("tenant1");
  });

  it("should update a custom role", () => {
    const role = createRole(
      "Developer",
      "Can develop",
      [{ resource: "projects", actions: ["read"] }],
      "tenant1",
      "admin1",
    );

    const updated = updateRole(
      role.id,
      {
        description: "Can develop and test",
        permissions: [{ resource: "projects", actions: ["read", "write"] }],
      },
      "admin1",
    );

    expect(updated.description).toBe("Can develop and test");
    expect(updated.permissions[0].actions).toContain("write");
  });

  it("should delete a custom role", () => {
    const role = createRole("Temp Role", "Temporary", [], "tenant1", "admin1");

    const deleted = deleteRole(role.id, "admin1");
    expect(deleted).toBe(true);

    const retrieved = getRole(role.id);
    expect(retrieved).toBeUndefined();
  });

  it("should prevent circular inheritance", () => {
    const role1 = createRole("Role1", "First", [], "tenant1", "admin1");
    const role2 = createRole(
      "Role2",
      "Second",
      [],
      "tenant1",
      "admin1",
      role1.id,
    );

    expect(() => {
      updateRole(role1.id, { inheritsFrom: role2.id }, "admin1");
    }).toThrow("Circular role inheritance detected");
  });

  it("should resolve role permissions with inheritance", () => {
    const parentRole = createRole(
      "Parent",
      "Parent role",
      [{ resource: "projects", actions: ["read"] }],
      "tenant1",
      "admin1",
    );

    const childRole = createRole(
      "Child",
      "Child role",
      [{ resource: "projects", actions: ["write"] }],
      "tenant1",
      "admin1",
      parentRole.id,
    );

    const permissions = resolveRolePermissions(childRole.id);
    const projectPerm = permissions.find((p) => p.resource === "projects");

    expect(projectPerm?.actions).toContain("read");
    expect(projectPerm?.actions).toContain("write");
  });

  it("should list roles by tenant", () => {
    createRole("Role1", "First", [], "tenant1", "admin1");
    createRole("Role2", "Second", [], "tenant1", "admin1");
    createRole("Role3", "Third", [], "tenant2", "admin2");

    const tenant1Roles = listRoles("tenant1");
    expect(tenant1Roles.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Team Management", () => {
  it("should add team member", () => {
    const role = createRole("Member", "Team member", [], "tenant1", "admin1");

    addTeamMember("team1", "user1", role.id, "admin1");

    const members = getTeamMembers("team1");
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe("user1");
    expect(members[0].roleId).toBe(role.id);
  });

  it("should prevent duplicate team members", () => {
    const role = createRole("Member", "Team member", [], "tenant1", "admin1");

    addTeamMember("team2", "user1", role.id, "admin1");

    expect(() => {
      addTeamMember("team2", "user1", role.id, "admin1");
    }).toThrow("User already in team");
  });

  it("should remove team member", () => {
    const role = createRole("Member", "Team member", [], "tenant1", "admin1");

    addTeamMember("team3", "user1", role.id, "admin1");
    const removed = removeTeamMember("team3", "user1", "admin1");

    expect(removed).toBe(true);

    const members = getTeamMembers("team3");
    expect(members).toHaveLength(0);
  });

  it("should update team member role", () => {
    const role1 = createRole("Role1", "First", [], "tenant1", "admin1");
    const role2 = createRole("Role2", "Second", [], "tenant1", "admin1");

    addTeamMember("team4", "user1", role1.id, "admin1");
    updateTeamMemberRole("team4", "user1", role2.id, "admin1");

    const members = getTeamMembers("team4");
    expect(members[0].roleId).toBe(role2.id);
  });
});

describe("Temporary Permissions", () => {
  it("should grant temporary permission", () => {
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    const tempPerm = grantTemporaryPermission(
      "user1",
      "projects",
      ["write"],
      expiresAt,
      "admin1",
      "Emergency access",
    );

    expect(tempPerm.userId).toBe("user1");
    expect(tempPerm.resource).toBe("projects");
    expect(tempPerm.actions).toContain("write");
  });

  it("should get active temporary permissions", () => {
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    grantTemporaryPermission(
      "user2",
      "projects",
      ["admin"],
      expiresAt,
      "admin1",
      "Temporary admin",
    );

    const activePerms = getActiveTemporaryPermissions("user2");
    expect(activePerms.length).toBeGreaterThan(0);
  });

  it("should revoke temporary permission", () => {
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    const tempPerm = grantTemporaryPermission(
      "user3",
      "projects",
      ["write"],
      expiresAt,
      "admin1",
      "Test",
    );

    const revoked = revokeTemporaryPermission(tempPerm.id, "admin1");
    expect(revoked).toBe(true);

    const activePerms = getActiveTemporaryPermissions("user3");
    expect(activePerms).toHaveLength(0);
  });

  it("should cleanup expired permissions", () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();

    grantTemporaryPermission(
      "user4",
      "projects",
      ["write"],
      expiredAt,
      "admin1",
      "Expired",
    );

    const cleaned = cleanupExpiredPermissions();
    expect(cleaned).toBeGreaterThan(0);
  });
});

describe("API Key Permissions", () => {
  it("should create API key", () => {
    const apiKey = createApiKey(
      "Test API Key",
      [{ resource: "projects", actions: ["read"] }],
      "admin1",
      undefined,
      100,
    );

    expect(apiKey.name).toBe("Test API Key");
    expect(apiKey.rateLimit).toBe(100);
    expect(apiKey.permissions).toHaveLength(1);
  });

  it("should get API key permissions", () => {
    const apiKey = createApiKey(
      "Test Key",
      [{ resource: "projects", actions: ["read", "write"] }],
      "admin1",
    );

    const retrieved = getApiKeyPermissions(apiKey.keyId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("Test Key");
  });

  it("should revoke API key", () => {
    const apiKey = createApiKey(
      "Revoke Test",
      [{ resource: "projects", actions: ["read"] }],
      "admin1",
    );

    const revoked = revokeApiKey(apiKey.keyId, "admin1");
    expect(revoked).toBe(true);

    const retrieved = getApiKeyPermissions(apiKey.keyId);
    expect(retrieved).toBeUndefined();
  });

  it("should not return expired API key", () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();

    const apiKey = createApiKey(
      "Expired Key",
      [{ resource: "projects", actions: ["read"] }],
      "admin1",
      expiredAt,
    );

    const retrieved = getApiKeyPermissions(apiKey.keyId);
    expect(retrieved).toBeUndefined();
  });

  it("should list API keys by creator", () => {
    createApiKey("Key1", [], "admin1");
    createApiKey("Key2", [], "admin1");
    createApiKey("Key3", [], "admin2");

    const admin1Keys = listApiKeys("admin1");
    expect(admin1Keys.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Enhanced Permission Engine", () => {
  let engine: EnhancedPermissionEngine;

  beforeEach(() => {
    engine = new EnhancedPermissionEngine([]);
  });

  it("should evaluate with custom role", () => {
    const role = createRole(
      "Custom",
      "Custom role",
      [{ resource: "projects", actions: ["read", "write"] }],
      "tenant1",
      "admin1",
    );

    const ctx: AbacContext = {
      userId: "user1",
      tenantId: "tenant1",
      role: "viewer",
    };

    const result = engine.evaluateWithCustomRole(
      ctx,
      "projects",
      "write",
      role.id,
    );

    expect(result).toBe("allow");
  });

  it("should evaluate with API key", () => {
    const apiKey = createApiKey(
      "Test",
      [{ resource: "projects", actions: ["read"] }],
      "admin1",
    );

    const ctx: AbacContext = {
      userId: "user1",
      tenantId: "tenant1",
      role: "guest",
    };

    const result = engine.evaluateWithCustomRole(
      ctx,
      "projects",
      "read",
      undefined,
      apiKey.keyId,
    );

    expect(result).toBe("allow");
  });

  it("should deny with insufficient API key permissions", () => {
    const apiKey = createApiKey(
      "Limited",
      [{ resource: "projects", actions: ["read"] }],
      "admin1",
    );

    const ctx: AbacContext = {
      userId: "user1",
      tenantId: "tenant1",
      role: "guest",
    };

    const result = engine.evaluateWithCustomRole(
      ctx,
      "projects",
      "write",
      undefined,
      apiKey.keyId,
    );

    expect(result).toBe("deny");
  });

  it("should allow with temporary permission", () => {
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    grantTemporaryPermission(
      "user5",
      "projects",
      ["admin"],
      expiresAt,
      "admin1",
      "Emergency",
    );

    const ctx: AbacContext = {
      userId: "user5",
      tenantId: "tenant1",
      role: "viewer",
    };

    const result = engine.evaluateWithCustomRole(ctx, "projects", "admin");

    expect(result).toBe("allow");
  });
});

describe("Audit Logging", () => {
  it("should log role creation", () => {
    createRole("Audit Test", "Test", [], "tenant1", "admin1");

    const logs = getAuditLogs({ action: "role_created" });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("should log permission grants", () => {
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    grantTemporaryPermission(
      "user6",
      "projects",
      ["write"],
      expiresAt,
      "admin1",
      "Test",
    );

    const logs = getAuditLogs({ action: "permission_granted" });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("should filter audit logs by user", () => {
    createRole("Filter Test", "Test", [], "tenant1", "admin_filter");

    const logs = getAuditLogs({ userId: "admin_filter" });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((log) => log.userId === "admin_filter")).toBe(true);
  });

  it("should limit audit log results", () => {
    const logs = getAuditLogs({ limit: 5 });
    expect(logs.length).toBeLessThanOrEqual(5);
  });
});
