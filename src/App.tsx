import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Hash,
  Lock,
  Megaphone,
  Pin,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  computeSafetyNumber,
  decryptMessage,
  encryptMessage,
  establishSessionAsInitiator,
  establishSessionAsResponder,
  extractPublicPreKeyBundle,
  generateIdentityBundle,
  type EncryptedEnvelope,
  type IdentityBundle,
  type PublicPreKeyBundle,
  type RatchetSession,
} from './crypto/signalEngine';
import {
  createSenderKeyState,
  decryptGroupMessage,
  encryptGroupMessage,
  exportSenderKeyDistribution,
  importSenderKeyDistribution,
  unwrapSenderKeyFromPeer,
  wrapSenderKeyForPeer,
  type EncryptedGroupEnvelope,
  type SenderKeyState,
} from './crypto/senderKey';
import type { EncryptedAttachmentPayload } from './crypto/attachmentCrypto';
import {
  decryptVaultMessage,
  deriveVaultKey,
  encryptVaultMessage,
  type EncryptedVaultRecord,
} from './crypto/vaultCrypto';
import type {
  AuthUser,
  ChannelCategory,
  ChatMessage,
  ConversationMeta,
  EnterprisePolicy,
  EnterpriseRole,
  PeerDirectoryItem,
  PresenceState,
  ReactionAction,
  RoomDirectoryItem,
} from './types/messenger';
import {
  canAccessManagementConsole,
  canDownloadAttachments,
  canManageChannels,
  canPostInChannel,
} from './utils/enterpriseAdmin';
import { applyReactionUpdate, toggleReaction } from './utils/reactions';
import { partitionThreadMessages } from './utils/threads';
import {
  buildDesktopNotificationPayload,
  getNotificationPermissionState,
  isWindowBlurred,
  requestDesktopNotificationPermission,
  shouldTriggerDesktopNotification,
  showDesktopNotification,
  type DesktopNotificationPermission,
} from './utils/desktopNotifications';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { VirtualizedTimeline } from './components/VirtualizedTimeline';
import { Composer } from './components/Composer';
import { SecurityModal } from './components/SecurityModal';
import { CreateRoomModal } from './components/CreateRoomModal';
import { AdminPanel } from './components/AdminPanel';
import { MembersDrawer } from './components/MembersDrawer';
import { ChannelDirectoryModal } from './components/ChannelDirectoryModal';
import { ChannelSettingsModal } from './components/ChannelSettingsModal';
import { ThreadDrawer } from './components/ThreadDrawer';

const EMPTY_MESSAGES: ChatMessage[] = [];
const AUTH_TOKEN_KEY = 'cm_auth_token';
const AUTH_USER_KEY = 'cm_auth_user';
const DESKTOP_NOTIF_ENABLED_KEY = 'cm_desktop_notifications_enabled';

function loadCachedAuthUser(): AuthUser | null {
  const raw = sessionStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed && typeof parsed.userId === 'string' && typeof parsed.email === 'string') {
      return parsed;
    }
  } catch {
    // ignore corrupted cache
  }
  return null;
}

async function loadOrCreateIdentityBundle(userId: string): Promise<IdentityBundle> {
  const storageKey = `cipherline_bundle_${userId}`;
  const rawLocal = localStorage.getItem(storageKey);
  if (rawLocal) {
    try {
      const parsed = JSON.parse(rawLocal) as IdentityBundle;
      if (parsed && parsed.userId === userId && parsed.identityKey?.publicKeyB64) {
        return parsed;
      }
    } catch {
      // fallback to sessionStorage or regenerate
    }
  }
  const rawSession = sessionStorage.getItem(storageKey);
  if (rawSession) {
    try {
      const parsed = JSON.parse(rawSession) as IdentityBundle;
      if (parsed && parsed.userId === userId && parsed.identityKey?.publicKeyB64) {
        try {
          localStorage.setItem(storageKey, rawSession);
        } catch {
          // ignore storage quota errors
        }
        return parsed;
      }
    } catch {
      // regenerate corrupted bundle
    }
  }
  const bundle = await generateIdentityBundle(userId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(bundle));
  } catch {
    // ignore storage quota errors
  }
  sessionStorage.setItem(storageKey, JSON.stringify(bundle));
  return bundle;
}

interface PersistedRatchetState {
  dmSessions: Record<string, RatchetSession>;
  selfSenderKeys: Record<string, SenderKeyState>;
  peerSenderKeys: Record<string, Record<string, SenderKeyState>>;
}

