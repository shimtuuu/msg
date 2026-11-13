import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Hash,
  Lock,
  Megaphone,
  PanelRightClose,
  PanelRightOpen,
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
import type {
  ChannelCategory,
  ChatMessage,
  ConversationMeta,
  EnterprisePolicy,
  EnterpriseRole,
  PeerDirectoryItem,
  PerfMetrics,
  PresenceState,
  ReactionAction,
  RoomDirectoryItem,
  WireLogEntry,
} from './types/messenger';
import {
  canAccessAdminPanel,
  canDownloadAttachments,
  canManageChannels,
  canPostInChannel,
} from './utils/enterpriseAdmin';
import { applyReactionUpdate, toggleReaction } from './utils/reactions';
import { partitionThreadMessages } from './utils/threads';
import { Sidebar } from './components/Sidebar';
import { VirtualizedTimeline } from './components/VirtualizedTimeline';
import { Composer } from './components/Composer';
import { SecurityModal } from './components/SecurityModal';
import { InspectorDrawer } from './components/InspectorDrawer';
import { CreateRoomModal } from './components/CreateRoomModal';
import { AdminPanel } from './components/AdminPanel';
import { MembersDrawer } from './components/MembersDrawer';
import { ChannelDirectoryModal } from './components/ChannelDirectoryModal';
import { ChannelSettingsModal } from './components/ChannelSettingsModal';
import { ThreadDrawer } from './components/ThreadDrawer';

const EMPTY_MESSAGES: ChatMessage[] = [];

