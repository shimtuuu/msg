export type EnterpriseRole =
  | 'owner'
  | 'admin'
  | 'security_officer'
  | 'moderator'
  | 'member'
  | 'guest';

export interface EnterprisePolicy {
  requireE2EE: boolean;
  requireVerifiedSafetyNumberForExternal: boolean;
  restrictGuestDownloads: boolean;
  allowMemberChannelCreation: boolean;
  defaultDisappearingTtlSec: number;
  sessionKeyRotationHours: number;
  maxAttachmentSizeMb: number;
}

export interface AuditLogItem {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  targetType: 'user' | 'room' | 'policy' | 'security';
  targetId: string;
  summary: string;
  timestamp: number;
}

export interface EnterpriseUserRecord {
  userId: string;
  name: string;
  email: string;
  department: string;
  title: string;
  role: EnterpriseRole;
  isActive: boolean;
  presence: 'online' | 'away' | 'dnd' | 'offline';
  registrationId: number;
  lastActiveAt: number;
  keysVerified: boolean;
}

export const ROLE_LABELS: Record<EnterpriseRole, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  security_officer: 'Офицер ИБ',
  moderator: 'Модератор',
  member: 'Сотрудник',
  guest: 'Гость',
};

export function canAccessAdminPanel(role: EnterpriseRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'security_officer';
}

export function canCreateAccounts(role: EnterpriseRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

export function canAccessManagementConsole(role: EnterpriseRole): boolean {
  return canAccessAdminPanel(role) || canCreateAccounts(role);
}

export function getCreatableRoles(actorRole: EnterpriseRole): EnterpriseRole[] {
  if (actorRole === 'owner' || actorRole === 'admin') {
    return ['owner', 'admin', 'security_officer', 'moderator', 'member', 'guest'];
  }
  if (actorRole === 'moderator') {
    return ['member', 'guest'];
  }
  return [];
}

export function canCreateAccountWithRole(
  actorRole: EnterpriseRole,
  targetRole: EnterpriseRole
): boolean {
  return getCreatableRoles(actorRole).includes(targetRole);
}

export function canManageUsers(role: EnterpriseRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canManageSecurityPolicies(role: EnterpriseRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'security_officer';
}

export function canManageChannels(role: EnterpriseRole): boolean {
  return (
    role === 'owner' ||
    role === 'admin' ||
    role === 'security_officer' ||
    role === 'moderator'
  );
}

export function canCreateChannels(
  role: EnterpriseRole,
  policy: EnterprisePolicy
): boolean {
  if (canManageChannels(role)) return true;
  if (role === 'guest') return false;
  return policy.allowMemberChannelCreation;
}

export function canPostInChannel(
  role: EnterpriseRole,
  options: { isArchived?: boolean; onlyAdminsCanPost?: boolean }
): boolean {
  if (options.isArchived) return false;
  if (options.onlyAdminsCanPost) {
    return canManageChannels(role);
  }
  return true;
}

export function canDownloadAttachments(
  role: EnterpriseRole,
  policy: EnterprisePolicy
): boolean {
  if (role === 'guest' && policy.restrictGuestDownloads) {
    return false;
  }
  return true;
}

export function filterEnterpriseUsers(
  users: EnterpriseUserRecord[],
  query: string,
  departmentFilter: string,
  roleFilter: string
): EnterpriseUserRecord[] {
  const q = query.trim().toLowerCase();
  return users.filter((u) => {
    if (departmentFilter !== 'all' && u.department !== departmentFilter) {
      return false;
    }
    if (roleFilter !== 'all' && u.role !== roleFilter) {
      return false;
    }
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.department.toLowerCase().includes(q) ||
      u.title.toLowerCase().includes(q)
    );
  });
}

function escapeCsvCell(val: string | number): string {
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatAuditLogsCsv(logs: AuditLogItem[]): string {
  const header = [
    'ID',
    'Timestamp_ISO',
    'Action',
    'Actor_ID',
    'Actor_Name',
    'Target_Type',
    'Target_ID',
    'Summary',
  ].join(',');

  const rows = logs.map((l) =>
    [
      escapeCsvCell(l.id),
      escapeCsvCell(new Date(l.timestamp).toISOString()),
      escapeCsvCell(l.action),
      escapeCsvCell(l.actorId),
      escapeCsvCell(l.actorName),
      escapeCsvCell(l.targetType),
      escapeCsvCell(l.targetId),
      escapeCsvCell(l.summary),
    ].join(',')
  );

  return [header, ...rows].join('\n');
}
