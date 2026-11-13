import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  FileLock2,
  Lock,
  MessageSquare,
  Mic,
  Send,
  SmilePlus,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types/messenger';
import { formatThreadReplyCount } from '../utils/threads';
import { getReactionSummaries, REACTION_EMOJIS } from '../utils/reactions';
import { isVoiceAttachment } from '../utils/voice';

interface ThreadDrawerProps {
  open: boolean;
  rootMessage: ChatMessage | null;
  replies: ChatMessage[];
  localUserId: string;
  conversationName: string;
  disabled: boolean;
  isArchived?: boolean;
  isSuspended?: boolean;
  onlyAdminsCanPost?: boolean;
  canPost?: boolean;
  onClose: () => void;
  onSendThreadReply: (text: string, threadRootId: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ThreadDrawer({
  open,
  rootMessage,
  replies,
  localUserId,
  conversationName,
  disabled,
  isArchived = false,
  isSuspended = false,
  onlyAdminsCanPost = false,
  canPost = true,
  onClose,
  onSendThreadReply,
  onToggleReaction,
}: ThreadDrawerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [openPickerForId, setOpenPickerForId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, replies.length, rootMessage?.id]);

  useEffect(() => {
    setOpenPickerForId(null);
  }, [rootMessage?.id, open]);

  if (!open || !rootMessage) return null;

  const effectiveDisabled = disabled || isArchived || isSuspended || !canPost;
  const rootCounter =
    rootMessage.dmEnvelope?.counter ?? rootMessage.groupEnvelope?.iteration ?? 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || effectiveDisabled || sending) return;
    setSending(true);
    try {
      await onSendThreadReply(trimmed, rootMessage.id);
      setText('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <aside
      aria-label="Вложенный тред обсуждения"
      data-testid="thread-drawer"
      className="w-full md:w-[380px] lg:w-[420px] shrink-0 h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 truncate">
            <MessageSquare className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <span>Тред · {conversationName}</span>
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Сквозное шифрование · ветка обсуждения
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть тред"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Thread Content */}
      <div
        ref={listRef}
        data-testid="thread-replies-list"
        className="flex-1 overflow-y-auto thin-scrollbar p-4 space-y-4"
      >
        {/* Root Parent Message Card */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {rootMessage.senderId === localUserId ? 'Вы' : rootMessage.senderName}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" aria-hidden="true" />
              #{rootCounter} · {formatTime(rootMessage.timestamp)}
            </span>
          </div>

          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
            {rootMessage.isDeleted ? 'Сообщение удалено' : rootMessage.text}
          </p>

          {rootMessage.attachment && !rootMessage.isDeleted && (
            <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              {isVoiceAttachment(rootMessage.attachment) ? (
                <>
                  <Mic className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Голосовое сообщение</span>
                </>
              ) : (
                <>
                  <FileLock2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{rootMessage.attachment.fileName}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span className="whitespace-nowrap font-mono tabular-nums">
            {replies.length > 0
              ? `Ответы в треде · ${formatThreadReplyCount(replies.length)}`
              : 'Ответов пока нет'}
          </span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        {/* Thread Replies */}
        {replies.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
            Начните обсуждение этого сообщения в отдельном зашифрованном треде — ответы не перегружают основную ленту.
          </p>
        ) : (
          <div className="space-y-3">
            {replies.map((reply) => {
              const isOwn = reply.senderId === localUserId;
              const counter =
                reply.dmEnvelope?.counter ?? reply.groupEnvelope?.iteration ?? 0;
              const reactions = getReactionSummaries(reply.reactions, localUserId);
              const pickerOpen = openPickerForId === reply.id;

              return (
                <div
                  key={reply.id}
                  data-testid={`thread-reply-${reply.id}`}
                  className="group relative rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {isOwn ? 'Вы' : reply.senderName}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPickerForId((curr) =>
                            curr === reply.id ? null : reply.id
                          )
                        }
                        aria-label="Добавить реакцию к ответу"
                        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <SmilePlus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 inline-flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                        <span>#{counter}</span>
                        <span>·</span>
                        <span>{formatTime(reply.timestamp)}</span>
                        {isOwn && (
                          <span aria-label={reply.status}>
                            {reply.status === 'read' ? (
                              <CheckCheck className="w-3 h-3 text-blue-600" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {pickerOpen && (
                    <div className="flex items-center gap-1 p-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 w-fit">
                      {REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            onToggleReaction(reply.id, emoji);
                            setOpenPickerForId(null);
                          }}
                          className="w-7 h-7 rounded hover:bg-white dark:hover:bg-slate-800 text-sm flex items-center justify-center"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                    {reply.isDeleted ? 'Сообщение удалено' : reply.text}
                  </p>

                  {reactions.length > 0 && (
                    <div className="pt-1 flex flex-wrap gap-1">
                      {reactions.map((r) => (
                        <button
                          key={r.emoji}
                          type="button"
                          onClick={() => onToggleReaction(reply.id, r.emoji)}
                          aria-pressed={r.reactedByMe}
                          className={`h-6 px-2 rounded-lg border text-xs font-mono tabular-nums inline-flex items-center gap-1 ${
                            r.reactedByMe
                              ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-700 dark:text-blue-300'
                              : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span>{r.emoji}</span>
                          <span>{r.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Thread Composer */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950"
      >
        {(isArchived || isSuspended || !canPost) && (
          <div className="mb-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300">
            {isSuspended
              ? 'Учётная запись заблокирована.'
              : isArchived
              ? 'Канал в архиве (только чтение).'
              : onlyAdminsCanPost
              ? 'В канале объявлений отвечать в треде могут только администраторы и модераторы.'
              : 'Отправка сообщений недоступна.'}
          </div>
        )}

        <div className="flex items-end gap-2">
          <label htmlFor="thread-composer" className="sr-only">
            Ответить в треде
          </label>
          <textarea
            id="thread-composer"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={effectiveDisabled}
            placeholder={
              effectiveDisabled
                ? 'Отправка недоступна…'
                : 'Ответить в треде…'
            }
            className="flex-1 min-w-0 h-10 min-h-[40px] max-h-28 resize-none rounded-xl bg-white dark:bg-slate-900 px-3 py-2 text-sm leading-5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 border border-slate-200 dark:border-slate-800 focus:border-blue-600 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={effectiveDisabled || sending || !text.trim()}
            aria-label="Отправить ответ в тред"
            className="h-10 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Отправить</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
