import React, { useMemo, useState } from 'react';
import {
  Archive,
  BellOff,
  ChevronDown,
  Compass,
  Hash,
  Lock,
  Megaphone,
  Moon,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import type {
  ConversationMeta,
  EnterprisePolicy,
  EnterpriseRole,
  PresenceState,
} from '../types/messenger';
import {
  canAccessAdminPanel,
  canCreateChannels,
  ROLE_LABELS,
} from '../utils/enterpriseAdmin';

interface SidebarProps {
  conversations: ConversationMeta[];
  activeId: string;
  viewMode: 'chat' | 'admin';
  onSelectConversation: (id: string) => void;
  onOpenAdminPanel: () => void;
  onOpenCreateRoom: () => void;
  onOpenChannelDirectory: () => void;
  localUserId: string;
  localRegistrationId: number;
  currentUserRole: EnterpriseRole;
  enterprisePolicy: EnterprisePolicy;
  onSwitchRole: (role: EnterpriseRole) => void;
  presence: PresenceState;
  onChangePresence: (p: PresenceState) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  wsConnected: boolean;
}

const PRESENCE_OPTIONS: Array<{ value: PresenceState; label: string; dotClass: string }> = [
  { value: 'online', label: 'В сети', dotClass: 'bg-emerald-500' },
  { value: 'away', label: 'Отошёл', dotClass: 'bg-amber-500' },
  { value: 'dnd', label: 'Не беспокоить', dotClass: 'bg-rose-500' },
  { value: 'offline', label: 'Невидимый', dotClass: 'bg-slate-400' },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const ChannelRow = React.memo(function ChannelRow({
  conv,
  isActive,
  onSelect,
}: {
  conv: ConversationMeta;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conv.id)}
      aria-current={isActive ? 'true' : undefined}
      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-sm text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        isActive
          ? 'bg-[#363654] text-white font-medium'
          : 'text-[#cdd6f4]/80 hover:bg-[#2a2a3e] hover:text-white'
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {conv.isArchived ? (
          <Archive className="w-4 h-4 shrink-0 text-[#8990b3]" aria-hidden="true" />
        ) : conv.category === 'announcement' ? (
          <Megaphone className="w-4 h-4 shrink-0 text-[#89b4fa]" aria-hidden="true" />
        ) : conv.kind === 'private' ? (
          <Lock className="w-4 h-4 shrink-0 text-[#89b4fa]" aria-hidden="true" />
        ) : (
          <Hash className="w-4 h-4 shrink-0 text-[#8990b3]" aria-hidden="true" />
        )}
        <span className="truncate">{conv.name}</span>
        {conv.isMuted && (
          <BellOff
            className="w-3 h-3 shrink-0 text-[#6c7086]"
            aria-label="Уведомления отключены"
          />
        )}
      </span>

      {conv.unreadCount > 0 && (
        <span className="text-xs font-mono tabular-nums font-semibold text-blue-400 shrink-0">
          +{conv.unreadCount}
        </span>
      )}
    </button>
  );
});

