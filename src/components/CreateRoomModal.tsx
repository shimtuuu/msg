import React, { useState } from 'react';
import { Hash, Lock, X } from 'lucide-react';
import type { ChannelCategory } from '../types/messenger';

interface CreateRoomModalProps {
  open: boolean;
  canSetReadOnly?: boolean;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    description: string;
    topic: string;
    department: string;
    category: ChannelCategory;
    kind: 'channel' | 'private';
    onlyAdminsCanPost: boolean;
  }) => void;
}

const DEPARTMENT_PRESETS = [
  'Вся компания',
  'Платформенная разработка',
  'Облачная инфраструктура',
  'Информационная безопасность',
  'Юридический департамент',
  'Финансы и закупки',
  'HR и управление персоналом',
];

export function CreateRoomModal({
  open,
  canSetReadOnly = false,
  onClose,
  onCreate,
}: CreateRoomModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [department, setDepartment] = useState('Платформенная разработка');
  const [category, setCategory] = useState<ChannelCategory>('project');
  const [kind, setKind] = useState<'channel' | 'private'>('channel');
  const [onlyAdminsCanPost, setOnlyAdminsCanPost] = useState(false);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      topic: topic.trim(),
      department: department.trim(),
      category,
      kind,
      onlyAdminsCanPost: canSetReadOnly ? onlyAdminsCanPost : false,
    });
    setName('');
    setDescription('');
    setTopic('');
    setDepartment('Платформенная разработка');
    setCategory('project');
    setKind('channel');
    setOnlyAdminsCanPost(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2
            id="create-room-title"
            className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Создать зашифрованный канал
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          <div>
            <label
              htmlFor="room-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Название канала
            </label>
            <input
              id="room-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="например, release-q4"
              required
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="room-department"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Департамент
              </label>
              <select
                id="room-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {DEPARTMENT_PRESETS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="room-category"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Назначение
              </label>
              <select
                id="room-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ChannelCategory)}
                className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="project">Проектный</option>
                <option value="department">Департамент</option>
                {canSetReadOnly && <option value="announcement">Объявления</option>}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="room-topic"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Тема и регламент
            </label>
            <input
              id="room-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Координация релизов, дежурные, ссылки…"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="room-desc"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Описание
            </label>
            <input
              id="room-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое описание канала…"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setKind('channel')}
              className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                kind === 'channel'
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              <span>Публичный</span>
            </button>
            <button
              type="button"
              onClick={() => setKind('private')}
              className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                kind === 'private'
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Приватный</span>
            </button>
          </div>

          {canSetReadOnly && (
            <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer">
              <span className="text-xs text-slate-700 dark:text-slate-300">
                Публиковать могут только администраторы и модераторы
              </span>
              <input
                type="checkbox"
                checked={onlyAdminsCanPost}
                onChange={(e) => setOnlyAdminsCanPost(e.target.checked)}
                className="w-4 h-4 accent-blue-600 shrink-0"
              />
            </label>
          )}

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
              Создать канал
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
