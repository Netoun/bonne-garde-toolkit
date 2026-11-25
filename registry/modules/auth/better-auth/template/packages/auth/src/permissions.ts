import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * What a role can be allowed to do, as `resource: [actions]`. It starts from the organization plugin's
 * own statements; add a project's resources here and grant them to a role below. This file is imported
 * by the server (`auth.config.ts`) and by the fronts (`@scope/auth/permissions`): keep any server
 * import out of it.
 */
export const statements = {
  ...defaultStatements,
  // projects: ["create", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

/**
 * The three roles of an organization. Each starts from the plugin's own definition, so what they may
 * do is unchanged until a statement is added to one of them.
 */
export const roles = {
  owner: ac.newRole({ ...ownerAc.statements }),
  admin: ac.newRole({ ...adminAc.statements }),
  member: ac.newRole({ ...memberAc.statements }),
};

export type OrganizationRole = keyof typeof roles;

/** A set of statements a route asks the active member's role for: `{ member: ["create"] }`. */
export type RequiredPermissions = {
  [Resource in keyof typeof statements]?: (typeof statements)[Resource][number][];
};
