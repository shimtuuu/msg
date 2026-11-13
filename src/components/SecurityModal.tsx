import React from 'react';
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { ConversationMeta } from '../types/messenger';

interface SecurityModalProps {
  open: boolean;
  conversation: ConversationMeta | null;
  onClose: () => void;
  onToggleVerified: (id: string) => void;
  onResetKeys: (id: string) => Promise<void>;
}

export function SecurityModal({
  open,
  conversation,
  onClose,
  onToggleVerified,
  onResetKeys,
}: SecurityModalProps) {
  if (!open || !conversation) return null;

  const isDm = conversation.kind === 'dm';
  const groups = conversation.safetyNumber ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="security-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {conversation.verified ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            ) : isDm ? (
              <ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            )}
            <h2
              id="security-modal-title"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {isDm ? `Код безопасности · ${conversation.name}` : `Шифрование канала · #${conversation.name}`}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно безопасности"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {isDm ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Сверьте 60-значный Safety Number с собеседником. Совпадение чисел гарантирует отсутствие подмены публичных ключей (MITM).
              </p>

              <div
                data-testid="safety-number-grid"
                className="grid grid-cols-4 gap-2.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              >
                {groups.length === 12 ? (
                  groups.map((chunk, idx) => (
                    <div
                      key={idx}
                      className="text-center font-mono text-sm font-medium tracking-wider text-slate-900 dark:text-slate-100 py-1"
                    >
                      {chunk}
                    </div>
                  ))
                ) : (
                  <div className="col-span-4 text-center text-xs text-slate-400 py-4">
                    Вычисление отпечатка…
                  </div>
                )}
              </div>

              <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <span>Статус сессии</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {conversation.session
                      ? `Double Ratchet (отпр: ${conversation.session.sendCount}, приём: ${conversation.session.recvCount})`
                      : 'Ожидание X3DH'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Протокол</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    X3DH P-256 · HKDF-SHA-256 · AES-256-GCM
                  </span>
                </div>
                {conversation.bundle && (
                  <div className="flex items-center justify-between gap-4">
                    <span>Registration ID</span>
                    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      #{conversation.bundle.registrationId}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void onResetKeys(conversation.id)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Пересогласовать X3DH</span>
                </button>

                <button
                  type="button"
                  onClick={() => onToggleVerified(conversation.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    conversation.verified
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {conversation.verified
                      ? 'Ключ подтверждён (снять)'
                      : 'Подтвердить ключ'}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Групповой канал защищён схемой Signal Sender Keys: ключ цепи канала обёртывается персонально для каждого участника через ECDH, а каждое сообщение подписывается ECDSA P-256.
              </p>

              <div className="space-y-2.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Sender Key ID</span>
                  <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                    {conversation.selfSenderKey?.keyId ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Итерация цепи отправки</span>
                  <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                    #{conversation.selfSenderKey?.iteration ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Ключей участников получено</span>
                  <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                    {Object.keys(conversation.peerSenderKeys ?? {}).length}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Шифр и подпись</span>
                  <span className="font-mono text-slate-900 dark:text-slate-100">
                    AES-256-GCM · ECDSA P-256
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void onResetKeys(conversation.id)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Ротировать SenderKey канала</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
