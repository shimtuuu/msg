import React, { useState } from 'react';
import { Check, Copy, Download, Gauge, Lock, Trash2, X, Zap } from 'lucide-react';
import type { PerfMetrics, WireLogEntry } from '../types/messenger';
import signalEngineSource from '../crypto/signalEngine.ts?raw';
import senderKeySource from '../crypto/senderKey.ts?raw';
import attachmentCryptoSource from '../crypto/attachmentCrypto.ts?raw';
import virtualizerSource from '../utils/virtualizer.ts?raw';

interface InspectorDrawerProps {
  open: boolean;
  onClose: () => void;
  wireLogs: WireLogEntry[];
  metrics: PerfMetrics;
  onRunBenchmark: (count: number) => Promise<void>;
  onClearBenchmark: () => void;
}

type TabId = 'wire' | 'perf' | 'export';

const PRISMA_E2EE_PATCH = `// Дополнение для server/prisma/schema.prisma (shimtuuu/mesenger)
model UserKeyBundle {
  id                     String   @id @default(cuid())
  userId                 String   @unique
  registrationId         Int
  identityPublicB64      String
  signingPublicB64       String
  signedPreKeyPublicB64  String
  signedPreKeySigB64     String
  oneTimePreKeyPublicB64 String?
  updatedAt              DateTime @updatedAt
  user                   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model RoomSenderKeyWrap {
  id                      String   @id @default(cuid())
  roomId                  String
  senderId                String
  recipientId             String
  senderIdentityPublicB64 String
  ivB64                   String
  wrappedB64              String
  createdAt               DateTime @default(now())
  @@unique([roomId, senderId, recipientId])
}

// В модели Message: поле content хранит JSON-конверт EncryptedGroupEnvelope / EncryptedEnvelope
// вместо открытого текста, а поиск перенесён на клиентский кэш расшифрованных сообщений.`;

const EXPORTABLE_MODULES = [
  {
    id: 'signalEngine',
    filename: 'signalEngine.ts',
    title: 'X3DH + Double Ratchet + AES-256-GCM + Safety Number (DM)',
    content: signalEngineSource,
  },
  {
    id: 'senderKey',
    filename: 'senderKey.ts',
    title: 'Sender Keys E2EE + ECDSA для групповых каналов Corp Messenger',
    content: senderKeySource,
  },
  {
    id: 'attachmentCrypto',
    filename: 'attachmentCrypto.ts',
    title: 'Шифрование вложений (AES-GCM + HMAC-SHA-256)',
    content: attachmentCryptoSource,
  },
  {
    id: 'virtualizer',
    filename: 'virtualizer.ts',
    title: 'O(log N) бинарный виртуализатор для MessageList.tsx',
    content: virtualizerSource,
  },
  {
    id: 'prismaPatch',
    filename: 'schema.e2ee.prisma',
    title: 'Расширение Prisma-схемы shimtuuu/mesenger для хранения E2EE-связок',
    content: PRISMA_E2EE_PATCH,
  },
];

export function InspectorDrawer({
  open,
  onClose,
  wireLogs,
  metrics,
  onRunBenchmark,
  onClearBenchmark,
}: InspectorDrawerProps) {
  const [tab, setTab] = useState<TabId>('wire');
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const handleBenchmark = async (count: number) => {
    if (benchmarkRunning) return;
    setBenchmarkRunning(true);
    try {
      await onRunBenchmark(count);
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      aria-label="Инспектор шифрования и производительности"
      className="w-full md:w-[380px] lg:w-[420px] shrink-0 h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Инспектор E2EE и UI
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть инспектор"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 bg-slate-50 dark:bg-slate-900/60">
        <button
          type="button"
          onClick={() => setTab('wire')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            tab === 'wire'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Шифротрафик ({wireLogs.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('perf')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            tab === 'perf'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Производительность
        </button>
        <button
          type="button"
          onClick={() => setTab('export')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            tab === 'export'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Модули в repo
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar p-4">
        {tab === 'wire' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Реальные пакеты Double Ratchet (ЛС) и Sender Keys (каналы), переданные через WebSocket. Открытый текст на сервер не отправляется.
            </p>

            {wireLogs.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                Отправьте сообщение в канал или ЛС, чтобы увидеть пакеты AES-256-GCM.
              </div>
            ) : (
              wireLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {entry.direction === 'outbound' ? '↑' : '↓'} {entry.protocol} · #{entry.counter}
                      {entry.threadRootId ? ' · Тред' : ''}
                    </span>
                    <span className="text-slate-400">
                      {entry.plaintextByteLength}Б → {entry.paddedByteLength}Б
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                    {entry.threadRootId && (
                      <div className="text-blue-600 dark:text-blue-400">
                        AAD ThreadRoot: {entry.threadRootId}
                      </div>
                    )}
                    <div>Key/Sig: {entry.keyPreview}…</div>
                    <div>IV: {entry.ivB64}</div>
                    <div className="text-slate-700 dark:text-slate-300">
                      CT: {entry.ciphertextPreview}…
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'perf' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Замена полного рендера списка на бинарную O(log N) виртуализацию, мемоизацию MessageItem и отсутствие forced reflow в поле ввода.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Сообщений в истории
                </div>
                <div
                  data-testid="metric-total-messages"
                  className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100"
                >
                  {metrics.totalMessages.toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Узлов в DOM сейчас
                </div>
                <div
                  data-testid="metric-dom-nodes"
                  className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-blue-600 dark:text-blue-400"
                >
                  {metrics.renderedDomNodes}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Шифрование E2EE
                </div>
                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {metrics.lastEncryptMs.toFixed(2)} мс
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Обновление списка
                </div>
                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {metrics.lastRenderMs.toFixed(2)} мс
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-blue-600" aria-hidden="true" />
                <span>Нагрузочный тест виртуализации</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={benchmarkRunning}
                  onClick={() => void handleBenchmark(5000)}
                  className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{benchmarkRunning ? 'Генерация…' : '+ 5 000 сообщений'}</span>
                </button>
                <button
                  type="button"
                  disabled={benchmarkRunning}
                  onClick={() => void handleBenchmark(10000)}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
                >
                  + 10 000 сообщений
                </button>
                <button
                  type="button"
                  onClick={onClearBenchmark}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Сбросить</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Готовые модули интеграции для <code className="font-mono">shimtuuu/mesenger</code> (клиентские криптомодули, виртуализатор и схема Prisma для хранения связок ключей).
            </div>

            {EXPORTABLE_MODULES.map((mod) => (
              <div
                key={mod.id}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                    <span className="truncate">{mod.filename}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {mod.title}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy(mod.id, mod.content)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 transition-colors"
                  >
                    {copiedId === mod.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Копировать</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(mod.filename, mod.content)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
