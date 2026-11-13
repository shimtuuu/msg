import React, { useEffect, useState } from 'react';
import { Lock, Megaphone, X } from 'lucide-react';
import type { ChannelCategory, ConversationMeta } from '../types/messenger';

interface ChannelSettingsModalProps {
  open: boolean;
  channel: ConversationMeta | null;
  peers: ConversationMeta[];
  localUserId: string;
  onClose: () => void;
  onSave: (payload: {
    roomId: string;
    description: string;
    topic: string;
    department: string;
    category: ChannelCategory;
    onlyAdminsCanPost: boolean;
    isArchived: boolean;
    memberIds: string[];
  }) => void;
}

export function ChannelSettingsModal({
  open,
  channel,
  peers,
  localUserId,
  onClose,
  onSave,
}: ChannelSettingsModalProps) {
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState<ChannelCategory>('department');
  const [onlyAdminsCanPost, setOnlyAdminsCanPost] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!channel || !open) return;
    setDescription(channel.subtitle || '');
    setTopic(channel.topic || '');
    setDepartment(channel.department || 'Вся компания');
    setCategory(channel.category || 'department');
    setOnlyAdminsCanPost(Boolean(channel.onlyAdminsCanPost));
    setIsArchived(Boolean(channel.isArchived));
    setSelectedMembers(new Set(channel.memberIds ?? []));
  }, [channel, open]);

  if (!open || !channel) return null;

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const members = new Set(selectedMembers);
    if (localUserId) members.add(localUserId);
    onSave({
      roomId: channel.id,
      description: description.trim(),
      topic: topic.trim(),
      department: department.trim(),
      category,
      onlyAdminsCanPost,
      isArchived,
      memberIds: Array.from(members),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-settings-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2
              id="channel-settings-title"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5"
            >
              {channel.kind === 'private' ? (
                <Lock className="w-4 h-4 text-blue-600 shrink-0" />
              ) : (
                <Megaphone className="w-4 h-4 text-blue-600 shrink-0" />
              )}
              <span>Параметры канала #{channel.name}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Корпоративное управление доступом и регламентами публикации
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки канала"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto thin-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-room-dept"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Департамент
              </label>
              <input
                id="edit-room-dept"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="edit-room-category"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Категория канала
              </label>
              <select
                id="edit-room-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ChannelCategory)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="announcement">Объявления</option>
                <option value="department">Департамент</option>
                <option value="project">Проект / Рабочая группа</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-room-topic"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Закреплённая тема (Topic)
            </label>
            <input
              id="edit-room-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Краткий регламент, ссылки на Runbook или SLA…"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="edit-room-desc"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Описание канала
            </label>
            <input
              id="edit-room-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            <label className="p-3 flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  Только администраторы и модераторы могут писать
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Подходит для официальных объявлений; сотрудники могут читать и ставить реакции
                </div>
              </div>
              <input
                type="checkbox"
                checked={onlyAdminsCanPost}
                onChange={(e) => setOnlyAdminsCanPost(e.target.checked)}
                className="w-4 h-4 accent-blue-600 shrink-0"
              />
            </label>

            <label className="p-3 flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  Архивировать канал (только чтение)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Замораживает новые отправки с сохранением истории переписки
                </div>
              </div>
              <input
                type="checkbox"
                checked={isArchived}
                onChange={(e) => setIsArchived(e.target.checked)}
                className="w-4 h-4 accent-blue-600 shrink-0"
              />
            </label>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Участники канала ({selectedMembers.size})
            </div>
            <div className="max-h-40 overflow-y-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {peers.map((peer) => {
                const checked = selectedMembers.has(peer.id);
                return (
                  <label
                    key={peer.id}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {peer.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {peer.department ?? 'Сотрудник'} · {peer.subtitle}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMember(peer.id)}
                      className="w-4 h-4 accent-blue-600 shrink-0"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
            >
              Сохранить изменения
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