function getOrCreateClientUserId(): string {
  const existing = sessionStorage.getItem('cipherline_uid');
  if (existing) return existing;
  const uid = `user_${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem('cipherline_uid', uid);
  return uid;
}

function getInitialEnterpriseRole(): EnterpriseRole {
  const params = new URLSearchParams(window.location.search);
  const qRole = params.get('role');
  if (
    qRole === 'owner' ||
    qRole === 'admin' ||
    qRole === 'security_officer' ||
    qRole === 'moderator' ||
    qRole === 'member' ||
    qRole === 'guest'
  ) {
    return qRole;
  }
  return 'member';
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [localBundle, setLocalBundle] = useState<IdentityBundle | null>(null);
  const [presence, setPresence] = useState<PresenceState>('online');
  const [wsConnected, setWsConnected] = useState(false);

  const [conversations, setConversations] = useState<Record<string, ConversationMeta>>({});
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>({});
  const [activeId, setActiveId] = useState<string>('room-general');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'admin'>('chat');
  const [currentUserRole, setCurrentUserRole] = useState<EnterpriseRole>(
    getInitialEnterpriseRole
  );
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [activeThreadRootId, setActiveThreadRootId] = useState<string | null>(null);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [channelDirectoryOpen, setChannelDirectoryOpen] = useState(false);
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const [wireLogs, setWireLogs] = useState<WireLogEntry[]>([]);
  const [renderedDomNodes, setRenderedDomNodes] = useState(0);
  const [lastEncryptMs, setLastEncryptMs] = useState(0);
  const [lastRenderMs, setLastRenderMs] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const localBundleRef = useRef<IdentityBundle | null>(null);
  const conversationsRef = useRef<Record<string, ConversationMeta>>({});
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  const activeIdRef = useRef<string>(activeId);
  const peerDirectoryRef = useRef<Record<string, PeerDirectoryItem>>({});
  const highlightTimerRef = useRef<number | null>(null);

  conversationsRef.current = conversations;
  messagesRef.current = messagesByConv;
  activeIdRef.current = activeId;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (viewMode === 'admin' && !canAccessAdminPanel(currentUserRole)) {
      setViewMode('chat');
    }
  }, [viewMode, currentUserRole]);

  useEffect(() => {
    let cancelled = false;
    const uid = getOrCreateClientUserId();
    generateIdentityBundle(uid).then((bundle) => {
      if (cancelled) return;
      localBundleRef.current = bundle;
      setLocalBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
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

      conversationsRef.current = {
        ...conversationsRef.current,
        [peerId]: { ...peerMeta, session },
      };
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
        ws.send(
          JSON.stringify({
            type: 'register',
            userId: localBundle.userId,
            name: `Участник ${localBundle.userId.slice(-4).toUpperCase()}`,
            presence,
            role: currentUserRole,
            bundle: extractPublicPreKeyBundle(localBundle),
          })
        );
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

            setConversations((prev) => {
              const next: Record<string, ConversationMeta> = {};

              for (const r of rooms) {
                const old = prev[r.id];
                next[r.id] = {
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
                  selfSenderKey: old?.selfSenderKey,
                  peerSenderKeys: old?.peerSenderKeys ?? {},
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
                const old = prev[peer.userId];
                next[peer.userId] = {
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
                  session: old?.session,
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
              return next;
            });

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

          if (data.type === 'session:init') {
            const { senderId, senderBundle, ephemeralPublicB64 } = data as {
              senderId: string;
              senderBundle: PublicPreKeyBundle;
              ephemeralPublicB64: string;
            };
            const session = await establishSessionAsResponder(
              localBundle,
              senderBundle,
              ephemeralPublicB64
            );
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
            const dist = await unwrapSenderKeyFromPeer(
              { ivB64, wrappedB64 },
              localBundle,
              senderIdentityPublicB64
            );
            const skState = importSenderKeyDistribution(dist);
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

            const t0 = performance.now();
            const decrypted = await decryptGroupMessage(peerSk, envelope);
            setLastEncryptMs(performance.now() - t0);

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

            setWireLogs((prev) => [
              {
                id: `in_grp_${envelope.id}`,
                protocol: 'SenderKey',
                direction: 'inbound',
                targetId: roomId,
                counter: envelope.iteration,
                keyPreview: envelope.signatureB64.slice(0, 18),
                ivB64: envelope.ivB64,
                ciphertextPreview: envelope.ciphertextB64.slice(0, 44),
                plaintextByteLength: envelope.plaintextByteLength,
                paddedByteLength: envelope.paddedByteLength,
                threadRootId: envelope.threadRootId,
                timestamp: envelope.timestamp,
              },
              ...prev.slice(0, 49),
            ]);

            setMessagesByConv((prev) => {
              const list = prev[roomId] ?? [];
              if (list.some((m) => m.id === newMsg.id)) return prev;
              return { ...prev, [roomId]: [...list, newMsg] };
            });

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

            const t0 = performance.now();
            const decrypted = await decryptMessage(currentSession, envelope);
            setLastEncryptMs(performance.now() - t0);

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

            setWireLogs((prev) => [
              {
                id: `in_dm_${envelope.id}`,
                protocol: 'DoubleRatchet',
                direction: 'inbound',
                targetId: peerId,
                counter: envelope.counter,
                keyPreview: envelope.dhPublicB64.slice(0, 18),
                ivB64: envelope.ivB64,
                ciphertextPreview: envelope.ciphertextB64.slice(0, 44),
                plaintextByteLength: envelope.plaintextByteLength,
                paddedByteLength: envelope.paddedByteLength,
                threadRootId: envelope.threadRootId,
                timestamp: envelope.timestamp,
              },
              ...prev.slice(0, 49),
            ]);

            setMessagesByConv((prev) => {
              const list = prev[peerId] ?? [];
              if (list.some((m) => m.id === newMessage.id)) return prev;
              return { ...prev, [peerId]: [...list, newMessage] };
            });

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

          if (data.type === 'msg:delete') {
            const { conversationId, messageId } = data as {
              conversationId: string;
              messageId: string;
            };
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

          if (data.type === 'account:status') {
            const { isActive, role } = data as {
              isActive?: boolean;
              role?: EnterpriseRole;
            };
            if (isActive !== undefined) setIsSuspended(!isActive);
            if (role) setCurrentUserRole(role);
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
  }, [localBundle, distributeRoomSenderKey, ensureDmSession, ensureRoomSenderKey]);

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
        return changed ? next : prev;
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

  const handleOpenAdminPanel = useCallback(() => {
    if (!canAccessAdminPanel(currentUserRole)) return;
    setViewMode('admin');
    setMobileShowChat(true);
    setInspectorOpen(false);
    setMembersOpen(false);
    setActiveThreadRootId(null);
  }, [currentUserRole]);

  const handleOpenThread = useCallback((message: ChatMessage) => {
    setActiveThreadRootId(message.id);
    setInspectorOpen(false);
    setMembersOpen(false);
  }, []);

  const handleSwitchRole = useCallback((role: EnterpriseRole) => {
    setCurrentUserRole(role);
    if (!canAccessAdminPanel(role)) {
      setViewMode('chat');
    }
    wsRef.current?.send(JSON.stringify({ type: 'role:switch', role }));
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

        const t0 = performance.now();
        const { envelope, nextSession } = await encryptMessage(
          session,
          myBundle.userId,
          text,
          {
            threadRootId,
            replyToId: activeReply?.id,
          }
        );
        setLastEncryptMs(performance.now() - t0);

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

        const renderStart = performance.now();
        setWireLogs((prev) => [
          {
            id: `out_dm_${envelope.id}`,
            protocol: 'DoubleRatchet',
            direction: 'outbound',
            targetId: convId,
            counter: envelope.counter,
            keyPreview: envelope.dhPublicB64.slice(0, 18),
            ivB64: envelope.ivB64,
            ciphertextPreview: envelope.ciphertextB64.slice(0, 44),
            plaintextByteLength: envelope.plaintextByteLength,
            paddedByteLength: envelope.paddedByteLength,
            threadRootId: envelope.threadRootId,
            timestamp: envelope.timestamp,
          },
          ...prev.slice(0, 49),
        ]);

        if (conversationsRef.current[convId]) {
          conversationsRef.current = {
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

        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] ?? []), message],
        }));
        if (!threadRootId) setReplyTo(null);
        requestAnimationFrame(() => setLastRenderMs(performance.now() - renderStart));

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

        const t0 = performance.now();
        const { envelope, nextState } = await encryptGroupMessage(sk, text, {
          replyToId: activeReply?.id,
          threadRootId,
        });
        setLastEncryptMs(performance.now() - t0);

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

        const renderStart = performance.now();
        setWireLogs((prev) => [
          {
            id: `out_grp_${envelope.id}`,
            protocol: 'SenderKey',
            direction: 'outbound',
            targetId: convId,
            counter: envelope.iteration,
            keyPreview: envelope.signatureB64.slice(0, 18),
            ivB64: envelope.ivB64,
            ciphertextPreview: envelope.ciphertextB64.slice(0, 44),
            plaintextByteLength: envelope.plaintextByteLength,
            paddedByteLength: envelope.paddedByteLength,
            threadRootId: envelope.threadRootId,
            timestamp: envelope.timestamp,
          },
          ...prev.slice(0, 49),
        ]);

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

        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] ?? []), message],
        }));
        if (!threadRootId) setReplyTo(null);
        requestAnimationFrame(() => setLastRenderMs(performance.now() - renderStart));

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
    [replyTo, ensureDmSession, ensureRoomSenderKey, currentUserRole]
  );

  const handleSendThreadReply = useCallback(
    async (text: string, threadRootId: string) => {
      await handleSendMessage(text, undefined, { threadRootId });
    },
    [handleSendMessage]
  );

  const handleEditMessage = useCallback(async (messageId: string, newText: string) => {
    const convId = activeIdRef.current;
    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((m) =>
        m.id === messageId ? { ...m, text: newText, isEdited: true } : m
      ),
    }));
  }, []);

  const handleDeleteMessage = useCallback((messageId: string) => {
    const convId = activeIdRef.current;
    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((m) =>
        m.id === messageId
          ? { ...m, isDeleted: true, text: 'Сообщение удалено' }
          : m
      ),
    }));
    wsRef.current?.send(
      JSON.stringify({ type: 'msg:delete', conversationId: convId, messageId })
    );
  }, []);

  const handleTogglePin = useCallback((messageId: string) => {
    const convId = activeIdRef.current;
    let nextPinned = true;
    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((m) => {
        if (m.id !== messageId) return m;
        nextPinned = !m.isPinned;
        return { ...m, isPinned: nextPinned };
      }),
    }));
    wsRef.current?.send(
      JSON.stringify({
        type: 'msg:pin',
        conversationId: convId,
        messageId,
        isPinned: nextPinned,
      })
    );
  }, []);

  const handleToggleReaction = useCallback((messageId: string, emoji: string) => {
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
  }, []);

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

  const handleRunBenchmark = useCallback(async (count: number) => {
    const myId = localBundleRef.current?.userId ?? 'local';
    const convId = activeIdRef.current;
    const conv = conversationsRef.current[convId];
    const isDm = conv?.kind === 'dm';

    const samplePhrases = [
      'Проверка пропускной способности Double Ratchet / SenderKey и виртуализации.',
      'Синхронизация префиксных высот через бинарный поиск O(log N).',
      'Пакет AES-256-GCM с выровненным буфером 128 байт доставлен.',
      'Мемоизированный MessageItem исключил лишние ре-рендеры соседних строк.',
    ];

    const start = performance.now();
    const batch: ChatMessage[] = new Array(count);
    const baseTs = Date.now() - count * 1500;

    for (let i = 0; i < count; i++) {
      const own = i % 2 === 0;
      const text = `${samplePhrases[i % samplePhrases.length]} [тест #${i + 1}]`;
      batch[i] = {
        id: `bench_${Date.now()}_${i}`,
        conversationId: convId,
        kind: isDm ? 'dm' : 'group',
        senderId: own ? myId : 'peer-marcus',
        senderName: own ? 'Вы' : 'Марк Волков',
        text,
        timestamp: baseTs + i * 1500,
        status: 'read',
        isBenchmark: true,
        groupEnvelope: !isDm
          ? {
              id: `bench_g_${i}`,
              roomId: convId,
              senderId: own ? myId : 'peer-marcus',
              keyId: 1,
              iteration: i,
              ivB64: 'BenchIV12Byte==',
              ciphertextB64: 'BenchCiphertext==',
              signatureB64: 'BenchSig==',
              plaintextByteLength: text.length,
              paddedByteLength: 128,
              timestamp: baseTs + i * 1500,
            }
          : undefined,
        dmEnvelope: isDm
          ? {
              id: `bench_d_${i}`,
              senderId: own ? myId : convId,
              receiverId: own ? convId : myId,
              dhPublicB64: 'BBenchKey',
              counter: i,
              prevCounter: Math.max(0, i - 1),
              ivB64: 'BenchIV12Byte==',
              ciphertextB64: 'BenchCiphertext==',
              plaintextByteLength: text.length,
              paddedByteLength: 128,
              timestamp: baseTs + i * 1500,
            }
          : undefined,
      };
    }

    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] ?? []), ...batch],
    }));

    requestAnimationFrame(() => setLastRenderMs(performance.now() - start));
  }, []);

  const handleClearBenchmark = useCallback(() => {
    const convId = activeIdRef.current;
    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).filter((m) => !m.isBenchmark),
    }));
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

  const perfMetrics: PerfMetrics = useMemo(
    () => ({
      totalMessages: activeMessages.length,
      renderedDomNodes,
      lastEncryptMs,
      lastRenderMs,
    }),
    [activeMessages.length, renderedDomNodes, lastEncryptMs, lastRenderMs]
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

  const showAdminPanel =
    viewMode === 'admin' && canAccessAdminPanel(currentUserRole);

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
          localUserId={localBundle?.userId ?? '…'}
          localRegistrationId={localBundle?.registrationId ?? 0}
          currentUserRole={currentUserRole}
          enterprisePolicy={enterprisePolicy}
          onSwitchRole={handleSwitchRole}
          presence={presence}
          onChangePresence={handleChangePresence}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          wsConnected={wsConnected}
        />
      </div>

      {showAdminPanel ? (
        <div
          className={`${
            mobileShowChat ? 'flex' : 'hidden md:flex'
          } flex-1 min-w-0 h-full`}
        >
          <AdminPanel
            localUserId={localBundle?.userId ?? 'admin'}
            localUserName={`Администратор ${(localBundle?.userId ?? '').slice(-4).toUpperCase()}`}
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
                      ? 'Ключ подтверждён · X3DH + Double Ratchet'
                      : 'Сквозное шифрование · Double Ratchet'
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
                setInspectorOpen(false);
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

            <button
              type="button"
              onClick={() => {
                setInspectorOpen((v) => !v);
                setMembersOpen(false);
                setActiveThreadRootId(null);
              }}
              aria-label={
                inspectorOpen
                  ? 'Закрыть инспектор шифрования'
                  : 'Открыть инспектор шифрования'
              }
              aria-expanded={inspectorOpen}
              className={`h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                inspectorOpen
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-200'
              }`}
            >
              {inspectorOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Инспектор E2EE</span>
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
                  placeholder="Локальный поиск по расшифрованному кэшу…"
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
                    Введите запрос — поиск выполняется локально без отправки на сервер
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
          onRenderedNodesChange={setRenderedDomNodes}
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

      {!showAdminPanel && inspectorOpen && (
        <div className="fixed inset-0 z-40 md:static md:inset-auto flex justify-end bg-slate-950/40 md:bg-transparent">
          <InspectorDrawer
            open={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            wireLogs={wireLogs}
            metrics={perfMetrics}
            onRunBenchmark={handleRunBenchmark}
            onClearBenchmark={handleClearBenchmark}
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
