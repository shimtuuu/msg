import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Reply, Send, Square, Timer, Trash2, X } from 'lucide-react';
import type { EncryptedAttachmentPayload } from '../crypto/attachmentCrypto';
import { encryptAttachment, encryptAudioBlob } from '../crypto/attachmentCrypto';
import type { ChatMessage } from '../types/messenger';
import {
  formatRecordingDuration,
  isVoiceAttachment,
  pickSupportedAudioMimeType,
} from '../utils/voice';

interface ComposerProps {
  disabled: boolean;
  isArchived?: boolean;
  isSuspended?: boolean;
  onlyAdminsCanPost?: boolean;
  canPost?: boolean;
  maxAttachmentSizeMb?: number;
  conversationName: string;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  disappearingTtlSec: number;
  onChangeDisappearingTtl: (sec: number) => void;
  onSend: (text: string, attachment?: EncryptedAttachmentPayload) => Promise<void>;
}

export const Composer = React.memo(function Composer({
  disabled,
  isArchived = false,
  isSuspended = false,
  onlyAdminsCanPost = false,
  canPost = true,
  maxAttachmentSizeMb = 25,
  conversationName,
  replyTo,
  onCancelReply,
  disappearingTtlSec,
  onChangeDisappearingTtl,
  onSend,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [pendingAttachment, setPendingAttachment] =
    useState<EncryptedAttachmentPayload | null>(null);
  const [pendingVoicePreviewUrl, setPendingVoicePreviewUrl] = useState<string | null>(
    null
  );
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isEncryptingVoice, setIsEncryptingVoice] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordingStartMsRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);
  const cancelRecordingRef = useRef<boolean>(false);
  const autoSendVoiceRef = useRef<boolean>(false);
  const previewUrlRef = useRef<string | null>(null);

  const effectiveDisabled = disabled || isArchived || isSuspended || !canPost;

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPendingVoicePreviewUrl(null);
  }, []);

  const stopMediaTracks = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelRecordingRef.current = true;
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore recorder stop errors during unmount
        }
      }
      stopMediaTracks();
      revokePreviewUrl();
    };
  }, [stopMediaTracks, revokePreviewUrl]);

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPolicyError(null);
    try {
      if (file.size > maxAttachmentSizeMb * 1024 * 1024) {
        setPolicyError(`Файл превышает корпоративный лимит (${maxAttachmentSizeMb} МБ)`);
        return;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const encrypted = await encryptAttachment(buf, file.name, file.type);
      revokePreviewUrl();
      setPendingAttachment(encrypted);
    } finally {
      e.target.value = '';
    }
  };

  const handleStartRecording = async () => {
    if (effectiveDisabled || isRecording || isEncryptingVoice || sending) return;
    setPolicyError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setPolicyError('Запись голосовых сообщений не поддерживается в текущем браузере');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = pickSupportedAudioMimeType((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      cancelRecordingRef.current = false;
      autoSendVoiceRef.current = false;
      recordingStartMsRef.current = Date.now();
      setRecordingSec(0);
      setIsRecording(true);

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onerror = () => {
        stopMediaTracks();
        setIsRecording(false);
        setPolicyError('Ошибка при записи аудио через MediaRecorder');
      };

      recorder.onstop = () => {
        const shouldCancel = cancelRecordingRef.current;
        const shouldAutoSend = autoSendVoiceRef.current;
        const elapsedSec = Math.max(
          1,
          Math.round((Date.now() - recordingStartMsRef.current) / 1000)
        );
        const recorderMime =
          recorder.mimeType || preferredMime || 'audio/webm';
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];

        stopMediaTracks();
        setIsRecording(false);

        if (shouldCancel) {
          return;
        }

        const audioBlob = new Blob(chunks, { type: recorderMime });
        if (audioBlob.size === 0) {
          setPolicyError('Не удалось записать аудиопоток — попробуйте ещё раз');
          return;
        }
        if (audioBlob.size > maxAttachmentSizeMb * 1024 * 1024) {
          setPolicyError(
            `Голосовое сообщение превышает корпоративный лимит (${maxAttachmentSizeMb} МБ)`
          );
          return;
        }

        void (async () => {
          setIsEncryptingVoice(true);
          try {
            const encryptedAudio = await encryptAudioBlob(audioBlob, {
              durationSec: elapsedSec,
            });
            if (shouldAutoSend) {
              setSending(true);
              try {
                const caption =
                  text.trim() ||
                  `Голосовое сообщение (${formatRecordingDuration(elapsedSec)})`;
                await onSend(caption, encryptedAudio);
                setText('');
                revokePreviewUrl();
                setPendingAttachment(null);
                setPolicyError(null);
              } finally {
                setSending(false);
              }
            } else {
              revokePreviewUrl();
              const objUrl = URL.createObjectURL(audioBlob);
              previewUrlRef.current = objUrl;
              setPendingVoicePreviewUrl(objUrl);
              setPendingAttachment(encryptedAudio);
            }
          } catch (err) {
            setPolicyError(
              err instanceof Error
                ? err.message
                : 'Ошибка шифрования аудиозаписи'
            );
          } finally {
            setIsEncryptingVoice(false);
          }
        })();
      };

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSec(
          Math.floor((Date.now() - recordingStartMsRef.current) / 1000)
        );
      }, 250);

      recorder.start(250);
    } catch (err) {
      stopMediaTracks();
      setIsRecording(false);
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPolicyError('Доступ к микрофону запрещён. Разрешите доступ в настройках браузера.');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setPolicyError('Микрофон не обнаружен на устройстве.');
      } else {
        setPolicyError(
          err instanceof Error
            ? err.message
            : 'Не удалось запустить запись с микрофона'
        );
      }
    }
  };

  const handleStopRecording = (autoSend: boolean) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    cancelRecordingRef.current = false;
    autoSendVoiceRef.current = autoSend;
    recorder.stop();
  };

  const handleCancelRecording = () => {
    const recorder = mediaRecorderRef.current;
    cancelRecordingRef.current = true;
    autoSendVoiceRef.current = false;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      stopMediaTracks();
      setIsRecording(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isRecording) {
      handleStopRecording(true);
      return;
    }
    const trimmed = text.trim();
    if (
      (!trimmed && !pendingAttachment) ||
      effectiveDisabled ||
      sending ||
      isEncryptingVoice
    ) {
      return;
    }
    setSending(true);
    try {
      const defaultCaption = isVoiceAttachment(pendingAttachment ?? undefined)
        ? 'Голосовое сообщение'
        : `Файл: ${pendingAttachment?.fileName ?? 'вложение'}`;
      await onSend(trimmed || defaultCaption, pendingAttachment ?? undefined);
      setText('');
      revokePreviewUrl();
      setPendingAttachment(null);
      setPolicyError(null);
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
    <form
      onSubmit={handleSubmit}
      className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3"
    >
      {(isArchived || isSuspended || !canPost || policyError) && (
        <div
          data-testid="composer-restriction-notice"
          className="mb-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300"
        >
          {isSuspended
            ? 'Ваша учётная запись временно заблокирована администратором организации.'
            : isArchived
            ? 'Канал переведён в архив (режим только для чтения).'
            : !canPost && onlyAdminsCanPost
            ? 'Публиковать в канале объявлений могут только администраторы и модераторы. Вы можете читать и оставлять реакции.'
            : policyError}
        </div>
      )}

      {replyTo && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Reply className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
            <span className="font-medium text-slate-800 dark:text-slate-200 shrink-0">
              Ответ для {replyTo.senderName}:
            </span>
            <span className="text-slate-500 dark:text-slate-400 truncate">
              {replyTo.text}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Отменить ответ"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {pendingAttachment && (
        <div
          data-testid="pending-attachment-preview"
          className="mb-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {isVoiceAttachment(pendingAttachment) ? (
              <Mic className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 flex-1">
              <span className="text-slate-700 dark:text-slate-200 truncate block">
                {isVoiceAttachment(pendingAttachment) ? (
                  <>Зашифрованное голосовое сообщение (AES-GCM + HMAC) </>
                ) : (
                  <>
                    Зашифровано (AES-GCM + HMAC):{' '}
                    <strong>{pendingAttachment.fileName}</strong>{' '}
                  </>
                )}
                <span className="font-mono tabular-nums text-slate-500">
                  ({pendingAttachment.originalSize} Б)
                </span>
              </span>
              {pendingVoicePreviewUrl && (
                <audio
                  controls
                  src={pendingVoicePreviewUrl}
                  aria-label="Предпрослушивание голосовой записи"
                  className="mt-1.5 h-8 w-full max-w-xs"
                />
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              revokePreviewUrl();
              setPendingAttachment(null);
            }}
            aria-label="Убрать вложение"
            className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 p-1 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isRecording ? (
        <div
          data-testid="voice-recorder-bar"
          className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-1.5"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse shrink-0"
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-rose-900 dark:text-rose-200 truncate">
              Запись голоса
            </span>
            <span
              data-testid="voice-recording-timer"
              className="text-xs font-mono tabular-nums text-rose-700 dark:text-rose-300"
            >
              {formatRecordingDuration(recordingSec)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCancelRecording}
              aria-label="Отменить запись"
              className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Отмена</span>
            </button>

            <button
              type="button"
              onClick={() => handleStopRecording(false)}
              aria-label="Остановить запись"
              className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 transition-colors"
            >
              <Square className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
              <span className="hidden sm:inline">Стоп</span>
            </button>

            <button
              type="button"
              onClick={() => handleStopRecording(true)}
              aria-label="Отправить голосовое сообщение"
              className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Отправить</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleAttachFile}
            className="hidden"
            aria-label="Выбрать файл для шифрования"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={effectiveDisabled || isEncryptingVoice}
            aria-label="Прикрепить зашифрованный файл"
            className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 disabled:opacity-40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleStartRecording}
            disabled={effectiveDisabled || isEncryptingVoice || sending}
            aria-label="Записать голосовое сообщение"
            title="Записать голосовое сообщение (MediaRecorder + E2EE)"
            className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 disabled:opacity-40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Mic className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-800 rounded-xl px-2 h-10 shrink-0">
            <Timer className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            <label htmlFor="ttl-select" className="sr-only">
              Таймер исчезающих сообщений
            </label>
            <select
              id="ttl-select"
              disabled={effectiveDisabled}
              value={disappearingTtlSec}
              onChange={(e) => onChangeDisappearingTtl(Number(e.target.value))}
              className="bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer disabled:opacity-40"
            >
              <option value={0} className="dark:bg-slate-900">Выкл</option>
              <option value={15} className="dark:bg-slate-900">15с</option>
              <option value={60} className="dark:bg-slate-900">1м</option>
              <option value={300} className="dark:bg-slate-900">5м</option>
            </select>
          </div>

          <label htmlFor="message-composer" className="sr-only">
            Сообщение для {conversationName}
          </label>
          <textarea
            id="message-composer"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={effectiveDisabled || isEncryptingVoice}
            placeholder={
              isEncryptingVoice
                ? 'Шифрование аудиозаписи…'
                : isArchived
                ? 'Канал в архиве…'
                : !canPost
                ? 'Только чтение для сотрудников…'
                : 'Сообщение (AES-256-GCM)…'
            }
            className="flex-1 min-w-0 h-10 min-h-[40px] max-h-32 resize-none rounded-xl bg-slate-100/80 dark:bg-slate-900 px-3.5 py-2.5 text-sm leading-5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 placeholder:truncate border border-transparent focus:border-blue-600 focus:bg-white dark:focus:bg-slate-950 focus:outline-none transition-colors disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={
              effectiveDisabled ||
              sending ||
              isEncryptingVoice ||
              (!text.trim() && !pendingAttachment)
            }
            aria-label="Отправить сообщение"
            className="h-10 px-3 sm:px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-sm font-medium inline-flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Отправить</span>
          </button>
        </div>
      )}
    </form>
  );
});