function loadRatchetState(userId: string): PersistedRatchetState {
  const empty: PersistedRatchetState = {
    dmSessions: {},
    selfSenderKeys: {},
    peerSenderKeys: {},
  };
  try {
    const raw = localStorage.getItem(`cipherline_ratchet_${userId}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedRatchetState>;
    return {
      dmSessions: parsed.dmSessions ?? {},
      selfSenderKeys: parsed.selfSenderKeys ?? {},
      peerSenderKeys: parsed.peerSenderKeys ?? {},
    };
  } catch {
    return empty;
  }
}

function saveRatchetStateFromConversations(
  userId: string,
  convs: Record<string, ConversationMeta>
): void {
  const dmSessions: Record<string, RatchetSession> = {};
  const selfSenderKeys: Record<string, SenderKeyState> = {};
  const peerSenderKeys: Record<string, Record<string, SenderKeyState>> = {};
  for (const conv of Object.values(convs)) {
    if (conv.kind === 'dm' && conv.session) {
      dmSessions[conv.id] = conv.session;
    } else if (conv.kind !== 'dm') {
      if (conv.selfSenderKey) {
        selfSenderKeys[conv.id] = conv.selfSenderKey;
      }
      if (conv.peerSenderKeys && Object.keys(conv.peerSenderKeys).length > 0) {
        peerSenderKeys[conv.id] = conv.peerSenderKeys;
      }
    }
  }
  try {
    localStorage.setItem(
      `cipherline_ratchet_${userId}`,
      JSON.stringify({ dmSessions, selfSenderKeys, peerSenderKeys })
    );
  } catch {
    // ignore quota errors
  }
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() =>
    sessionStorage.getItem(AUTH_TOKEN_KEY)
  );
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() =>
    loadCachedAuthUser()
  );
  const [authLoading, setAuthLoading] = useState(() => !loadCachedAuthUser());
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);

  const [localBundle, setLocalBundle] = useState<IdentityBundle | null>(null);
  const [presence, setPresence] = useState<PresenceState>('online');
  const [wsConnected, setWsConnected] = useState(false);

  const [conversations, setConversations] = useState<Record<string, ConversationMeta>>({});
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>({});
  const [activeId, setActiveId] = useState<string>('room-general');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'admin'>('chat');
  const [currentUserRole, setCurrentUserRole] = useState<EnterpriseRole>('member');
  const [isSuspended, setIsSuspended] = useState(false);
  const [enterprisePolicy, setEnterprisePolicy] = useState<EnterprisePolicy>({
    requireE2EE: true,
    requireVerifiedSafetyNumberForExternal: true,
    restrictGuestDownloads: true,
    allowMemberChannelCreation: true,
    defaultDisappearingTtlSec: 0,
    sessionKeyRotationHours: 24,
    maxAttachmentSizeMb: 25,
  });
  const [securityOpen, setSecurityOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [activeThreadRootId, setActiveThreadRootId] = useState<string | null>(null);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [channelDirectoryOpen, setChannelDirectoryOpen] = useState(false);
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<DesktopNotificationPermission>(() => getNotificationPermissionState());
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState<boolean>(
    () => {
      try {
        const stored = localStorage.getItem(DESKTOP_NOTIF_ENABLED_KEY);
        return stored === null ? true : stored === 'true';
      } catch {
        return true;
      }
    }
  );

  const wsRef = useRef<WebSocket | null>(null);
  const authTokenRef = useRef<string | null>(authToken);
  const localBundleRef = useRef<IdentityBundle | null>(null);
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const pendingVaultSavesRef = useRef<EncryptedVaultRecord[]>([]);
  const conversationsRef = useRef<Record<string, ConversationMeta>>({});
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  const activeIdRef = useRef<string>(activeId);
  const peerDirectoryRef = useRef<Record<string, PeerDirectoryItem>>({});
  const highlightTimerRef = useRef<number | null>(null);
  const windowBlurredRef = useRef<boolean>(
    typeof document !== 'undefined'
      ? isWindowBlurred({
          hasFocus: document.hasFocus(),
          visibilityState: document.visibilityState,
        })
      : false
  );
  const presenceRef = useRef<PresenceState>(presence);
  const notificationPermissionRef = useRef<DesktopNotificationPermission>(
    notificationPermission
  );
  const notificationsEnabledRef = useRef<boolean>(desktopNotificationsEnabled);
  const selectConversationRef = useRef<(id: string) => void>(() => {});

  authTokenRef.current = authToken;
  conversationsRef.current = conversations;
  messagesRef.current = messagesByConv;
  activeIdRef.current = activeId;
  presenceRef.current = presence;
  notificationPermissionRef.current = notificationPermission;
  notificationsEnabledRef.current = desktopNotificationsEnabled;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const syncBlurState = () => {
      windowBlurredRef.current = isWindowBlurred({
        hasFocus: document.hasFocus(),
        visibilityState: document.visibilityState,
      });
    };
    const handleBlur = () => {
      windowBlurredRef.current = true;
    };
    const handleFocus = () => {
      windowBlurredRef.current = document.visibilityState === 'hidden';
      setNotificationPermission(getNotificationPermissionState());
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        windowBlurredRef.current = true;
      } else {
        syncBlurState();
      }
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'admin' && !canAccessManagementConsole(currentUserRole)) {
      setViewMode('chat');
    }
  }, [viewMode, currentUserRole]);

  // Verify existing session on startup without forcibly logging out an active cached session
  useEffect(() => {
    let cancelled = false;
    const storedToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
    const cachedUser = loadCachedAuthUser();

    if (cachedUser) {
      setCurrentUserRole(cachedUser.role);
      setIsSuspended(!cachedUser.isActive);
    }

    const bootstrapSession = async () => {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : undefined,
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { user: AuthUser };
          sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
          setCurrentUser(data.user);
          setCurrentUserRole(data.user.role);
          setIsSuspended(!data.user.isActive);
          setAuthError(null);
          setSessionWarning(null);
        } else if (res.status === 403) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (cachedUser) {
            setIsSuspended(true);
            setSessionWarning(
              data.error || 'Учётная запись приостановлена администратором'
            );
          } else {
            sessionStorage.removeItem(AUTH_TOKEN_KEY);
            setAuthToken(null);
            setCurrentUser(null);
            if (data.error) setAuthError(data.error);
          }
        } else if (cachedUser) {
          // Keep user inside their workspace; never force-logout on stale/invalid token
          setSessionWarning(
            'Сессия на сервере обновилась. Подтвердите пароль для синхронизации чатов.'
          );
        } else {
          sessionStorage.removeItem(AUTH_TOKEN_KEY);
          setAuthToken(null);
          setCurrentUser(null);
        }
      } catch {
        if (!cancelled && !cachedUser) {
          setCurrentUser(null);
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };

    void bootstrapSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load or generate per-user E2EE identity bundle once authenticated
  useEffect(() => {
    if (!currentUser) {
      localBundleRef.current = null;
      vaultKeyRef.current = null;
      setLocalBundle(null);
      return;
    }
    let cancelled = false;
    loadOrCreateIdentityBundle(currentUser.userId).then(async (bundle) => {
      if (cancelled) return;
      const vKey = await deriveVaultKey(bundle);
      if (cancelled) return;
      localBundleRef.current = bundle;
      vaultKeyRef.current = vKey;
      setLocalBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.userId]);

  const saveMessageToVault = useCallback(async (msg: ChatMessage) => {
    const bundle = localBundleRef.current;
    if (!bundle) return;
    const key = vaultKeyRef.current ?? (await deriveVaultKey(bundle));
    vaultKeyRef.current = key;
    const record = await encryptVaultMessage(key, msg);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'vault:save', record }));
    } else {
      pendingVaultSavesRef.current.push(record);
    }
  }, []);

  const distributeRoomSenderKey = useCallback(
    async (roomId: string, senderKeyState: SenderKeyState) => {
      const myBundle = localBundleRef.current;
      const ws = wsRef.current;
      if (!myBundle || !ws || ws.readyState !== WebSocket.OPEN) return;

      const dist = exportSenderKeyDistribution(senderKeyState);
      const peers = Object.values(peerDirectoryRef.current);
      for (const peer of peers) {
        const wrapped = await wrapSenderKeyForPeer(
          dist,
          myBundle,
          peer.bundle.identityPublicB64
        );
        ws.send(
          JSON.stringify({
            type: 'group:senderKey',
            roomId,
            senderId: myBundle.userId,
            recipientId: peer.userId,
            senderIdentityPublicB64: myBundle.identityKey.publicKeyB64,
            ivB64: wrapped.ivB64,
            wrappedB64: wrapped.wrappedB64,
          })
        );
      }
    },
    []
  );

  const ensureDmSession = useCallback(
    async (peerId: string): Promise<RatchetSession | null> => {
      const existing = conversationsRef.current[peerId]?.session;
      if (existing) return existing;

      const myBundle = localBundleRef.current;
      const peerMeta = conversationsRef.current[peerId];
      if (!myBundle || !peerMeta?.bundle) return null;

      const { session, ephemeralPublicB64 } = await establishSessionAsInitiator(
        myBundle,
        peerMeta.bundle
      );

      const nextConvs = {
        ...conversationsRef.current,
        [peerId]: { ...peerMeta, session },
      };
      conversationsRef.current = nextConvs;
      saveRatchetStateFromConversations(myBundle.userId, nextConvs);
      setConversations((prev) => {
        const curr = prev[peerId];
        if (!curr) return prev;
        return { ...prev, [peerId]: { ...curr, session } };
      });

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'session:init',
            senderId: myBundle.userId,
            receiverId: peerId,
            senderBundle: extractPublicPreKeyBundle(myBundle),
            ephemeralPublicB64,
          })
        );
      }
      return session;
    },
    []
  );

  const ensureRoomSenderKey = useCallback(
    async (roomId: string): Promise<SenderKeyState | null> => {
      const existing = conversationsRef.current[roomId]?.selfSenderKey;
      if (existing) return existing;

      const myBundle = localBundleRef.current;
      if (!myBundle) return null;

      const sk = await createSenderKeyState(roomId, myBundle.userId);
      const currConv = conversationsRef.current[roomId];
      if (currConv) {
        const nextConvs = {
          ...conversationsRef.current,
          [roomId]: { ...currConv, selfSenderKey: sk },
        };
        conversationsRef.current = nextConvs;
        saveRatchetStateFromConversations(myBundle.userId, nextConvs);
      }
      setConversations((prev) => {
        const curr = prev[roomId];
        if (!curr) return prev;
        return { ...prev, [roomId]: { ...curr, selfSenderKey: sk } };
      });
      await distributeRoomSenderKey(roomId, sk);
      return sk;
    },
    [distributeRoomSenderKey]
  );

  // WebSocket lifecycle
  useEffect(() => {
    if (!localBundle) return;
    let disposed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setSessionWarning(null);
        ws.send(
          JSON.stringify({
            type: 'register',
            token: authTokenRef.current ?? undefined,
            presence,
            bundle: extractPublicPreKeyBundle(localBundle),
          })
        );
        if (pendingVaultSavesRef.current.length > 0) {
          const toFlush = pendingVaultSavesRef.current.splice(0);
          for (const record of toFlush) {
            ws.send(JSON.stringify({ type: 'vault:save', record }));
          }
        }
      };

      let clientMsgQueue = Promise.resolve();

      const processIncomingMessage = async (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string);

          if (data.type === 'directory:sync') {
            const peers = (data.peers ?? []) as PeerDirectoryItem[];
            const rooms = (data.rooms ?? []) as RoomDirectoryItem[];
            const syncedPolicy = data.policy as EnterprisePolicy | undefined;
            const selfAccount = data.selfAccount as
              | { role?: EnterpriseRole; isActive?: boolean }
              | undefined;

            if (syncedPolicy) {
              setEnterprisePolicy(syncedPolicy);
            }
            if (selfAccount?.role) {
              setCurrentUserRole(selfAccount.role);
            }
            if (selfAccount?.isActive !== undefined) {
              setIsSuspended(!selfAccount.isActive);
            }

            for (const p of peers) {
              peerDirectoryRef.current[p.userId] = p;
            }

            const safetyPairs = await Promise.all(
              peers.map(async (p) => {
                const sn = await computeSafetyNumber(
                  localBundle.userId,
                  localBundle.identityKey.publicKeyB64,
                  p.userId,
                  p.bundle.identityPublicB64
                );
                return { peer: p, safetyNumber: sn };
              })
            );

            const ratchetCache = loadRatchetState(localBundle.userId);
            const prevConvs = conversationsRef.current;
            const syncedConvs: Record<string, ConversationMeta> = {};

            for (const r of rooms) {
              const old = prevConvs[r.id];
              syncedConvs[r.id] = {
                id: r.id,
                kind: r.kind,
                name: r.name,
                subtitle: r.description,
                topic: r.topic,
                department: r.department,
                category: r.category,
                isArchived: r.isArchived ?? false,
                onlyAdminsCanPost: r.onlyAdminsCanPost ?? false,
                isJoined: r.isJoined ?? true,
                isMuted: old?.isMuted ?? false,
                memberIds: r.memberIds,
                selfSenderKey:
                  old?.selfSenderKey ?? ratchetCache.selfSenderKeys[r.id],
                peerSenderKeys:
                  old?.peerSenderKeys ?? ratchetCache.peerSenderKeys[r.id] ?? {},
                verified: true,
                unreadCount: old?.unreadCount ?? 0,
                typingUsers: old?.typingUsers ?? [],
                disappearingTtlSec:
                  old?.disappearingTtlSec ??
                  syncedPolicy?.defaultDisappearingTtlSec ??
                  0,
                lastMessagePreview: old?.lastMessagePreview ?? '',
                lastMessageAt: old?.lastMessageAt ?? 0,
              };
            }

            for (const { peer, safetyNumber } of safetyPairs) {
              const old = prevConvs[peer.userId];
              const cachedSession =
                old?.session ?? ratchetCache.dmSessions[peer.userId];
              const validSession =
                cachedSession &&
                cachedSession.remoteIdentityPublicB64 ===
                  peer.bundle.identityPublicB64
                  ? cachedSession
                  : undefined;

              syncedConvs[peer.userId] = {
                id: peer.userId,
                kind: 'dm',
                name: peer.name,
                subtitle: peer.role,
                department: peer.department,
                enterpriseRole: peer.enterpriseRole,
                isActive: peer.isActive,
                presence: peer.presence,
                isSystemPeer: peer.isSystemPeer,
                bundle: peer.bundle,
                session: validSession,
                safetyNumber,
                verified: old?.verified ?? false,
                unreadCount: old?.unreadCount ?? 0,
                typingUsers: old?.typingUsers ?? [],
                disappearingTtlSec:
                  old?.disappearingTtlSec ??
                  syncedPolicy?.defaultDisappearingTtlSec ??
                  0,
                lastMessagePreview: old?.lastMessagePreview ?? '',
                lastMessageAt: old?.lastMessageAt ?? 0,
              };
            }

            conversationsRef.current = syncedConvs;
            setConversations(syncedConvs);

            const activeRoomStillAccessible = rooms.find(
              (r) => r.id === activeIdRef.current
            );
            const isPeerActive = safetyPairs.some(
              ({ peer }) => peer.userId === activeIdRef.current
            );
            if (!isPeerActive && (!activeRoomStillAccessible || activeRoomStillAccessible.isJoined === false)) {
              const fallback =
                rooms.find((r) => r.isJoined !== false)?.id ?? 'room-general';
              setActiveId(fallback);
            }

            // Re-distribute any active room SenderKeys to newly joined peers
            for (const r of rooms) {
              const sk = conversationsRef.current[r.id]?.selfSenderKey;
              if (sk) {
                void distributeRoomSenderKey(r.id, sk);
              }
            }

            // Initialize keys for active conversation
            const currId = activeIdRef.current;
            const currConv = conversationsRef.current[currId];
            if (currConv?.kind === 'dm') {
              void ensureDmSession(currId);
            } else if (rooms.some((r) => r.id === currId)) {
              void ensureRoomSenderKey(currId);
            }
            return;
          }

          if (data.type === 'vault:sync') {
            const records = (data.records ?? []) as EncryptedVaultRecord[];
            if (records.length === 0) return;
            const key =
              vaultKeyRef.current ?? (await deriveVaultKey(localBundle));
            vaultKeyRef.current = key;
            const decrypted = (
              await Promise.all(
                records.map((r) => decryptVaultMessage(key, r))
              )
            ).filter((m): m is ChatMessage => m !== null);

            const nowMs = Date.now();
            const valid = decrypted.filter(
              (m) => m.expiresAt === undefined || m.expiresAt > nowMs
            );
            if (valid.length === 0) return;

            const mergedByConv: Record<string, ChatMessage[]> = {
              ...messagesRef.current,
            };
            for (const msg of valid) {
              const list = mergedByConv[msg.conversationId] ?? [];
              const existingIdx = list.findIndex((x) => x.id === msg.id);
              if (existingIdx >= 0) {
                const copy = [...list];
                copy[existingIdx] = msg;
                mergedByConv[msg.conversationId] = copy;
              } else {
                mergedByConv[msg.conversationId] = [...list, msg];
              }
            }
            for (const cid of Object.keys(mergedByConv)) {
              mergedByConv[cid] = [...mergedByConv[cid]].sort(
                (a, b) => a.timestamp - b.timestamp
              );
            }
            messagesRef.current = mergedByConv;
            setMessagesByConv(mergedByConv);

            setConversations((prev) => {
              const next = { ...prev };
              for (const [cid, list] of Object.entries(mergedByConv)) {
                const conv = next[cid];
                if (!conv || list.length === 0) continue;
                const topLevel = list.filter((m) => !m.threadRootId);
                const latest =
                  topLevel[topLevel.length - 1] ?? list[list.length - 1];
                if (latest && latest.timestamp >= conv.lastMessageAt) {
                  next[cid] = {
                    ...conv,
                    lastMessagePreview: latest.text,
                    lastMessageAt: latest.timestamp,
                  };
                }
              }
              conversationsRef.current = next;
              return next;
            });
            return;
          }

          if (data.type === 'session:init') {
            const { senderId, senderBundle, ephemeralPublicB64 } = data as {
              senderId: string;
              senderBundle: PublicPreKeyBundle;
              ephemeralPublicB64: string;
            };
            let session: RatchetSession;
            try {
              session = await establishSessionAsResponder(
                localBundle,
                senderBundle,
                ephemeralPublicB64
              );
            } catch {
              return;
            }
            const currConv = conversationsRef.current[senderId];
            if (currConv) {
              const nextConvs = {
                ...conversationsRef.current,
                [senderId]: { ...currConv, session },
              };
              conversationsRef.current = nextConvs;
              saveRatchetStateFromConversations(localBundle.userId, nextConvs);
            }
            setConversations((prev) => {
              const curr = prev[senderId];
              if (!curr) return prev;
              return { ...prev, [senderId]: { ...curr, session } };
            });
            return;
          }

          if (data.type === 'group:senderKey') {
            const {
              roomId,
              senderId,
              senderIdentityPublicB64,
              ivB64,
              wrappedB64,
            } = data as {
              roomId: string;
              senderId: string;
              senderIdentityPublicB64: string;
              ivB64: string;
              wrappedB64: string;
            };
            let skState: SenderKeyState;
            try {
              const dist = await unwrapSenderKeyFromPeer(
                { ivB64, wrappedB64 },
                localBundle,
                senderIdentityPublicB64
              );
              skState = importSenderKeyDistribution(dist);
            } catch {
              return;
            }
            const currRoom = conversationsRef.current[roomId];
            const existingPeerKey = currRoom?.peerSenderKeys?.[senderId];
            if (
              existingPeerKey &&
              existingPeerKey.keyId === skState.keyId &&
              existingPeerKey.iteration <= skState.iteration
            ) {
              return;
            }
            if (currRoom) {
              const nextConvs = {
                ...conversationsRef.current,
                [roomId]: {
                  ...currRoom,
                  peerSenderKeys: {
                    ...(currRoom.peerSenderKeys ?? {}),
                    [senderId]: skState,
                  },
                },
              };
              conversationsRef.current = nextConvs;
              saveRatchetStateFromConversations(localBundle.userId, nextConvs);
            }
            setConversations((prev) => {
              const curr = prev[roomId];
              if (!curr) return prev;
              return {
                ...prev,
                [roomId]: {
                  ...curr,
                  peerSenderKeys: {
                    ...(curr.peerSenderKeys ?? {}),
                    [senderId]: skState,
                  },
                },
              };
            });
            return;
          }

          if (data.type === 'group:envelope') {
            const envelope = data.envelope as EncryptedGroupEnvelope;
            const attachment = data.attachment as EncryptedAttachmentPayload | undefined;
            const ttlSec = Number(data.ephemeralTtlSec || 0);
            const roomId = envelope.roomId;

            const peerSk =
              conversationsRef.current[roomId]?.peerSenderKeys?.[envelope.senderId];
            if (!peerSk) return;

            const decrypted = await decryptGroupMessage(peerSk, envelope);

            const senderName =
              peerDirectoryRef.current[envelope.senderId]?.name ?? envelope.senderId;

            const replyTarget = envelope.replyToId
              ? (messagesRef.current[roomId] ?? []).find(
                  (m) => m.id === envelope.replyToId
                )
              : undefined;

            const newMsg: ChatMessage = {
              id: envelope.id,
              conversationId: roomId,
              kind: 'group',
              senderId: envelope.senderId,
              senderName,
              text: decrypted.plaintext,
              timestamp: envelope.timestamp,
              status: 'read',
              threadRootId: envelope.threadRootId,
              replyTo: replyTarget
                ? {
                    id: replyTarget.id,
                    senderName: replyTarget.senderName,
                    text: replyTarget.text,
                  }
                : null,
              groupEnvelope: envelope,
              attachment,
              expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : undefined,
            };

            const currRoomBefore = conversationsRef.current[roomId];
            const existingList = messagesRef.current[roomId] ?? [];
            if (!existingList.some((m) => m.id === newMsg.id)) {
              const updatedList = [...existingList, newMsg];
              messagesRef.current = {
                ...messagesRef.current,
                [roomId]: updatedList,
              };
              setMessagesByConv((prev) => {
                const list = prev[roomId] ?? [];
                if (list.some((m) => m.id === newMsg.id)) return prev;
                return { ...prev, [roomId]: [...list, newMsg] };
              });
              void saveMessageToVault(newMsg);

              const blurred =
                windowBlurredRef.current ||
                isWindowBlurred({
                  hasFocus:
                    typeof document !== 'undefined' ? document.hasFocus() : true,
                  visibilityState:
                    typeof document !== 'undefined'
                      ? document.visibilityState
                      : 'visible',
                });
              if (
                shouldTriggerDesktopNotification({
                  permission: notificationPermissionRef.current,
                  enabled: notificationsEnabledRef.current,
                  windowBlurred: blurred,
                  isOwnMessage: newMsg.senderId === localBundle.userId,
                  isConversationMuted: Boolean(currRoomBefore?.isMuted),
                  presence: presenceRef.current,
                })
              ) {
                const notifPayload = buildDesktopNotificationPayload({
                  conversationId: roomId,
                  conversationKind:
                    currRoomBefore?.kind === 'private' ? 'private' : 'channel',
                  conversationName: currRoomBefore?.name ?? roomId,
                  senderName,
                  messageId: newMsg.id,
                  text: decrypted.plaintext,
                  attachmentFileName: attachment?.fileName,
                });
                showDesktopNotification(notifPayload, (targetConvId) => {
                  selectConversationRef.current(targetConvId);
                });
              }
            }

            const currRoom = conversationsRef.current[roomId];
            if (currRoom) {
              const isCurrent = activeIdRef.current === roomId;
              const nextConvs = {
                ...conversationsRef.current,
                [roomId]: {
                  ...currRoom,
                  peerSenderKeys: {
                    ...(currRoom.peerSenderKeys ?? {}),
                    [envelope.senderId]: decrypted.nextState,
                  },
                  lastMessagePreview: envelope.threadRootId
                    ? currRoom.lastMessagePreview || decrypted.plaintext
                    : decrypted.plaintext,
                  lastMessageAt: envelope.timestamp,
                  unreadCount: isCurrent ? 0 : currRoom.unreadCount + 1,
                },
              };
              conversationsRef.current = nextConvs;
              saveRatchetStateFromConversations(localBundle.userId, nextConvs);
            }

            setConversations((prev) => {
              const curr = prev[roomId];
              if (!curr) return prev;
              const isCurrent = activeIdRef.current === roomId;
              return {
                ...prev,
                [roomId]: {
                  ...curr,
                  peerSenderKeys: {
                    ...(curr.peerSenderKeys ?? {}),
                    [envelope.senderId]: decrypted.nextState,
                  },
                  lastMessagePreview: envelope.threadRootId
                    ? curr.lastMessagePreview || decrypted.plaintext
                    : decrypted.plaintext,
                  lastMessageAt: envelope.timestamp,
                  unreadCount: isCurrent ? 0 : curr.unreadCount + 1,
                },
              };
            });
            return;
          }

          if (data.type === 'msg:envelope') {
            const envelope = data.envelope as EncryptedEnvelope;
            const attachment = data.attachment as EncryptedAttachmentPayload | undefined;
            const ttlSec = Number(data.ephemeralTtlSec || 0);
            const peerId = envelope.senderId;

            const currentSession = conversationsRef.current[peerId]?.session;
            if (!currentSession) return;

            const decrypted = await decryptMessage(currentSession, envelope);

            const senderName =
              peerDirectoryRef.current[peerId]?.name ?? peerId;

            const replyTarget = envelope.replyToId
              ? (messagesRef.current[peerId] ?? []).find(
                  (m) => m.id === envelope.replyToId
                )
              : undefined;

            const newMessage: ChatMessage = {
              id: envelope.id,
              conversationId: peerId,
              kind: 'dm',
              senderId: peerId,
              senderName,
              text: decrypted.plaintext,
              timestamp: envelope.timestamp,
              status: 'read',
              threadRootId: envelope.threadRootId,
              replyTo: replyTarget
                ? {
                    id: replyTarget.id,
                    senderName: replyTarget.senderName,
                    text: replyTarget.text,
                  }
                : null,
              dmEnvelope: envelope,
              attachment,
              expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : undefined,
            };

            const currPeerBefore = conversationsRef.current[peerId];
            const existingList = messagesRef.current[peerId] ?? [];
            if (!existingList.some((m) => m.id === newMessage.id)) {
              messagesRef.current = {
                ...messagesRef.current,
                [peerId]: [...existingList, newMessage],
              };
              setMessagesByConv((prev) => {
                const list = prev[peerId] ?? [];
                if (list.some((m) => m.id === newMessage.id)) return prev;
                return { ...prev, [peerId]: [...list, newMessage] };
              });
              void saveMessageToVault(newMessage);

              const blurred =
                windowBlurredRef.current ||
                isWindowBlurred({
                  hasFocus:
                    typeof document !== 'undefined' ? document.hasFocus() : true,
                  visibilityState:
                    typeof document !== 'undefined'
                      ? document.visibilityState
                      : 'visible',
                });
              if (
                shouldTriggerDesktopNotification({
                  permission: notificationPermissionRef.current,
                  enabled: notificationsEnabledRef.current,
                  windowBlurred: blurred,
                  isOwnMessage: newMessage.senderId === localBundle.userId,
                  isConversationMuted: Boolean(currPeerBefore?.isMuted),
                  presence: presenceRef.current,
                })
              ) {
                const notifPayload = buildDesktopNotificationPayload({
                  conversationId: peerId,
                  conversationKind: 'dm',
                  conversationName: currPeerBefore?.name ?? senderName,
                  senderName,
                  messageId: newMessage.id,
                  text: decrypted.plaintext,
                  attachmentFileName: attachment?.fileName,
                });
                showDesktopNotification(notifPayload, (targetConvId) => {
                  selectConversationRef.current(targetConvId);
                });
              }
            }

            const currPeer = conversationsRef.current[peerId];
            if (currPeer) {
              const isCurrent = activeIdRef.current === peerId;
              const nextConvs = {
                ...conversationsRef.current,
                [peerId]: {
                  ...currPeer,
                  session: decrypted.nextSession,
                  typingUsers: [],
                  lastMessagePreview: envelope.threadRootId
                    ? currPeer.lastMessagePreview || decrypted.plaintext
                    : decrypted.plaintext,
                  lastMessageAt: envelope.timestamp,
                  unreadCount: isCurrent ? 0 : currPeer.unreadCount + 1,
                },
              };
              conversationsRef.current = nextConvs;
              saveRatchetStateFromConversations(localBundle.userId, nextConvs);
            }

            setConversations((prev) => {
              const curr = prev[peerId];
              if (!curr) return prev;
              const isCurrent = activeIdRef.current === peerId;
              return {
                ...prev,
                [peerId]: {
                  ...curr,
                  session: decrypted.nextSession,
                  typingUsers: [],
                  lastMessagePreview: envelope.threadRootId
                    ? curr.lastMessagePreview || decrypted.plaintext
                    : decrypted.plaintext,
                  lastMessageAt: envelope.timestamp,
                  unreadCount: isCurrent ? 0 : curr.unreadCount + 1,
                },
              };
            });
            return;
          }

          if (data.type === 'typing:state') {
            const { conversationId, userName, isTyping } = data as {
              conversationId: string;
              userName: string;
              isTyping: boolean;
            };
            setConversations((prev) => {
              const curr = prev[conversationId];
              if (!curr) return prev;
              return {
                ...prev,
                [conversationId]: {
                  ...curr,
                  typingUsers: isTyping ? [userName] : [],
                },
              };
            });
            return;
          }

          if (data.type === 'msg:receipt') {
            const { messageId, peerId, status } = data as {
              messageId: string;
              peerId: string;
              status: 'delivered' | 'read';
            };
            const currList = messagesRef.current[peerId];
            if (currList) {
              const nextList = currList.map((m) =>
                m.id === messageId ? { ...m, status } : m
              );
              messagesRef.current = { ...messagesRef.current, [peerId]: nextList };
              const updated = nextList.find((m) => m.id === messageId);
              if (updated) void saveMessageToVault(updated);
            }
            setMessagesByConv((prev) => {
              const list = prev[peerId];
              if (!list) return prev;
              return {
                ...prev,
                [peerId]: list.map((m) =>
                  m.id === messageId ? { ...m, status } : m
                ),
              };
            });
            return;
          }

          if (data.type === 'msg:edit') {
            const { conversationId, messageId, text } = data as {
              conversationId: string;
              messageId: string;
              text: string;
            };
            const currList = messagesRef.current[conversationId];
            if (currList) {
              const nextList = currList.map((m) =>
                m.id === messageId ? { ...m, text, isEdited: true } : m
              );
              messagesRef.current = {
                ...messagesRef.current,
                [conversationId]: nextList,
              };
              const updated = nextList.find((m) => m.id === messageId);
              if (updated) void saveMessageToVault(updated);
            }
            setMessagesByConv((prev) => {
              const list = prev[conversationId];
              if (!list) return prev;
              return {
                ...prev,
                [conversationId]: list.map((m) =>
                  m.id === messageId ? { ...m, text, isEdited: true } : m
                ),
              };
            });
            return;
          }

          if (data.type === 'msg:delete') {
            const { conversationId, messageId } = data as {
              conversationId: string;
              messageId: string;
            };
            const currList = messagesRef.current[conversationId];
            if (currList) {
              const nextList = currList.map((m) =>
                m.id === messageId
                  ? { ...m, isDeleted: true, text: 'Сообщение удалено' }
                  : m
              );
              messagesRef.current = {
                ...messagesRef.current,
                [conversationId]: nextList,
              };
              const updated = nextList.find((m) => m.id === messageId);
              if (updated) void saveMessageToVault(updated);
            }
            setMessagesByConv((prev) => {
              const list = prev[conversationId];
              if (!list) return prev;
              return {
                ...prev,
                [conversationId]: list.map((m) =>
                  m.id === messageId
                    ? { ...m, isDeleted: true, text: 'Сообщение удалено' }
                    : m
                ),
              };
            });
            return;
          }

          if (data.type === 'msg:pin') {
            const { conversationId, messageId, isPinned } = data as {
              conversationId: string;
              messageId: string;
              isPinned: boolean;
            };
            const currList = messagesRef.current[conversationId];
            if (currList) {
              const nextList = currList.map((m) =>
                m.id === messageId ? { ...m, isPinned } : m
              );
              messagesRef.current = {
                ...messagesRef.current,
                [conversationId]: nextList,
              };
              const updated = nextList.find((m) => m.id === messageId);
              if (updated) void saveMessageToVault(updated);
            }
            setMessagesByConv((prev) => {
              const list = prev[conversationId];
              if (!list) return prev;
              return {
                ...prev,
                [conversationId]: list.map((m) =>
                  m.id === messageId ? { ...m, isPinned } : m
                ),
              };
            });
            return;
          }

          if (data.type === 'msg:reaction') {
            const { conversationId, messageId, emoji, userId, action } = data as {
              conversationId: string;
              messageId: string;
              emoji: string;
              userId: string;
              action: ReactionAction;
            };
            const currList = messagesRef.current[conversationId];
            if (currList) {
              const nextList = currList.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      reactions: applyReactionUpdate(
                        m.reactions,
                        emoji,
                        userId,
                        action
                      ),
                    }
                  : m
              );
              messagesRef.current = {
                ...messagesRef.current,
                [conversationId]: nextList,
              };
              const updated = nextList.find((m) => m.id === messageId);
              if (updated) void saveMessageToVault(updated);
            }
            setMessagesByConv((prev) => {
              const list = prev[conversationId];
              if (!list) return prev;
              return {
                ...prev,
                [conversationId]: list.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        reactions: applyReactionUpdate(
                          m.reactions,
                          emoji,
                          userId,
                          action
                        ),
                      }
                    : m
                ),
              };
            });
            return;
          }

          if (data.type === 'policy:updated') {
            const nextPolicy = data.policy as EnterprisePolicy;
            if (nextPolicy) {
              setEnterprisePolicy(nextPolicy);
            }
            return;
          }

          if (data.type === 'auth:error') {
            // Never kick the user out of their account on invalid/expired WS token;
            // pause WS reconnect and prompt inline reconnection instead.
            disposed = true;
            setSessionWarning(
              (data.error as string) ||
                'Сессия на сервере устарела. Подтвердите пароль, чтобы продолжить синхронизацию.'
            );
            setWsConnected(false);
            ws.close();
            return;
          }

          if (data.type === 'account:status') {
            const { isActive, role } = data as {
              isActive?: boolean;
              role?: EnterpriseRole;
            };
            if (isActive !== undefined) setIsSuspended(!isActive);
            if (role) {
              setCurrentUserRole(role);
              setCurrentUser((prev) => {
                if (!prev) return prev;
                const next = { ...prev, role };
                sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(next));
                return next;
              });
            }
          }
        } catch (err) {
          console.error('WS handling error:', err);
        }
      };

      ws.onmessage = (event) => {
        clientMsgQueue = clientMsgQueue.then(() => processIncomingMessage(event));
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [localBundle, distributeRoomSenderKey, ensureDmSession, ensureRoomSenderKey, saveMessageToVault]);

  // Disappearing messages cleanup
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setMessagesByConv((prev) => {
        let changed = false;
        const next: Record<string, ChatMessage[]> = {};
        for (const [cid, list] of Object.entries(prev)) {
          if (list.some((m) => m.expiresAt !== undefined && m.expiresAt <= now)) {
            changed = true;
            next[cid] = list.filter(
              (m) => m.expiresAt === undefined || m.expiresAt > now
            );
          } else {
            next[cid] = list;
          }
        }
        if (changed) {
          messagesRef.current = next;
          return next;
        }
        return prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleSelectConversation = useCallback(
    (id: string) => {
      setViewMode('chat');
      setActiveId(id);
      setMobileShowChat(true);
      setReplyTo(null);
      setActiveThreadRootId(null);
      setSearchOpen(false);
      setSearchQuery('');
      setPinnedOpen(false);
      setConversations((prev) => {
        const curr = prev[id];
        if (!curr) return prev;
        return { ...prev, [id]: { ...curr, unreadCount: 0 } };
      });
      const conv = conversationsRef.current[id];
      if (conv?.kind === 'dm') {
        void ensureDmSession(id);
      } else if (conv) {
        void ensureRoomSenderKey(id);
      }
    },
    [ensureDmSession, ensureRoomSenderKey]
  );
  selectConversationRef.current = handleSelectConversation;

  const handleOpenAdminPanel = useCallback(() => {
    if (!canAccessManagementConsole(currentUserRole)) return;
    setViewMode('admin');
    setMobileShowChat(true);
    setMembersOpen(false);
    setActiveThreadRootId(null);
  }, [currentUserRole]);

  const handleOpenThread = useCallback((message: ChatMessage) => {
    setActiveThreadRootId(message.id);
    setMembersOpen(false);
  }, []);

  const handleSendMessage = useCallback(
    async (
      text: string,
      attachment?: EncryptedAttachmentPayload,
      options?: { threadRootId?: string }
    ) => {
      const myBundle = localBundleRef.current;
      const convId = activeIdRef.current;
      const conv = conversationsRef.current[convId];
      if (!myBundle || !conv) return;
      if (
        conv.kind !== 'dm' &&
        !canPostInChannel(currentUserRole, {
          isArchived: conv.isArchived,
          onlyAdminsCanPost: conv.onlyAdminsCanPost,
        })
      ) {
        return;
      }

      const ttlSec = conv.disappearingTtlSec ?? 0;
      const expiresAt = ttlSec > 0 ? Date.now() + ttlSec * 1000 : undefined;
      const threadRootId = options?.threadRootId;
      const activeReply = threadRootId ? null : replyTo;

      if (conv.kind === 'dm') {
        const session = conv.session ?? (await ensureDmSession(convId));
        if (!session) return;

        const { envelope, nextSession } = await encryptMessage(
          session,
          myBundle.userId,
          text,
          {
            threadRootId,
            replyToId: activeReply?.id,
          }
        );

        const message: ChatMessage = {
          id: envelope.id,
          conversationId: convId,
          kind: 'dm',
          senderId: myBundle.userId,
          senderName: 'Вы',
          text,
          timestamp: envelope.timestamp,
          status: 'sent',
          threadRootId,
          replyTo: activeReply
            ? {
                id: activeReply.id,
                senderName: activeReply.senderName,
                text: activeReply.text,
              }
            : null,
          dmEnvelope: envelope,
          attachment,
          expiresAt,
        };

        if (conversationsRef.current[convId]) {
          const nextConvs = {
            ...conversationsRef.current,
            [convId]: {
              ...conversationsRef.current[convId],
              session: nextSession,
              lastMessagePreview: threadRootId
                ? conversationsRef.current[convId].lastMessagePreview || text
                : text,
              lastMessageAt: envelope.timestamp,
            },
          };
          conversationsRef.current = nextConvs;
          saveRatchetStateFromConversations(myBundle.userId, nextConvs);
        }
        setConversations((prev) => {
          const curr = prev[convId];
          if (!curr) return prev;
          return {
            ...prev,
            [convId]: {
              ...curr,
              session: nextSession,
              lastMessagePreview: threadRootId
                ? curr.lastMessagePreview || text
                : text,
              lastMessageAt: envelope.timestamp,
            },
          };
        });

        messagesRef.current = {
          ...messagesRef.current,
          [convId]: [...(messagesRef.current[convId] ?? []), message],
        };
        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] ?? []), message],
        }));
        if (!threadRootId) setReplyTo(null);

        void saveMessageToVault(message);

        wsRef.current?.send(
          JSON.stringify({
            type: 'msg:envelope',
            envelope,
            attachment,
            ephemeralTtlSec: ttlSec,
          })
        );
      } else {
        const sk = conv.selfSenderKey ?? (await ensureRoomSenderKey(convId));
        if (!sk) return;

        const { envelope, nextState } = await encryptGroupMessage(sk, text, {
          replyToId: activeReply?.id,
          threadRootId,
        });

        const message: ChatMessage = {
          id: envelope.id,
          conversationId: convId,
          kind: 'group',
          senderId: myBundle.userId,
          senderName: 'Вы',
          text,
          timestamp: envelope.timestamp,
          status: 'read',
          threadRootId,
          replyTo: activeReply
            ? {
                id: activeReply.id,
                senderName: activeReply.senderName,
                text: activeReply.text,
              }
            : null,
          groupEnvelope: envelope,
          attachment,
          expiresAt,
        };

        if (conversationsRef.current[convId]) {
          const nextConvs = {
            ...conversationsRef.current,
            [convId]: {
              ...conversationsRef.current[convId],
              selfSenderKey: nextState,
              lastMessagePreview: threadRootId
                ? conversationsRef.current[convId].lastMessagePreview || text
                : text,
              lastMessageAt: envelope.timestamp,
            },
          };
          conversationsRef.current = nextConvs;
          saveRatchetStateFromConversations(myBundle.userId, nextConvs);
        }

        setConversations((prev) => {
          const curr = prev[convId];
          if (!curr) return prev;
          return {
            ...prev,
            [convId]: {
              ...curr,
              selfSenderKey: nextState,
              lastMessagePreview: threadRootId
                ? curr.lastMessagePreview || text
                : text,
              lastMessageAt: envelope.timestamp,
            },
          };
        });

        messagesRef.current = {
          ...messagesRef.current,
          [convId]: [...(messagesRef.current[convId] ?? []), message],
        };
        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] ?? []), message],
        }));
        if (!threadRootId) setReplyTo(null);

        void saveMessageToVault(message);

        wsRef.current?.send(
          JSON.stringify({
            type: 'group:envelope',
            envelope,
            attachment,
            ephemeralTtlSec: ttlSec,
          })
        );
      }
    },
    [replyTo, ensureDmSession, ensureRoomSenderKey, currentUserRole, saveMessageToVault]
  );

  const handleSendThreadReply = useCallback(
    async (text: string, threadRootId: string) => {
      await handleSendMessage(text, undefined, { threadRootId });
    },
    [handleSendMessage]
  );

  const handleEditMessage = useCallback(
    async (messageId: string, newText: string) => {
      const convId = activeIdRef.current;
      const conv = conversationsRef.current[convId];
      const currList = messagesRef.current[convId] ?? [];
      const nextList = currList.map((m) =>
        m.id === messageId ? { ...m, text: newText, isEdited: true } : m
      );
      messagesRef.current = { ...messagesRef.current, [convId]: nextList };
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === messageId ? { ...m, text: newText, isEdited: true } : m
        ),
      }));
      const updated = nextList.find((m) => m.id === messageId);
      if (updated) void saveMessageToVault(updated);
      wsRef.current?.send(
        JSON.stringify({
          type: 'msg:edit',
          conversationId: convId,
          kind: conv?.kind === 'dm' ? 'dm' : 'group',
          messageId,
          text: newText,
        })
      );
    },
    [saveMessageToVault]
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      const convId = activeIdRef.current;
      const conv = conversationsRef.current[convId];
      const currList = messagesRef.current[convId] ?? [];
      const nextList = currList.map((m) =>
        m.id === messageId
          ? { ...m, isDeleted: true, text: 'Сообщение удалено' }
          : m
      );
      messagesRef.current = { ...messagesRef.current, [convId]: nextList };
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === messageId
            ? { ...m, isDeleted: true, text: 'Сообщение удалено' }
            : m
        ),
      }));
      const updated = nextList.find((m) => m.id === messageId);
      if (updated) void saveMessageToVault(updated);
      wsRef.current?.send(
        JSON.stringify({
          type: 'msg:delete',
          conversationId: convId,
          kind: conv?.kind === 'dm' ? 'dm' : 'group',
          messageId,
        })
      );
    },
    [saveMessageToVault]
  );

  const handleTogglePin = useCallback(
    (messageId: string) => {
      const convId = activeIdRef.current;
      const conv = conversationsRef.current[convId];
      const currList = messagesRef.current[convId] ?? [];
      const target = currList.find((m) => m.id === messageId);
      const nextPinned = target ? !target.isPinned : true;
      const nextList = currList.map((m) =>
        m.id === messageId ? { ...m, isPinned: nextPinned } : m
      );
      messagesRef.current = { ...messagesRef.current, [convId]: nextList };
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === messageId ? { ...m, isPinned: nextPinned } : m
        ),
      }));
      const updated = nextList.find((m) => m.id === messageId);
      if (updated) void saveMessageToVault(updated);
      wsRef.current?.send(
        JSON.stringify({
          type: 'msg:pin',
          conversationId: convId,
          kind: conv?.kind === 'dm' ? 'dm' : 'group',
          messageId,
          isPinned: nextPinned,
        })
      );
    },
    [saveMessageToVault]
  );

  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      const convId = activeIdRef.current;
      const conv = conversationsRef.current[convId];
      const myId = localBundleRef.current?.userId;
      if (!myId || !conv) return;

      const currentMsg = (messagesRef.current[convId] ?? []).find(
        (m) => m.id === messageId
      );
      if (!currentMsg || currentMsg.isDeleted) return;

      const { nextReactions, action } = toggleReaction(
        currentMsg.reactions,
        emoji,
        myId
      );

      const nextList = (messagesRef.current[convId] ?? []).map((m) =>
        m.id === messageId ? { ...m, reactions: nextReactions } : m
      );
      messagesRef.current = { ...messagesRef.current, [convId]: nextList };

      setMessagesByConv((prev) => {
        const list = prev[convId];
        if (!list) return prev;
        return {
          ...prev,
          [convId]: list.map((m) =>
            m.id === messageId ? { ...m, reactions: nextReactions } : m
          ),
        };
      });

      const updated = nextList.find((m) => m.id === messageId);
      if (updated) void saveMessageToVault(updated);

      wsRef.current?.send(
        JSON.stringify({
          type: 'msg:reaction',
          conversationId: convId,
          kind: conv.kind === 'dm' ? 'dm' : 'group',
          messageId,
          emoji,
          userId: myId,
          action,
        })
      );
    },
    [saveMessageToVault]
  );

  const handleCreateRoom = useCallback(
    (payload: {
      name: string;
      description: string;
      topic: string;
      department: string;
      category: ChannelCategory;
      kind: 'channel' | 'private';
      onlyAdminsCanPost: boolean;
    }) => {
      const uid = localBundleRef.current?.userId;
      if (!uid) return;
      wsRef.current?.send(
        JSON.stringify({
          type: 'room:create',
          ...payload,
          creatorId: uid,
        })
      );
    },
    []
  );

  const handleJoinChannel = useCallback((roomId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'room:join', roomId }));
  }, []);

  const handleLeaveChannel = useCallback((roomId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'room:leave', roomId }));
  }, []);

  const handleUpdateRoom = useCallback(
    (payload: {
      roomId: string;
      description: string;
      topic: string;
      department: string;
      category: ChannelCategory;
      onlyAdminsCanPost: boolean;
      isArchived: boolean;
      memberIds: string[];
    }) => {
      wsRef.current?.send(
        JSON.stringify({
          type: 'room:update',
          ...payload,
        })
      );
    },
    []
  );

  const handleToggleMuteChannel = useCallback((roomId: string) => {
    setConversations((prev) => {
      const curr = prev[roomId];
      if (!curr) return prev;
      return {
        ...prev,
        [roomId]: { ...curr, isMuted: !curr.isMuted },
      };
    });
  }, []);

  const handleChangePresence = useCallback((p: PresenceState) => {
    setPresence(p);
    wsRef.current?.send(JSON.stringify({ type: 'presence:update', presence: p }));
  }, []);

  const handleToggleDesktopNotifications = useCallback(async () => {
    const currentPerm = getNotificationPermissionState();
    setNotificationPermission(currentPerm);
    if (currentPerm === 'unsupported') return;

    if (currentPerm === 'default') {
      const nextPerm = await requestDesktopNotificationPermission();
      setNotificationPermission(nextPerm);
      if (nextPerm === 'granted') {
        setDesktopNotificationsEnabled(true);
        try {
          localStorage.setItem(DESKTOP_NOTIF_ENABLED_KEY, 'true');
        } catch {
          // ignore storage quota errors
        }
      }
      return;
    }

    if (currentPerm === 'granted') {
      setDesktopNotificationsEnabled((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(DESKTOP_NOTIF_ENABLED_KEY, String(next));
        } catch {
          // ignore storage quota errors
        }
        return next;
      });
    }
  }, []);

  const handleToggleVerified = useCallback((id: string) => {
    setConversations((prev) => {
      const curr = prev[id];
      if (!curr) return prev;
      return { ...prev, [id]: { ...curr, verified: !curr.verified } };
    });
  }, []);

  const handleResetKeys = useCallback(
    async (id: string) => {
      const conv = conversationsRef.current[id];
      const myBundle = localBundleRef.current;
      if (!conv || !myBundle) return;

      if (conv.kind === 'dm' && conv.bundle) {
        const { session, ephemeralPublicB64 } = await establishSessionAsInitiator(
          myBundle,
          conv.bundle
        );
        const nextConvs = {
          ...conversationsRef.current,
          [id]: { ...conversationsRef.current[id], session },
        };
        conversationsRef.current = nextConvs;
        saveRatchetStateFromConversations(myBundle.userId, nextConvs);
        setConversations((prev) => ({
          ...prev,
          [id]: { ...prev[id], session },
        }));
        wsRef.current?.send(
          JSON.stringify({
            type: 'session:init',
            senderId: myBundle.userId,
            receiverId: id,
            senderBundle: extractPublicPreKeyBundle(myBundle),
            ephemeralPublicB64,
          })
        );
      } else {
        const sk = await createSenderKeyState(id, myBundle.userId);
        const nextConvs = {
          ...conversationsRef.current,
          [id]: { ...conversationsRef.current[id], selfSenderKey: sk },
        };
        conversationsRef.current = nextConvs;
        saveRatchetStateFromConversations(myBundle.userId, nextConvs);
        setConversations((prev) => ({
          ...prev,
          [id]: { ...prev[id], selfSenderKey: sk },
        }));
        await distributeRoomSenderKey(id, sk);
      }
    },
    [distributeRoomSenderKey]
  );

  const handleChangeDisappearingTtl = useCallback((sec: number) => {
    const id = activeIdRef.current;
    setConversations((prev) => {
      const curr = prev[id];
      if (!curr) return prev;
      return { ...prev, [id]: { ...curr, disappearingTtlSec: sec } };
    });
  }, []);

  const handleJumpToMessage = useCallback((msgId: string) => {
    setHighlightedMessageId(msgId);
    setSearchOpen(false);
    setPinnedOpen(false);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
    }, 2400);
  }, []);

  const conversationList = useMemo(
    () => Object.values(conversations),
    [conversations]
  );

  const activeConversation = conversations[activeId] ?? null;
  const activeMessages = messagesByConv[activeId] ?? EMPTY_MESSAGES;

  const { mainMessages, repliesByRoot, threadSummaries } = useMemo(
    () => partitionThreadMessages(activeMessages),
    [activeMessages]
  );

  const activeThreadRoot = useMemo(
    () =>
      activeThreadRootId
        ? mainMessages.find((m) => m.id === activeThreadRootId) ?? null
        : null,
    [mainMessages, activeThreadRootId]
  );

  const activeThreadReplies = useMemo(
    () => (activeThreadRootId ? repliesByRoot[activeThreadRootId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES),
    [repliesByRoot, activeThreadRootId]
  );

  // Client-side instant E2EE search across decrypted top-level messages
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches: ChatMessage[] = [];
    for (let i = mainMessages.length - 1; i >= 0; i--) {
      const m = mainMessages[i];
      if (!m.isDeleted && m.text.toLowerCase().includes(q)) {
        matches.push(m);
        if (matches.length >= 25) break;
      }
    }
    return matches;
  }, [mainMessages, searchQuery]);

  const pinnedMessages = useMemo(
    () => mainMessages.filter((m) => m.isPinned && !m.isDeleted),
    [mainMessages]
  );

  const peerConversations = useMemo(
    () => conversationList.filter((c) => c.kind === 'dm'),
    [conversationList]
  );

  const channelConversations = useMemo(
    () =>
      conversationList.filter(
        (c) => c.kind === 'channel' || c.kind === 'private'
      ),
    [conversationList]
  );

  const allowAttachmentDownload = useMemo(
    () => canDownloadAttachments(currentUserRole, enterprisePolicy),
    [currentUserRole, enterprisePolicy]
  );

  const canPostActive = useMemo(() => {
    if (!activeConversation) return false;
    if (activeConversation.kind === 'dm') return !activeConversation.isArchived;
    return canPostInChannel(currentUserRole, {
      isArchived: activeConversation.isArchived,
      onlyAdminsCanPost: activeConversation.onlyAdminsCanPost,
    });
  }, [activeConversation, currentUserRole]);

  const handleAuthenticated = useCallback(
    ({ user, token }: { token: string; user: AuthUser }) => {
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);
      sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      setAuthToken(token);
      setAuthError(null);
      setSessionWarning(null);
      setReauthError(null);
      setReauthPassword('');
      setCurrentUser(user);
      setCurrentUserRole(user.role);
      setIsSuspended(!user.isActive);
      setViewMode('chat');
      setActiveId('room-general');
      setAuthLoading(false);
    },
    []
  );

  const handleRefreshSession = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!currentUser || !reauthPassword) return;
      setReauthBusy(true);
      setReauthError(null);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: currentUser.email,
            password: reauthPassword,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          token?: string;
          user?: AuthUser;
        };
        if (!res.ok || !data.token || !data.user) {
          throw new Error(data.error || 'Неверный пароль');
        }
        sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
        sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        setAuthToken(data.token);
        setCurrentUser(data.user);
        setCurrentUserRole(data.user.role);
        setIsSuspended(!data.user.isActive);
        setSessionWarning(null);
        setReauthPassword('');
        // Force clean WS reconnect with fresh token
        wsRef.current?.close();
        const refreshedBundle = await loadOrCreateIdentityBundle(data.user.userId);
        localBundleRef.current = { ...refreshedBundle };
        setLocalBundle({ ...refreshedBundle });
      } catch (err) {
        setReauthError(err instanceof Error ? err.message : 'Ошибка обновления сессии');
      } finally {
        setReauthBusy(false);
      }
    },
    [currentUser, reauthPassword]
  );

  const handleLogout = useCallback(async () => {
    const token = authTokenRef.current;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch {
      // ignore network error on logout
    }
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    wsRef.current?.close();
    wsRef.current = null;
    localBundleRef.current = null;
    vaultKeyRef.current = null;
    pendingVaultSavesRef.current = [];
    peerDirectoryRef.current = {};
    conversationsRef.current = {};
    messagesRef.current = {};
    setLocalBundle(null);
    setWsConnected(false);
    setAuthToken(null);
    setCurrentUser(null);
    setSessionWarning(null);
    setReauthPassword('');
    setReauthError(null);
    setConversations({});
    setMessagesByConv({});
    setActiveThreadRootId(null);
    setMembersOpen(false);
    setReplyTo(null);
    setViewMode('chat');
    setMobileShowChat(false);
    setAuthError(null);
  }, []);

  const showAdminPanel =
    viewMode === 'admin' && canAccessManagementConsole(currentUserRole);

  if (authLoading) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-sm">
        Проверка корпоративной сессии…
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        initialError={authError}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div
        className={`${
          mobileShowChat ? 'hidden md:flex' : 'flex'
        } w-full md:w-auto h-full`}
      >
        <Sidebar
          conversations={conversationList}
          activeId={activeId}
          viewMode={showAdminPanel ? 'admin' : 'chat'}
          onSelectConversation={handleSelectConversation}
          onOpenAdminPanel={handleOpenAdminPanel}
          onOpenCreateRoom={() => setCreateRoomOpen(true)}
          onOpenChannelDirectory={() => setChannelDirectoryOpen(true)}
          currentUser={currentUser}
          enterprisePolicy={enterprisePolicy}
          presence={presence}
          onChangePresence={handleChangePresence}
          onLogout={() => void handleLogout()}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          wsConnected={wsConnected}
          notificationPermission={notificationPermission}
          desktopNotificationsEnabled={desktopNotificationsEnabled}
          onToggleDesktopNotifications={() => void handleToggleDesktopNotifications()}
        />
      </div>

      {showAdminPanel ? (
        <div
          className={`${
            mobileShowChat ? 'flex' : 'hidden md:flex'
          } flex-1 min-w-0 h-full`}
        >
          <AdminPanel
            authToken={authToken ?? ''}
            localUserId={currentUser.userId}
            localUserName={currentUser.name}
            currentUserRole={currentUserRole}
            onBackToChats={() => {
              setViewMode('chat');
              setMobileShowChat(false);
            }}
            onPolicySynced={setEnterprisePolicy}
          />
        </div>
      ) : (
        <main
          className={`${
            mobileShowChat ? 'flex' : 'hidden md:flex'
          } flex-1 min-w-0 h-full flex-col relative`}
        >
        <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-3 relative z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileShowChat(false)}
              aria-label="Назад к списку"
              className="md:hidden w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {activeConversation?.category === 'announcement' ? (
                  <Megaphone className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                ) : activeConversation?.kind === 'private' ? (
                  <Lock className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                ) : activeConversation?.kind === 'channel' ? (
                  <Hash className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                ) : null}
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {activeConversation?.name ?? 'Выберите диалог'}
                </h2>
              </div>
              {activeConversation && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {activeConversation.typingUsers.length > 0
                    ? `${activeConversation.typingUsers[0]} печатает…`
                    : activeConversation.kind === 'dm'
                    ? activeConversation.verified
                      ? 'Ключ подтверждён · Сквозное шифрование'
                      : 'Сквозное шифрование'
                    : [
                        activeConversation.department || 'Корпоративный канал',
                        `${activeConversation.memberIds?.length ?? 0} уч.`,
                        activeConversation.topic || activeConversation.subtitle,
                      ].join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSearchOpen((v) => !v);
                setPinnedOpen(false);
              }}
              aria-label="Поиск по расшифрованным сообщениям"
              className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                searchOpen
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            {activeConversation && activeConversation.kind !== 'dm' && (
              <button
                type="button"
                onClick={() => handleToggleMuteChannel(activeConversation.id)}
                aria-label={
                  activeConversation.isMuted
                    ? 'Включить уведомления канала'
                    : 'Отключить уведомления канала'
                }
                title={
                  activeConversation.isMuted
                    ? 'Уведомления отключены'
                    : 'Уведомления включены'
                }
                className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                  activeConversation.isMuted
                    ? 'border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
                }`}
              >
                {activeConversation.isMuted ? (
                  <BellOff className="w-4 h-4" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
              </button>
            )}

            {activeConversation &&
              activeConversation.kind !== 'dm' &&
              canManageChannels(currentUserRole) && (
                <button
                  type="button"
                  onClick={() => setChannelSettingsOpen(true)}
                  aria-label="Параметры канала"
                  title="Настройки доступа и регламента канала"
                  className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center justify-center transition-colors shrink-0"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}

            <button
              type="button"
              onClick={() => {
                setPinnedOpen((v) => !v);
                setSearchOpen(false);
              }}
              aria-label="Закреплённые сообщения"
              className={`h-9 px-2.5 rounded-xl border inline-flex items-center gap-1 text-xs font-medium transition-colors shrink-0 ${
                pinnedOpen
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
              {pinnedMessages.length > 0 && (
                <span className="font-mono tabular-nums">{pinnedMessages.length}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSecurityOpen(true)}
              disabled={!activeConversation}
              aria-label="Код безопасности и ключи"
              className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {activeConversation?.verified ? (
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              )}
              <span className="hidden lg:inline">Безопасность</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMembersOpen((v) => !v);
                setActiveThreadRootId(null);
              }}
              aria-label="Участники переписки"
              aria-expanded={membersOpen}
              className={`h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                membersOpen
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              <span className="hidden lg:inline">Участники</span>
            </button>
          </div>

          {/* Client-side Encrypted Search Popover */}
          {searchOpen && (
            <div className="absolute right-4 top-14 w-80 sm:w-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden z-30">
              <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по сообщениям…"
                  autoFocus
                  className="flex-1 bg-transparent text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  aria-label="Закрыть поиск"
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {!searchQuery.trim() ? (
                  <p className="p-4 text-xs text-slate-400 text-center">
                    Введите запрос — поиск выполняется локально на вашем устройстве
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="p-4 text-xs text-slate-400 text-center">
                    Совпадений не найдено
                  </p>
                ) : (
                  searchResults.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleJumpToMessage(m.id)}
                      className="w-full p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                    >
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                        {m.senderName}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                        {m.text}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Pinned Messages Popover */}
          {pinnedOpen && (
            <div className="absolute right-4 top-14 w-80 sm:w-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden z-30">
              <div className="px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-semibold">
                <span>Закреплённые сообщения</span>
                <button
                  type="button"
                  onClick={() => setPinnedOpen(false)}
                  aria-label="Закрыть список закреплённых"
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {pinnedMessages.length === 0 ? (
                  <p className="p-4 text-xs text-slate-400 text-center">
                    Нет закреплённых сообщений
                  </p>
                ) : (
                  pinnedMessages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleJumpToMessage(m.id)}
                      className="w-full p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                    >
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                        {m.senderName}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                        {m.text}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </header>

        {sessionWarning && !isSuspended && (
          <form
            onSubmit={handleRefreshSession}
            data-testid="session-refresh-banner"
            className="px-4 sm:px-6 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <span className="font-medium">
              {sessionWarning}
              {reauthError ? ` · ${reauthError}` : ''}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="password"
                required
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                placeholder="Пароль для переподключения"
                className="h-7 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={reauthBusy}
                className="h-7 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap"
              >
                {reauthBusy ? 'Подключение…' : 'Обновить сессию'}
              </button>
              <button
                type="button"
                onClick={() => setSessionWarning(null)}
                aria-label="Скрыть уведомление"
                className="p-1 text-amber-700 dark:text-amber-300 hover:text-amber-900"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {pinnedMessages.length > 0 && (
          <button
            type="button"
            onClick={() =>
              handleJumpToMessage(pinnedMessages[pinnedMessages.length - 1].id)
            }
            className="w-full px-4 sm:px-6 py-1.5 bg-slate-100/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/80 transition-colors text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Pin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="font-medium shrink-0">Закреплено:</span>
              <span className="truncate">
                {pinnedMessages[pinnedMessages.length - 1].text}
              </span>
            </span>
            <span className="text-[11px] text-blue-600 dark:text-blue-400 shrink-0">
              Перейти
            </span>
          </button>
        )}

        <VirtualizedTimeline
          messages={mainMessages}
          localUserId={localBundle?.userId ?? ''}
          conversationName={activeConversation?.name ?? 'Канал'}
          allowAttachmentDownload={allowAttachmentDownload}
          highlightedMessageId={highlightedMessageId}
          threadSummaries={threadSummaries}
          activeThreadRootId={activeThreadRootId}
          onReply={setReplyTo}
          onOpenThread={handleOpenThread}
          onEdit={handleEditMessage}
          onDelete={handleDeleteMessage}
          onTogglePin={handleTogglePin}
          onToggleReaction={handleToggleReaction}
        />

        <Composer
          disabled={!activeConversation || !wsConnected}
          isArchived={activeConversation?.isArchived ?? false}
          isSuspended={isSuspended}
          onlyAdminsCanPost={activeConversation?.onlyAdminsCanPost ?? false}
          canPost={canPostActive}
          maxAttachmentSizeMb={enterprisePolicy.maxAttachmentSizeMb}
          conversationName={activeConversation?.name ?? 'собеседника'}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          disappearingTtlSec={activeConversation?.disappearingTtlSec ?? 0}
          onChangeDisappearingTtl={handleChangeDisappearingTtl}
          onSend={handleSendMessage}
        />
      </main>
      )}

      {!showAdminPanel && activeThreadRoot && (
        <div className="fixed inset-0 z-40 md:static md:inset-auto flex justify-end bg-slate-950/40 md:bg-transparent">
          <ThreadDrawer
            open={Boolean(activeThreadRoot)}
            rootMessage={activeThreadRoot}
            replies={activeThreadReplies}
            localUserId={localBundle?.userId ?? ''}
            conversationName={activeConversation?.name ?? 'Канал'}
            disabled={!activeConversation || !wsConnected}
            isArchived={activeConversation?.isArchived ?? false}
            isSuspended={isSuspended}
            onlyAdminsCanPost={activeConversation?.onlyAdminsCanPost ?? false}
            canPost={canPostActive}
            onClose={() => setActiveThreadRootId(null)}
            onSendThreadReply={handleSendThreadReply}
            onToggleReaction={handleToggleReaction}
          />
        </div>
      )}

      {!showAdminPanel && membersOpen && (
        <div className="fixed inset-0 z-40 md:static md:inset-auto flex justify-end bg-slate-950/40 md:bg-transparent">
          <MembersDrawer
            open={membersOpen}
            onClose={() => setMembersOpen(false)}
            activeConversation={activeConversation}
            peers={peerConversations}
            onStartDirectMessage={(peerId) => {
              setMembersOpen(false);
              handleSelectConversation(peerId);
            }}
          />
        </div>
      )}

      <SecurityModal
        open={securityOpen}
        conversation={activeConversation}
        onClose={() => setSecurityOpen(false)}
        onToggleVerified={handleToggleVerified}
        onResetKeys={handleResetKeys}
      />

      <CreateRoomModal
        open={createRoomOpen}
        canSetReadOnly={canManageChannels(currentUserRole)}
        onClose={() => setCreateRoomOpen(false)}
        onCreate={handleCreateRoom}
      />

      <ChannelDirectoryModal
        open={channelDirectoryOpen}
        onClose={() => setChannelDirectoryOpen(false)}
        channels={channelConversations}
        onJoinChannel={handleJoinChannel}
        onLeaveChannel={handleLeaveChannel}
        onOpenChannel={handleSelectConversation}
      />

      <ChannelSettingsModal
        open={channelSettingsOpen}
        channel={
          activeConversation && activeConversation.kind !== 'dm'
            ? activeConversation
            : null
        }
        peers={peerConversations}
        localUserId={localBundle?.userId ?? ''}
        onClose={() => setChannelSettingsOpen(false)}
        onSave={handleUpdateRoom}
      />
    </div>
  );
}
