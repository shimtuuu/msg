import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessAdminPanel,
  canCreateChannels,
  canDownloadAttachments,
  canManageSecurityPolicies,
  canManageUsers,
  canPostInChannel,
  filterEnterpriseUsers,
  formatAuditLogsCsv,
  type AuditLogItem,
  type EnterprisePolicy,
  type EnterpriseUserRecord,
} from './enterpriseAdmin';

const DEFAULT_POLICY: EnterprisePolicy = {
  requireE2EE: true,
  requireVerifiedSafetyNumberForExternal: false,
  restrictGuestDownloads: true,
  allowMemberChannelCreation: true,
  defaultDisappearingTtlSec: 0,
  sessionKeyRotationHours: 24,
  maxAttachmentSizeMb: 25,
};

test('RBAC permission helpers enforce enterprise roles accurately', () => {
  assert.equal(canAccessAdminPanel('owner'), true);
  assert.equal(canAccessAdminPanel('admin'), true);
  assert.equal(canAccessAdminPanel('security_officer'), true);
  assert.equal(canAccessAdminPanel('moderator'), false);
  assert.equal(canAccessAdminPanel('member'), false);
  assert.equal(canAccessAdminPanel('guest'), false);

  assert.equal(canManageUsers('admin'), true);
  assert.equal(canManageUsers('security_officer'), false);
  assert.equal(canManageSecurityPolicies('security_officer'), true);
  assert.equal(canManageSecurityPolicies('member'), false);

  assert.equal(canCreateChannels('member', DEFAULT_POLICY), true);
  assert.equal(canCreateChannels('guest', DEFAULT_POLICY), false);
  assert.equal(
    canCreateChannels('member', {
      ...DEFAULT_POLICY,
      allowMemberChannelCreation: false,
    }),
    false
  );
  assert.equal(
    canCreateChannels('admin', {
      ...DEFAULT_POLICY,
      allowMemberChannelCreation: false,
    }),
    true
  );

  assert.equal(
    canPostInChannel('member', { isArchived: false, onlyAdminsCanPost: true }),
    false
  );
  assert.equal(
    canPostInChannel('moderator', { isArchived: false, onlyAdminsCanPost: true }),
    true
  );
  assert.equal(
    canPostInChannel('admin', { isArchived: true, onlyAdminsCanPost: false }),
    false
  );

  assert.equal(canDownloadAttachments('guest', DEFAULT_POLICY), false);
  assert.equal(canDownloadAttachments('member', DEFAULT_POLICY), true);
  assert.equal(
    canDownloadAttachments('guest', {
      ...DEFAULT_POLICY,
      restrictGuestDownloads: false,
    }),
    true
  );
});

test('filterEnterpriseUsers filters by query, department, and role', () => {
  const users: EnterpriseUserRecord[] = [
    {
      userId: 'u1',
      name: 'Елена Соколова',
      email: 'elena@corp.ru',
      department: 'Информационная безопасность',
      title: 'CISO',
      role: 'security_officer',
      isActive: true,
      presence: 'online',
      registrationId: 101,
      lastActiveAt: 1000,
      keysVerified: true,
    },
    {
      userId: 'u2',
      name: 'Марк Волков',
      email: 'mark@corp.ru',
      department: 'Разработка',
      title: 'Staff Engineer',
      role: 'member',
      isActive: true,
      presence: 'online',
      registrationId: 202,
      lastActiveAt: 1000,
      keysVerified: false,
    },
  ];

  assert.equal(filterEnterpriseUsers(users, 'елена', 'all', 'all').length, 1);
  assert.equal(
    filterEnterpriseUsers(users, '', 'Разработка', 'member').length,
    1
  );
  assert.equal(
    filterEnterpriseUsers(users, '', 'Разработка', 'admin').length,
    0
  );
});

test('formatAuditLogsCsv escapes quotes, commas, and formats ISO timestamps', () => {
  const logs: AuditLogItem[] = [
    {
      id: 'log_1',
      action: 'policy.updated',
      actorId: 'u_admin',
      actorName: 'Администратор',
      targetType: 'policy',
      targetId: 'global',
      summary: 'Включена политика "Zero-Trust", TTL=300',
      timestamp: 1700000000000,
    },
  ];
  const csv = formatAuditLogsCsv(logs);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('ID,Timestamp_ISO,Action'));
  assert.ok(lines[1].includes('"Включена политика ""Zero-Trust"", TTL=300"'));
});