const DmRow = React.memo(function DmRow({
  conv,
  isActive,
  onSelect,
}: {
  conv: ConversationMeta;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const presenceColor =
    conv.presence === 'online'
      ? 'bg-emerald-500'
      : conv.presence === 'away'
      ? 'bg-amber-500'
      : conv.presence === 'dnd'
      ? 'bg-rose-500'
      : 'bg-slate-500';

  return (
    <button
      type="button"
      onClick={() => onSelect(conv.id)}
      aria-current={isActive ? 'true' : undefined}
      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        isActive
          ? 'bg-[#363654] text-white font-medium'
          : 'text-[#cdd6f4]/85 hover:bg-[#2a2a3e] hover:text-white'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative w-8 h-8 rounded-lg bg-[#2a2a3e] border border-white/10 flex items-center justify-center text-xs font-semibold text-white shrink-0">
          {getInitials(conv.name)}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#1e1e2e] ${presenceColor}`}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm truncate">{conv.name}</span>
            {conv.verified && (
              <ShieldCheck
                className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                aria-label="Ключ подтверждён"
              />
            )}
          </div>
          <p className="text-[11px] text-[#8990b3] truncate">
            {conv.typingUsers.length > 0
              ? 'Шифрует ответ…'
              : conv.lastMessagePreview || conv.subtitle}
          </p>
        </div>
      </div>

      {conv.unreadCount > 0 && (
        <span className="text-xs font-mono tabular-nums font-semibold text-blue-400 shrink-0">
          +{conv.unreadCount}
        </span>
      )}
    </button>
  );
});

export const Sidebar = React.memo(function Sidebar({
  conversations,
  activeId,
  viewMode,
  onSelectConversation,
  onOpenAdminPanel,
  onOpenCreateRoom,
  onOpenChannelDirectory,
  localUserId,
  localRegistrationId,
  currentUserRole,
  enterprisePolicy,
  onSwitchRole,
  presence,
  onChangePresence,
  darkMode,
  onToggleDarkMode,
  wsConnected,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [presenceOpen, setPresenceOpen] = useState(false);

  const showAdminEntry = canAccessAdminPanel(currentUserRole);
  const allowCreateChannel = canCreateChannels(currentUserRole, enterprisePolicy);

  const { primaryChannels, teamChannels, availableChannelCount, dms } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: ConversationMeta) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.subtitle.toLowerCase().includes(q) ||
      (c.department ?? '').toLowerCase().includes(q);

    const allChannels = conversations.filter(
      (c) => c.kind === 'channel' || c.kind === 'private'
    );
    const joinedChannels = allChannels.filter(
      (c) => c.isJoined !== false && match(c)
    );
    const primary = joinedChannels.filter(
      (c) => c.category === 'announcement' || c.id === 'room-general'
    );
    const team = joinedChannels.filter(
      (c) => !(c.category === 'announcement' || c.id === 'room-general')
    );

    return {
      primaryChannels: primary,
      teamChannels: team,
      availableChannelCount: allChannels.length,
      dms: conversations.filter((c) => c.kind === 'dm' && match(c)),
    };
  }, [conversations, query]);

  const currentPresence =
    PRESENCE_OPTIONS.find((p) => p.value === presence) ?? PRESENCE_OPTIONS[0];

  return (
    <aside
      aria-label="Навигация по каналам и диалогам"
      className="w-full md:w-[290px] lg:w-[300px] shrink-0 h-full flex flex-col bg-[#1e1e2e] text-[#cdd6f4] border-r border-white/10"
    >
      {/* Top workspace title */}
      <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-base font-semibold tracking-tight text-white whitespace-nowrap">
            Corp Messenger
          </h1>
          <p className="text-[11px] text-[#8990b3] font-mono tabular-nums truncate">
            E2EE Signal · Reg #{localRegistrationId}
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label={darkMode ? 'Включить светлую тему' : 'Включить тёмную тему'}
          className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-[#cdd6f4] hover:bg-[#2a2a3e] transition-colors shrink-0"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2.5 border-b border-white/10">
        <label htmlFor="sidebar-search" className="sr-only">
          Поиск каналов и собеседников
        </label>
        <div className="relative flex items-center">
          <Search
            className="w-4 h-4 text-[#8990b3] absolute left-3 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="sidebar-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск канала или чата…"
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg bg-[#2a2a3e] text-white placeholder:text-[#8990b3] border border-transparent focus:border-blue-500 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Channels & DMs */}
      <div className="flex-1 overflow-y-auto thin-scrollbar px-2.5 py-3 space-y-5">
        <section aria-label="Каналы компании">
          <div className="px-2 mb-1.5 flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-[#8990b3]">
              Объявления и общие
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onOpenChannelDirectory}
                aria-label="Обзор корпоративных каналов"
                title={`Каталог каналов (${availableChannelCount})`}
                className="p-1 rounded hover:bg-[#2a2a3e] text-[#8990b3] hover:text-white transition-colors"
              >
                <Compass className="w-4 h-4" />
              </button>
              {allowCreateChannel && (
                <button
                  type="button"
                  onClick={onOpenCreateRoom}
                  aria-label="Создать канал"
                  className="p-1 rounded hover:bg-[#2a2a3e] text-[#8990b3] hover:text-white transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-0.5">
            {primaryChannels.map((c) => (
              <ChannelRow
                key={c.id}
                conv={c}
                isActive={viewMode === 'chat' && c.id === activeId}
                onSelect={onSelectConversation}
              />
            ))}
          </div>

          {teamChannels.length > 0 && (
            <div className="mt-3">
              <div className="px-2 mb-1 text-[11px] font-medium text-[#8990b3]">
                Департаменты и проекты
              </div>
              <div className="space-y-0.5">
                {teamChannels.map((c) => (
                  <ChannelRow
                    key={c.id}
                    conv={c}
                    isActive={viewMode === 'chat' && c.id === activeId}
                    onSelect={onSelectConversation}
                  />
                ))}
              </div>
            </div>
          )}

          {primaryChannels.length === 0 && teamChannels.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-[#6c7086]">
              Каналы не найдены
            </p>
          )}
        </section>

        <section aria-label="Прямые сообщения">
          <div className="px-2 mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-[#8990b3]">
              Сотрудники (Double Ratchet)
            </span>
          </div>
          <div className="space-y-0.5">
            {dms.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-[#6c7086]">
                Собеседники не найдены
              </p>
            ) : (
              dms.map((c) => (
                <DmRow
                  key={c.id}
                  conv={c}
                  isActive={viewMode === 'chat' && c.id === activeId}
                  onSelect={onSelectConversation}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {/* Enterprise Admin Panel Entry (Strictly hidden for non-admin roles) */}
      {showAdminEntry && (
        <div className="px-2.5 py-2 border-t border-white/10">
          <button
            type="button"
            onClick={onOpenAdminPanel}
            aria-current={viewMode === 'admin' ? 'page' : undefined}
            className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-xs font-medium transition-colors whitespace-nowrap ${
              viewMode === 'admin'
                ? 'bg-blue-600 text-white'
                : 'text-[#cdd6f4] hover:bg-[#2a2a3e]'
            }`}
          >
            <span className="flex items-center gap-2">
              <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Панель администратора</span>
            </span>
            <span className="text-[10px] opacity-80">
              {ROLE_LABELS[currentUserRole]}
            </span>
          </button>
        </div>
      )}

      {/* User profile & Presence */}
      <div className="relative px-3 py-2.5 border-t border-white/10 bg-black/20">
        {presenceOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-[#252538] border border-white/10 rounded-xl shadow-xl py-1.5 z-50">
            <div className="px-3 py-1 text-[10px] font-medium text-[#8990b3]">
              Статус присутствия
            </div>
            {PRESENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChangePresence(opt.value);
                  setPresenceOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[#363654] text-[#cdd6f4] transition-colors"
              >
                <span className={`w-2 h-2 rounded-full ${opt.dotClass}`} />
                <span>{opt.label}</span>
              </button>
            ))}

            <div className="my-1 border-t border-white/10" />
            <div className="px-3 py-1 text-[10px] font-medium text-[#8990b3]">
              Учётная запись (SSO-профиль)
            </div>
            {(
              [
                'member',
                'moderator',
                'security_officer',
                'admin',
                'guest',
              ] as EnterpriseRole[]
            ).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onSwitchRole(r);
                  setPresenceOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between hover:bg-[#363654] transition-colors ${
                  currentUserRole === r ? 'text-blue-400 font-medium' : 'text-[#cdd6f4]'
                }`}
              >
                <span>{ROLE_LABELS[r]}</span>
                {currentUserRole === r && <span>✓</span>}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPresenceOpen((o) => !o)}
            aria-expanded={presenceOpen}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg p-1 hover:bg-[#2a2a3e] transition-colors"
          >
            <div className="relative w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {localUserId.slice(-2).toUpperCase()}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#1e1e2e] ${currentPresence.dotClass}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white truncate font-mono">
                ID {localUserId.slice(-6)}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-[#8990b3]">
                <span className="truncate">
                  {currentPresence.label} · {ROLE_LABELS[currentUserRole]}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </div>
            </div>
          </button>

          <span className="text-[11px] text-[#8990b3] shrink-0">
            {wsConnected ? 'WS активен' : 'Офлайн'}
          </span>
        </div>
      </div>
    </aside>
  );
});
