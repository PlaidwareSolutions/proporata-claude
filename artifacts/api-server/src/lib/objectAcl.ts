// ACL types and helpers — kept for interface compatibility.
// R2 (Cloudflare) uses bucket-level policies, not per-object ACLs,
// so all per-object ACL operations are no-ops here.

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

export async function setObjectAclPolicy(
  _objectFile: unknown,
  _aclPolicy: ObjectAclPolicy,
): Promise<void> {}

export async function getObjectAclPolicy(
  _objectFile: unknown,
): Promise<ObjectAclPolicy | null> {
  return null;
}

export async function canAccessObject(_opts: {
  userId?: string;
  objectFile: unknown;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  return true;
}
