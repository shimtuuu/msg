import React, { useMemo, useState } from 'react';
import {
  Archive,
  Hash,
  Lock,
  Megaphone,
  Search,
  Users,
  X,
} from 'lucide-react';
import type { ConversationMeta } from '../types/messenger';

interface ChannelDirectoryModalProps {
  open: boolean;
  onClose: () => void;
  channels: ConversationMeta[];
  onJoinChannel: (roomId: string) => void;
  onLeaveChannel: (roomId: string) => void;
  onOpenChannel: (roomId: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  announcement: 'Объявления',
  department: 'Департамент',
  project: 'Проект',
};

export function ChannelDirectoryModal({
  open,
  onClose,
  channels,
  onJoinChannel,
  onLeaveChannel,
  onOpenChannel,
}: ChannelDirectoryModalProps) {
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) {
      if (c.department) set.add(c.department);
    }
    return Array.from(set).sort();
  }, [channels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (departmentFilter !== 'all' && c.department !== departmentFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        (c.topic ?? '').toLowerCase().includes(q) ||
        (c.department ?? '').toLowerCase().includes(q)
      );
    });
  }, [channels, query, departmentFilter]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-directory-title"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2
              id="channel-directory-title"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Каталог корпоративных каналов
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Выберите каналы по департаментам или проектам для общения с командой
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть каталог каналов"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию, теме или отделу…"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            aria-label="Фильтр каналов по департаменту"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-200"
          >
            <option value="all">Все департаменты</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto thin-scrollbar divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Подходящие каналы не найдены
            </p>
          ) : (
            filtered.map((ch) => {
              const joined = ch.isJoined !== false;
              const memberCount = ch.memberIds?.length ?? 0;
              return (
                <div
                  key={ch.id}
                  data-testid={`directory-channel-${ch.id}`}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {ch.isArchived ? (
                        <Archive className="w-4 h-4 text-slate-400 shrink-0" />
                      ) : ch.category === 'announcement' ? (
                        <Megaphone className="w-4 h-4 text-blue-600 shrink-0" />
                      ) : ch.kind === 'private' ? (
                        <Lock className="w-4 h-4 text-blue-600 shrink-0" />
                      ) : (
                        <Hash className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {ch.name}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        · {CATEGORY_LABELS[ch.category ?? 'project'] ?? 'Канал'}
                        {ch.department ? ` · ${ch.department}` : ''}
                      </span>
                    </div>

                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 truncate">
                      {ch.topic || ch.subtitle}
                    </p>

                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {memberCount} уч.
                      </span>
                      {ch.onlyAdminsCanPost && <span>· Только объявления (чтение)</span>}
                      {ch.isArchived && <span>· Архив</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {joined ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onOpenChannel(ch.id);
                            onClose();
                          }}
                          className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                        >
                          Открыть
                        </button>
                        {ch.id !== 'room-announcements' && (
                          <button
                            type="button"
                            onClick={() => onLeaveChannel(ch.id)}
                            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                          >
                            Покинуть
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onJoinChannel(ch.id);
                          onOpenChannel(ch.id);
                          onClose();
                        }}
                        className="h-8 px-3.5 rounded-lg bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                      >
                        Присоединиться
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
