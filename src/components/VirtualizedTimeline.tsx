import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Check,
  CheckCheck,
  Download,
  Edit3,
  FileLock2,
  Lock,
  MessageSquare,
  Mic,
  Pin,
  Play,
  Reply,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types/messenger';
import {
  buildVirtualLayout,
  computeVisibleRange,
  estimateMessageHeight,
} from '../utils/virtualizer';
import { decryptAttachment } from '../crypto/attachmentCrypto';
import {
  getReactionSummaries,
  REACTION_EMOJIS,
} from '../utils/reactions';
import {
  formatThreadReplyCount,
  type ThreadSummary,
} from '../utils/threads';
import { isVoiceAttachment } from '../utils/voice';

interface VirtualizedTimelineProps {
  messages: ChatMessage[];
  localUserId: string;
  conversationName: string;
  allowAttachmentDownload?: boolean;
  highlightedMessageId?: string | null;
  threadSummaries?: Record<string, ThreadSummary>;
  activeThreadRootId?: string | null;
  onReply: (message: ChatMessage) => void;
  onOpenThread: (message: ChatMessage) => void;
  onEdit: (messageId: string, newText: string) => Promise<void>;
  onDelete: (messageId: string) => void;
  onTogglePin: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onRenderedNodesChange?: (count: number) => void;
}

function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

interface MessageRowProps {
  message: ChatMessage;
  localUserId: string;
  isOwn: boolean;
  isGroupHead: boolean;
  isHighlighted: boolean;
  preferPopoverBelow: boolean;
  allowAttachmentDownload: boolean;
  threadSummary?: ThreadSummary;
  isThreadActive: boolean;
  onMeasure: (id: string, height: number) => void;
  onReply: (message: ChatMessage) => void;
  onOpenThread: (message: ChatMessage) => void;
  onEdit: (messageId: string, newText: string) => Promise<void>;
  onDelete: (messageId: string) => void;
  onTogglePin: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
}

