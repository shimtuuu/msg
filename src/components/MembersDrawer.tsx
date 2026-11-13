import React, { useMemo, useState } from 'react';
import { MessageSquare, Search, ShieldCheck, Users, X } from 'lucide-react';
import type { ConversationMeta } from '../types/messenger';
import { ROLE_LABELS } from '../utils/enterpriseAdmin';

interface MembersDrawerProps {
  open: boolean;
  onClose: () => void;
  activeConversation: ConversationMeta | null;
  peers: ConversationMeta[];
  onStartDirectMessage: (peerId: string) => void;
}

export function MembersDrawer({
  open,
  onClose,
  activeConversation,
  peers,
  onStartDirectMessage,
}: MembersDrawerProps) {
  const [query, setQuery] = useState('');

  const members = useMemo(() => {
    if (!activeConversation) return [];
    const baseList =
      activeConversation.kind === 'dm'
        ? [activeConversation]
        : peers.filter((p) => {
            if (!activeConversation.memberIds || activeConversation.memberIds.length === 0) {
              return true;
            }
            return activeConversation.memberIds.includes(p.id);
          });

    const q = query.trim().toLowerCase();
    if (!q) return baseList;
    return baseList.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.subtitle.toLowerCase().includes(q) ||
        (m.department ?? '').toLowerCase().includes(q)
    );
  }, [activeConversation, peers, query]);

  if (!open) return null;

  return (
    <aside
      aria-label="Участники переписки"
      data-testid="members-drawer"
      className="w-full sm:w-[320px] shrink-0 h-full bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 flex flex-col"
    >
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              Участники
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              В составе: {members.length}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть список участников"
          className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 flex items-center justify-center text-slate-500 dark:text-slate-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по имени или отделу…"
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-slate-100/80 dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar divide-y divide-slate-100 dark:divide-slate-800/80">
        {members.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-400">
            Участники не найдены
          </p>
        ) : (
          members.map((m) => {
            const presenceDot =
              m.presence === 'online'
                ? 'bg-emerald-500'
                : m.presence === 'away'
                ? 'bg-amber-500'
                : m.presence === 'dnd'
                ? 'bg-rose-500'
                : 'bg-slate-400';
            const roleLabel = m.enterpriseRole
              ? ROLE_LABELS[m.enterpriseRole]
              : 'Сотрудник';

            return (
              <div
                key={m.id}
                className="px-3.5 py-3 flex items-start justify-between gap-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-900/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${presenceDot}`}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      {m.name}
                    </span>
                    {m.verified && (
                      <ShieldCheck
                        className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                        aria-label="Ключ подтверждён"
                      />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {m.subtitle}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                    {m.department ?? 'Корпоративный офис'} · {roleLabel}
                  </p>
                </div>

                {activeConversation?.kind !== 'dm' && (
                  <button
                    type="button"
                    onClick={() => onStartDirectMessage(m.id)}
                    aria-label={`Написать ${m.name}`}
                    className="h-7 px-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>ЛС</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
