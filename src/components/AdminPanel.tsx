import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import type {
  AdminOverviewPayload,
  EnterprisePolicy,
  EnterpriseRole,
} from '../types/messenger';
import {
  canManageSecurityPolicies,
  canManageUsers,
  filterEnterpriseUsers,
  formatAuditLogsCsv,
  ROLE_LABELS,
} from '../utils/enterpriseAdmin';

interface AdminPanelProps {
  localUserId: string;
  localUserName: string;
  currentUserRole: EnterpriseRole;
  onBackToChats: () => void;
  onPolicySynced?: (policy: EnterprisePolicy) => void;
}

type AdminTab = 'users' | 'rooms' | 'policies' | 'audit';

const ROLE_OPTIONS: EnterpriseRole[] = [
  'owner',
  'admin',
  'security_officer',
  'moderator',
  'member',
  'guest',
];

function formatAuditTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AdminPanel({
  localUserId,
  localUserName,
  currentUserRole,
  onBackToChats,
  onPolicySynced,
}: AdminPanelProps) {
  const [overview, setOverview] = useState<AdminOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Users filter & invite state
  const [userQuery, setUserQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDept, setInviteDept] = useState('Разработка');
  const [inviteTitle, setInviteTitle] = useState('Старший инженер');
  const [inviteRole, setInviteRole] = useState<EnterpriseRole>('member');

  // Audit filter state
  const [auditQuery, setAuditQuery] = useState('');

  const allowUserMgmt = canManageUsers(currentUserRole);
  const allowPolicyMgmt = canManageSecurityPolicies(currentUserRole);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { 'x-user-id': localUserId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Не удалось загрузить данные админ-панели');
      }
      const data = (await res.json()) as AdminOverviewPayload;
      setOverview(data);
      onPolicySynced?.(data.policy);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [localUserId, onPolicySynced]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const showNotice = (text: string) => {
    setNoticeMsg(text);
    window.setTimeout(() => setNoticeMsg(null), 3500);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim() || !allowUserMgmt) return;
    setBusyAction('invite');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          name: inviteName.trim(),
          email: inviteEmail.trim(),
          department: inviteDept.trim(),
          title: inviteTitle.trim(),
          role: inviteRole,
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания сотрудника');
      setOverview(data as AdminOverviewPayload);
      setInviteName('');
      setInviteEmail('');
      setInviteOpen(false);
      showNotice('Сотрудник добавлен в корпоративный каталог и получил E2EE-ключи');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleChangeRole = async (userId: string, role: EnterpriseRole) => {
    if (!allowUserMgmt) return;
    setBusyAction(`role:${userId}`);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          role,
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления роли');
      setOverview(data as AdminOverviewPayload);
      showNotice(`Роль обновлена: ${ROLE_LABELS[role]}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleActive = async (userId: string, nextActive: boolean) => {
    if (!allowUserMgmt) return;
    setBusyAction(`status:${userId}`);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          isActive: nextActive,
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка изменения статуса');
      setOverview(data as AdminOverviewPayload);
      showNotice(nextActive ? 'Учётная запись активирована' : 'Доступ сотрудника приостановлен');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeKeys = async (userId: string) => {
    if (!allowPolicyMgmt) return;
    setBusyAction(`revoke:${userId}`);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/revoke-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка отзыва ключей');
      setOverview(data as AdminOverviewPayload);
      showNotice('Ключи Identity/SignedPreKey перевыпущены, активные сессии сброшены');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleArchiveRoom = async (roomId: string) => {
    if (!allowUserMgmt) return;
    setBusyAction(`room:${roomId}`);
    try {
      const res = await fetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка архивирования');
      setOverview(data as AdminOverviewPayload);
      showNotice('Статус канала обновлён');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRotateAllKeys = async () => {
    if (!allowPolicyMgmt) return;
    setBusyAction('rotate-all');
    try {
      const res = await fetch('/api/admin/security/rotate-all-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка ротации ключей');
      setOverview(data as AdminOverviewPayload);
      showNotice('Выполнена принудительная ротация SenderKeys по всем каналам');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdatePolicy = async (patch: Partial<EnterprisePolicy>) => {
    if (!allowPolicyMgmt || !overview) return;
    setBusyAction('policy');
    try {
      const res = await fetch('/api/admin/policies', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': localUserId,
        },
        body: JSON.stringify({
          policy: patch,
          actorId: localUserId,
          actorName: localUserName,
        }),
      });
      const data = (await res.json()) as AdminOverviewPayload;
      if (!res.ok) throw new Error('Не удалось обновить политику ИБ');
      setOverview(data);
      onPolicySynced?.(data.policy);
      showNotice('Политика информационной безопасности применена ко всем клиентам');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportAuditCsv = () => {
    if (!overview) return;
    const csv = formatAuditLogsCsv(overview.auditLogs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corp-messenger-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice('Журнал аудита выгружен в CSV');
  };

  const departments = useMemo(() => {
    if (!overview) return [];
    return Array.from(new Set(overview.users.map((u) => u.department))).sort();
  }, [overview]);

  const filteredUsers = useMemo(() => {
    if (!overview) return [];
    return filterEnterpriseUsers(overview.users, userQuery, departmentFilter, roleFilter);
  }, [overview, userQuery, departmentFilter, roleFilter]);

  const filteredLogs = useMemo(() => {
    if (!overview) return [];
    const q = auditQuery.trim().toLowerCase();
    if (!q) return overview.auditLogs;
    return overview.auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q)
    );
  }, [overview, auditQuery]);

  return (
    <div
      data-testid="enterprise-admin-panel"
      className="flex-1 min-w-0 h-full flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden"
    >
      {/* Header */}
      <header className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToChats}
            aria-label="Вернуться к перепискам"
            className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>К перепискам</span>
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              Корпоративное управление и ИБ
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Ваша роль: <span className="font-medium text-slate-700 dark:text-slate-200">{ROLE_LABELS[currentUserRole]}</span> · Zero-Knowledge E2EE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto thin-scrollbar p-4 sm:p-6 space-y-5">
        {errorMsg && (
          <div className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
            {errorMsg}
          </div>
        )}
        {noticeMsg && (
          <div className="px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
            {noticeMsg}
          </div>
        )}

        {/* 4-KPI Summary Row */}
        {overview && (
          <section
            aria-label="Сводные показатели организации"
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
          >
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Всего сотрудников</span>
                <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {overview.stats.totalUsers}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Заблокировано: {overview.stats.suspendedUsers}
              </p>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Онлайн сейчас</span>
                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {overview.stats.onlineUsers}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Safety Number: {overview.stats.verifiedRatePercent}%
              </p>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Каналов E2EE</span>
                <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {overview.stats.activeRooms}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Sender Keys AES-256-GCM
              </p>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Сообщений за сутки</span>
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {overview.stats.messagesToday.toLocaleString('ru-RU')}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                100% сквозное шифрование
              </p>
            </div>
          </section>
        )}

        {/* Section Tabs */}
        <div
          role="tablist"
          aria-label="Разделы панели администратора"
          className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 overflow-x-auto thin-scrollbar pb-2"
        >
          {(
            [
              { id: 'users', label: 'Сотрудники и RBAC' },
              { id: 'rooms', label: 'Каналы' },
              { id: 'policies', label: 'Политики ИБ' },
              { id: 'audit', label: 'Журнал аудита' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`h-9 px-3.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Users & RBAC */}
        {overview && activeTab === 'users' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="search"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Поиск по имени, email, отделу…"
                    className="w-full h-9 pl-9 pr-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <select
                  aria-label="Фильтр по отделу"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="h-9 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200"
                >
                  <option value="all">Все отделы</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Фильтр по роли"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="h-9 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200"
                >
                  <option value="all">Все роли</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                disabled={!allowUserMgmt}
                onClick={() => setInviteOpen((v) => !v)}
                className="h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Добавить сотрудника</span>
              </button>
            </div>

            {!allowUserMgmt && (
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-3.5 py-2">
                Просмотр в режиме только для чтения. Управление учётными записями доступно ролям «Владелец» и «Администратор».
              </p>
            )}

            {inviteOpen && allowUserMgmt && (
              <form
                onSubmit={handleInviteUser}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
              >
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="ФИО сотрудника"
                  className="h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                />
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@corp.internal"
                  className="h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                />
                <input
                  type="text"
                  value={inviteDept}
                  onChange={(e) => setInviteDept(e.target.value)}
                  placeholder="Департамент"
                  className="h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                />
                <input
                  type="text"
                  value={inviteTitle}
                  onChange={(e) => setInviteTitle(e.target.value)}
                  placeholder="Должность"
                  className="h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as EnterpriseRole)}
                    className="h-9 px-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs flex-1 min-w-0"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={busyAction === 'invite'}
                    className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    Создать
                  </button>
                </div>
              </form>
            )}

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[740px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Сотрудник</th>
                    <th className="py-2.5 px-4">Департамент и должность</th>
                    <th className="py-2.5 px-4">Роль RBAC</th>
                    <th className="py-2.5 px-4">Ключи / Статус</th>
                    <th className="py-2.5 px-4 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {filteredUsers.map((u) => (
                    <tr
                      key={u.userId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {u.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {u.email}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-800 dark:text-slate-200">
                          {u.department}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {u.title}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          aria-label={`Роль пользователя ${u.name}`}
                          value={u.role}
                          disabled={!allowUserMgmt || busyAction === `role:${u.userId}`}
                          onChange={(e) =>
                            void handleChangeRole(
                              u.userId,
                              e.target.value as EnterpriseRole
                            )
                          }
                          className="h-8 px-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 disabled:opacity-60"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300">
                          Reg #{u.registrationId} ·{' '}
                          <span
                            className={
                              u.isActive
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {u.isActive ? 'Активен' : 'Заблокирован'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {u.keysVerified ? 'Safety Number подтверждён' : 'Требуется сверка ключей'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!allowPolicyMgmt || busyAction === `revoke:${u.userId}`}
                            onClick={() => void handleRevokeKeys(u.userId)}
                            className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Сбросить ключи</span>
                          </button>

                          <button
                            type="button"
                            disabled={!allowUserMgmt || busyAction === `status:${u.userId}`}
                            onClick={() => void handleToggleActive(u.userId, !u.isActive)}
                            className={`h-8 px-2.5 rounded-lg border disabled:opacity-40 text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
                              u.isActive
                                ? 'border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                                : 'border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                            }`}
                          >
                            {u.isActive ? (
                              <>
                                <UserX className="w-3.5 h-3.5" />
                                <span>Заблокировать</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Разблокировать</span>
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Tab 2: Channels */}
        {overview && activeTab === 'rooms' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Корпоративные каналы и ключи Sender Keys
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Архивирование переводит канал в режим «только чтение». Ротация выпускает новые цепочки AES-256-GCM для всех участников.
                </p>
              </div>
              <button
                type="button"
                disabled={!allowPolicyMgmt || busyAction === 'rotate-all'}
                onClick={() => void handleRotateAllKeys()}
                className="h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <KeyRound className="w-4 h-4" />
                <span>Ротировать все ключи каналов</span>
              </button>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Канал</th>
                    <th className="py-2.5 px-4">Режим доступа</th>
                    <th className="py-2.5 px-4">Участники</th>
                    <th className="py-2.5 px-4">Поколение SenderKey</th>
                    <th className="py-2.5 px-4 text-right">Управление</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {overview.rooms.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          #{r.name}
                          {r.department ? (
                            <span className="ml-1.5 font-normal text-[11px] text-slate-500 dark:text-slate-400">
                              · {r.department}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {r.topic || r.description}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        {r.kind === 'private' ? 'Закрытый (по доступу)' : 'Корпоративный'}
                        {r.onlyAdminsCanPost ? ' · Только объявления' : ''}
                        {r.isArchived ? ' · В архиве' : ''}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {r.memberCount}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        Поколение #{r.senderKeyGeneration}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={!allowUserMgmt || busyAction === `room:${r.id}`}
                          onClick={() => void handleToggleArchiveRoom(r.id)}
                          className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>{r.isArchived ? 'Восстановить' : 'Архивировать'}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Tab 3: Security & DLP Policies */}
        {overview && activeTab === 'policies' && (
          <section className="space-y-4 max-w-3xl">
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-blue-600" />
                    Обязательное сквозное шифрование (Zero-Knowledge E2EE)
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Все сообщения и вложения шифруются на устройствах сотрудников через X3DH, Double Ratchet и Sender Keys. Сервер не имеет ключей расшифровки.
                  </p>
                </div>
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
                  Всегда активно
                </span>
              </div>

              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Ограничить скачивание вложений для роли «Гость» (DLP)
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Блокирует локальную расшифровку и загрузку зашифрованных корпоративных файлов внешними подрядчиками.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Запретить скачивание вложений гостями"
                  disabled={!allowPolicyMgmt || busyAction === 'policy'}
                  checked={overview.policy.restrictGuestDownloads}
                  onChange={(e) =>
                    void handleUpdatePolicy({
                      restrictGuestDownloads: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-blue-600 cursor-pointer shrink-0"
                />
              </div>

              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Требовать сверку 60-значного Safety Number для внешних контактов
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Повышает защиту от MITM-атак при обмене ключами с контрагентами.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Требовать сверку Safety Number"
                  disabled={!allowPolicyMgmt || busyAction === 'policy'}
                  checked={overview.policy.requireVerifiedSafetyNumberForExternal}
                  onChange={(e) =>
                    void handleUpdatePolicy({
                      requireVerifiedSafetyNumberForExternal: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-blue-600 cursor-pointer shrink-0"
                />
              </div>

              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Разрешить обычным сотрудникам создавать рабочие каналы
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    При отключении новые корпоративные каналы создают только модераторы и администраторы.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Разрешить сотрудникам создавать каналы"
                  disabled={!allowPolicyMgmt || busyAction === 'policy'}
                  checked={overview.policy.allowMemberChannelCreation}
                  onChange={(e) =>
                    void handleUpdatePolicy({
                      allowMemberChannelCreation: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-blue-600 cursor-pointer shrink-0"
                />
              </div>

              <div className="p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Автоудаление сообщений по умолчанию (TTL)
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Автоматически применяется к новым диалогам и закрытым каналам.
                  </p>
                </div>
                <select
                  aria-label="Таймер автоудаления по умолчанию"
                  disabled={!allowPolicyMgmt || busyAction === 'policy'}
                  value={overview.policy.defaultDisappearingTtlSec}
                  onChange={(e) =>
                    void handleUpdatePolicy({
                      defaultDisappearingTtlSec: Number(e.target.value),
                    })
                  }
                  className="h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs"
                >
                  <option value={0}>Отключено</option>
                  <option value={60}>1 минута</option>
                  <option value={300}>5 минут</option>
                  <option value={3600}>1 час</option>
                </select>
              </div>

              <div className="p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Периодичность ротации сессионных ключей и лимит файла
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Интервал обновления эфемерных ключей и максимальный размер зашифрованного файла.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Период ротации ключей"
                    disabled={!allowPolicyMgmt || busyAction === 'policy'}
                    value={overview.policy.sessionKeyRotationHours}
                    onChange={(e) =>
                      void handleUpdatePolicy({
                        sessionKeyRotationHours: Number(e.target.value),
                      })
                    }
                    className="h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <option value={6}>Ротация: 6 ч</option>
                    <option value={24}>Ротация: 24 ч</option>
                    <option value={72}>Ротация: 72 ч</option>
                  </select>
                  <select
                    aria-label="Лимит размера вложения"
                    disabled={!allowPolicyMgmt || busyAction === 'policy'}
                    value={overview.policy.maxAttachmentSizeMb}
                    onChange={(e) =>
                      void handleUpdatePolicy({
                        maxAttachmentSizeMb: Number(e.target.value),
                      })
                    }
                    className="h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <option value={10}>Макс: 10 МБ</option>
                    <option value={25}>Макс: 25 МБ</option>
                    <option value={100}>Макс: 100 МБ</option>
                  </select>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Audit Log */}
        {overview && activeTab === 'audit' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="search"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  placeholder="Поиск по действию, субъекту или описанию…"
                  className="w-full h-9 pl-9 pr-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                />
              </div>

              <button
                type="button"
                onClick={handleExportAuditCsv}
                className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Экспорт CSV</span>
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Журнал фиксирует только метаданные управления доступом, ролями и криптографическими ключами. Тексты сообщений и файлы не логируются.
            </p>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Время</th>
                    <th className="py-2.5 px-4">Инициатор</th>
                    <th className="py-2.5 px-4">Событие</th>
                    <th className="py-2.5 px-4">Детали</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatAuditTime(log.timestamp)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {log.actorName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-blue-700 dark:text-blue-400 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                        {log.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