const MessageRow = React.memo(
  function MessageRow({
    message,
    localUserId,
    isOwn,
    isGroupHead,
    isHighlighted,
    preferPopoverBelow,
    allowAttachmentDownload,
    threadSummary,
    isThreadActive,
    onMeasure,
    onReply,
    onOpenThread,
    onEdit,
    onDelete,
    onTogglePin,
    onToggleReaction,
  }: MessageRowProps) {
    const rowRef = useRef<HTMLDivElement>(null);
    const pickerContainerRef = useRef<HTMLDivElement>(null);
    const [downloading, setDownloading] = useState(false);
    const [decryptedAudioUrl, setDecryptedAudioUrl] = useState<string | null>(null);
    const [attError, setAttError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(message.text);
    const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
    const audioUrlRef = useRef<string | null>(null);

    useEffect(() => {
      return () => {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (!reactionPickerOpen) return;
      const handlePointerDown = (e: PointerEvent) => {
        if (
          pickerContainerRef.current &&
          !pickerContainerRef.current.contains(e.target as Node)
        ) {
          setReactionPickerOpen(false);
        }
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setReactionPickerOpen(false);
        }
      };
      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('pointerdown', handlePointerDown);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [reactionPickerOpen]);

    useLayoutEffect(() => {
      const el = rowRef.current;
      if (!el) return;
      const measure = () => {
        const h = el.getBoundingClientRect().height;
        if (h > 0) onMeasure(message.id, h);
      };
      measure();

      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }, [
      message.id,
      message.text,
      message.isDeleted,
      message.reactions,
      threadSummary?.replyCount,
      decryptedAudioUrl,
      isEditing,
      onMeasure,
    ]);

    const handleDownloadAttachment = async () => {
      if (!message.attachment || downloading) return;
      if (!allowAttachmentDownload) {
        setAttError('Скачивание вложений запрещено политикой DLP для вашей роли');
        return;
      }
      setDownloading(true);
      setAttError(null);
      try {
        const plainBytes = await decryptAttachment(message.attachment);
        const blob = new Blob([plainBytes], { type: message.attachment.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = message.attachment.fileName;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setAttError(
          err instanceof Error ? err.message : 'Ошибка расшифровки файла'
        );
      } finally {
        setDownloading(false);
      }
    };

    const handleDecryptVoice = async () => {
      if (!message.attachment || downloading) return;
      if (!allowAttachmentDownload) {
        setAttError('Воспроизведение вложений запрещено политикой DLP для вашей роли');
        return;
      }
      setDownloading(true);
      setAttError(null);
      try {
        const plainBytes = await decryptAttachment(message.attachment);
        const blob = new Blob([plainBytes], { type: message.attachment.mimeType });
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        setDecryptedAudioUrl(url);
      } catch (err) {
        setAttError(
          err instanceof Error ? err.message : 'Ошибка расшифровки аудиозаписи'
        );
      } finally {
        setDownloading(false);
      }
    };

    const handleSaveEdit = async () => {
      const trimmed = editText.trim();
      if (!trimmed || trimmed === message.text) {
        setIsEditing(false);
        return;
      }
      await onEdit(message.id, trimmed);
      setIsEditing(false);
    };

    const counter =
      message.dmEnvelope?.counter ?? message.groupEnvelope?.iteration ?? 0;

    return (
      <div
        ref={rowRef}
        id={`message-${message.id}`}
        data-message-id={message.id}
        className={`virtual-row-contain group relative px-4 sm:px-6 ${
          isGroupHead ? 'pt-3' : 'pt-1'
        } pb-1 flex ${isOwn ? 'justify-end' : 'justify-start'} ${
          isHighlighted ? 'bg-amber-50/70 dark:bg-amber-950/25' : ''
        }`}
      >
        <div
          className={`relative max-w-[85%] sm:max-w-[72%] lg:max-w-[64%] flex flex-col ${
            isOwn ? 'items-end' : 'items-start'
          }`}
        >
          {isGroupHead && (
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
              {isOwn ? 'Вы' : message.senderName}
            </span>
          )}

          {/* Hover & popover actions */}
          {!message.isDeleted && !isEditing && !message.isBenchmark && (
            <div
              ref={pickerContainerRef}
              className={`${
                reactionPickerOpen
                  ? 'opacity-100'
                  : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100'
              } transition-opacity duration-150 absolute -top-3 ${
                isOwn ? 'right-0' : 'left-0'
              } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm flex items-center p-0.5 z-20`}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setReactionPickerOpen((v) => !v)}
                  aria-label="Добавить реакцию"
                  aria-expanded={reactionPickerOpen}
                  aria-haspopup="dialog"
                  className={`p-1 rounded transition-colors ${
                    reactionPickerOpen
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <SmilePlus className="w-3.5 h-3.5" />
                </button>

                {reactionPickerOpen && (
                  <div
                    role="dialog"
                    aria-label="Выбор реакции"
                    data-testid="reaction-popover"
                    className={`absolute ${
                      preferPopoverBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                    } ${
                      isOwn ? 'right-0' : 'left-0'
                    } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-1.5 flex items-center gap-1 z-30`}
                  >
                    {REACTION_EMOJIS.map((emoji) => {
                      const reacted = Boolean(
                        message.reactions?.[emoji]?.includes(localUserId)
                      );
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            onToggleReaction(message.id, emoji);
                            setReactionPickerOpen(false);
                          }}
                          aria-label={`Реакция ${emoji}`}
                          aria-pressed={reacted}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors shrink-0 ${
                            reacted
                              ? 'bg-blue-50 dark:bg-blue-950/70 ring-1 ring-blue-500'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onReply(message)}
                aria-label="Ответить на сообщение"
                className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Reply className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                aria-label="Обсудить в треде"
                title="Открыть обсуждение в треде"
                className={`p-1 rounded transition-colors ${
                  isThreadActive
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onTogglePin(message.id)}
                aria-label={message.isPinned ? 'Открепить сообщение' : 'Закрепить сообщение'}
                className={`p-1 rounded ${
                  message.isPinned
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
              {isOwn && (
                <button
                  type="button"
                  onClick={() => {
                    setEditText(message.text);
                    setIsEditing(true);
                  }}
                  aria-label="Редактировать сообщение"
                  className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(message.id)}
                aria-label="Удалить сообщение"
                className="p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div
            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${
              message.isDeleted
                ? 'bg-slate-100 dark:bg-slate-900 text-slate-400 italic border border-slate-200 dark:border-slate-800'
                : isOwn
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200/90 dark:border-slate-800 rounded-bl-sm'
            }`}
          >
            {message.replyTo && !message.isDeleted && (
              <div
                className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs ${
                  isOwn
                    ? 'bg-blue-700/60 text-blue-50'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <div className="font-medium truncate">
                  Ответ для {message.replyTo.senderName}
                </div>
                <div className="opacity-85 truncate">{message.replyTo.text}</div>
              </div>
            )}

            {isEditing ? (
              <div className="space-y-2 min-w-[220px]">
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveEdit();
                    if (e.key === 'Escape') setIsEditing(false);
                  }}
                  aria-label="Новый текст сообщения"
                  autoFocus
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs text-slate-900 bg-white border border-blue-300 focus:outline-none"
                />
                <div className="flex justify-end gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 inline-flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    <span>Отмена</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveEdit()}
                    className="px-2 py-1 rounded bg-white text-blue-700 font-medium inline-flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" />
                    <span>Сохранить</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{message.text}</p>
            )}

            {message.attachment && !message.isDeleted && (
              <div
                data-testid="message-attachment"
                className={`mt-2 pt-2 border-t space-y-2 ${
                  isOwn
                    ? 'border-blue-500/60'
                    : 'border-slate-100 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {isVoiceAttachment(message.attachment) ? (
                      <Mic className="w-4 h-4 shrink-0 opacity-85" aria-hidden="true" />
                    ) : (
                      <FileLock2 className="w-4 h-4 shrink-0 opacity-85" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      {!isVoiceAttachment(message.attachment) && (
                        <p className="text-xs font-medium truncate">
                          {message.attachment.fileName}
                        </p>
                      )}
                      <p className="text-[11px] opacity-75 font-mono tabular-nums">
                        {formatBytes(message.attachment.originalSize)} · AES-GCM + HMAC
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isVoiceAttachment(message.attachment) && !decryptedAudioUrl && (
                      <button
                        type="button"
                        onClick={handleDecryptVoice}
                        disabled={downloading || !allowAttachmentDownload}
                        aria-label="Расшифровать и прослушать голосовое сообщение"
                        className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 shrink-0 transition-colors disabled:opacity-50 ${
                          isOwn
                            ? 'bg-white/20 hover:bg-white/30 text-white'
                            : 'bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{downloading ? '…' : 'Прослушать'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDownloadAttachment}
                      disabled={downloading || !allowAttachmentDownload}
                      aria-label={
                        isVoiceAttachment(message.attachment)
                          ? 'Расшифровать и скачать голосовое сообщение'
                          : `Расшифровать и скачать ${message.attachment.fileName}`
                      }
                      className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 shrink-0 transition-colors disabled:opacity-50 ${
                        isOwn
                          ? 'bg-white/15 hover:bg-white/25 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {!allowAttachmentDownload
                          ? 'Запрещено DLP'
                          : downloading
                          ? '…'
                          : 'Скачать'}
                      </span>
                    </button>
                  </div>
                </div>

                {decryptedAudioUrl && (
                  <audio
                    controls
                    src={decryptedAudioUrl}
                    data-testid="decrypted-voice-player"
                    aria-label={`Аудиоплеер ${message.attachment.fileName}`}
                    className="h-8 w-full max-w-xs rounded"
                  />
                )}
              </div>
            )}

            {attError && (
              <p className="mt-1.5 text-xs text-rose-200 dark:text-rose-400">
                {attError}
              </p>
            )}

            <div
              className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] font-mono tabular-nums ${
                message.isDeleted
                  ? 'text-slate-400'
                  : isOwn
                  ? 'text-blue-100/85'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {message.isPinned && (
                <>
                  <span>Закреплено</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              {message.isEdited && !message.isDeleted && (
                <>
                  <span>изменено</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <Lock className="w-2.5 h-2.5 opacity-80" aria-hidden="true" />
              <span>#{counter}</span>
              <span aria-hidden="true">·</span>
              <span>{formatMessageTime(message.timestamp)}</span>
              {isOwn && !message.isDeleted && (
                <span className="inline-flex items-center" aria-label={message.status}>
                  {message.status === 'read' ? (
                    <CheckCheck className="w-3.5 h-3.5" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                </span>
              )}
            </div>
          </div>

          {!message.isDeleted && threadSummary && threadSummary.replyCount > 0 && (
            <button
              type="button"
              data-testid="thread-summary-btn"
              onClick={() => onOpenThread(message)}
              aria-expanded={isThreadActive}
              className={`mt-1.5 px-2.5 py-1 rounded-xl border text-xs inline-flex items-center gap-1.5 transition-colors max-w-full ${
                isThreadActive
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <MessageSquare
                className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0"
                aria-hidden="true"
              />
              <span className="font-medium font-mono tabular-nums whitespace-nowrap">
                {formatThreadReplyCount(threadSummary.replyCount)}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                ·
              </span>
              <span className="truncate text-slate-500 dark:text-slate-400">
                {threadSummary.lastReplySender}
              </span>
            </button>
          )}

          {!message.isDeleted && message.reactions && (
            <div
              data-testid="message-reactions"
              className={`mt-1.5 flex flex-wrap items-center gap-1 ${
                isOwn ? 'justify-end' : 'justify-start'
              }`}
            >
              {getReactionSummaries(message.reactions, localUserId).map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onToggleReaction(message.id, r.emoji)}
                  aria-pressed={r.reactedByMe}
                  aria-label={`Реакция ${r.emoji}: ${r.count}`}
                  className={`h-6 px-2 rounded-lg border text-xs font-mono tabular-nums inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    r.reactedByMe
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="text-sm leading-none">{r.emoji}</span>
                  <span>{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.localUserId === next.localUserId &&
    prev.isOwn === next.isOwn &&
    prev.isGroupHead === next.isGroupHead &&
    prev.isHighlighted === next.isHighlighted &&
    prev.preferPopoverBelow === next.preferPopoverBelow &&
    prev.allowAttachmentDownload === next.allowAttachmentDownload &&
    prev.threadSummary === next.threadSummary &&
    prev.isThreadActive === next.isThreadActive
);

export function VirtualizedTimeline({
  messages,
  localUserId,
  conversationName,
  allowAttachmentDownload = true,
  highlightedMessageId,
  threadSummaries,
  activeThreadRootId,
  onReply,
  onOpenThread,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleReaction,
  onRenderedNodesChange,
}: VirtualizedTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [measureVersion, setMeasureVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [stickToBottom, setStickToBottom] = useState(true);
  const rafRef = useRef<number | null>(null);
  const measureBatchRef = useRef<number | null>(null);

  const handleMeasure = useCallback((id: string, height: number) => {
    const prev = measuredHeightsRef.current.get(id);
    if (prev !== undefined && Math.abs(prev - height) < 1) return;
    measuredHeightsRef.current.set(id, height);
    if (measureBatchRef.current === null) {
      measureBatchRef.current = requestAnimationFrame(() => {
        measureBatchRef.current = null;
        setMeasureVersion((v) => v + 1);
      });
    }
  }, []);

  const groupHeads = useMemo(() => {
    const heads = new Array<boolean>(messages.length);
    for (let i = 0; i < messages.length; i++) {
      if (i === 0) {
        heads[i] = true;
      } else {
        const prev = messages[i - 1];
        const curr = messages[i];
        heads[i] =
          prev.senderId !== curr.senderId ||
          Boolean(curr.replyTo) ||
          curr.timestamp - prev.timestamp > 5 * 60 * 1000;
      }
    }
    return heads;
  }, [messages]);

  const layout = useMemo(() => {
    const heights = new Array<number>(messages.length);
    const cache = measuredHeightsRef.current;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      heights[i] =
        cache.get(m.id) ??
        estimateMessageHeight(
          m.text,
          Boolean(m.attachment) ||
            Boolean(m.replyTo) ||
            Boolean(threadSummaries?.[m.id]),
          groupHeads[i]
        );
    }
    return buildVirtualLayout(heights);
  }, [messages, groupHeads, threadSummaries, measureVersion]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => setViewportHeight(el.clientHeight);
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll cleanly to highlighted message inside virtualized list using exact O(1) offset!
  useEffect(() => {
    if (!highlightedMessageId || !containerRef.current) return;
    const idx = messages.findIndex((m) => m.id === highlightedMessageId);
    if (idx >= 0) {
      const targetOffset = Math.max(0, layout.offsets[idx] - viewportHeight / 3);
      setStickToBottom(false);
      containerRef.current.scrollTop = targetOffset;
      setScrollTop(targetOffset);
    }
  }, [highlightedMessageId, messages, layout, viewportHeight]);

  const visible = useMemo(
    () => computeVisibleRange(layout, messages.length, scrollTop, viewportHeight, 6),
    [layout, messages.length, scrollTop, viewportHeight]
  );

  const visibleMessages = useMemo(() => {
    if (visible.endIndex < visible.startIndex) return [];
    return messages.slice(visible.startIndex, visible.endIndex + 1);
  }, [messages, visible.startIndex, visible.endIndex]);

  useEffect(() => {
    onRenderedNodesChange?.(visibleMessages.length);
  }, [visibleMessages.length, onRenderedNodesChange]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !stickToBottom) return;
    el.scrollTop = layout.totalHeight;
    setScrollTop(el.scrollTop);
  }, [messages.length, layout.totalHeight, stickToBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const top = el.scrollTop;
      const nearBottom = el.scrollHeight - top - el.clientHeight < 72;
      setStickToBottom(nearBottom);
      setScrollTop(top);
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setStickToBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (measureBatchRef.current !== null) cancelAnimationFrame(measureBatchRef.current);
    };
  }, []);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-slate-50/70 dark:bg-slate-950">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        data-testid="virtual-timeline"
        data-total-messages={messages.length}
        data-rendered-rows={visibleMessages.length}
        role="log"
        aria-label="Лента зашифрованных сообщений"
        className="flex-1 overflow-y-auto thin-scrollbar"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Сквозное шифрование активно
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Все сообщения в «{conversationName}» шифруются на клиенте перед отправкой по WebSocket. Сервер пересылает только выровненный шифротекст AES-256-GCM.
            </p>
          </div>
        ) : (
          <div style={{ paddingTop: visible.paddingTop, paddingBottom: visible.paddingBottom }}>
            {visibleMessages.map((msg, idx) => {
              const absoluteIndex = visible.startIndex + idx;
              return (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  localUserId={localUserId}
                  isOwn={msg.senderId === localUserId}
                  isGroupHead={groupHeads[absoluteIndex]}
                  isHighlighted={highlightedMessageId === msg.id}
                  preferPopoverBelow={absoluteIndex === 0}
                  allowAttachmentDownload={allowAttachmentDownload}
                  threadSummary={threadSummaries?.[msg.id]}
                  isThreadActive={activeThreadRootId === msg.id}
                  onMeasure={handleMeasure}
                  onReply={onReply}
                  onOpenThread={onOpenThread}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onTogglePin={onTogglePin}
                  onToggleReaction={onToggleReaction}
                />
              );
            })}
          </div>
        )}
      </div>

      {!stickToBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Прокрутить к последним сообщениям"
          className="absolute bottom-4 right-5 w-10 h-10 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-md flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
