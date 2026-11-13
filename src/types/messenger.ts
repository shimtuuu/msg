import type {
  EncryptedEnvelope,
  PublicPreKeyBundle,
  RatchetSession,
} from '../crypto/signalEngine';
import type {
  EncryptedGroupEnvelope,
  SenderKeyDistribution,
  SenderKeyState,
} from '../crypto/senderKey';
import type { EncryptedAttachmentPayload } from '../crypto/attachmentCrypto';
import type {
  AuditLogItem,
  EnterprisePolicy,
  EnterpriseRole,
  EnterpriseUserRecord,
} from '../utils/enterpriseAdmin';
import type { MessageReactions, ReactionAction } from '../utils/reactions';

export type {
  AuditLogItem,
  EnterprisePolicy,
  EnterpriseRole,
  EnterpriseUserRecord,
  MessageReactions,
  ReactionAction,
};

export type DeliveryStatus = 'encrypting' | 'sent' | 'delivered' | 'read';
export type PresenceState = 'online' | 'away' | 'dnd' | 'offline';
export type ConversationKind = 'channel' | 'private' | 'dm';
export type ChannelCategory = 'announcement' | 'department' | 'project';

export interface PeerDirectoryItem {
  userId: string;
  name: string;
  role: string;
  department?: string;
  enterpriseRole?: EnterpriseRole;
  isActive?: boolean;
  presence: PresenceState;
  isSystemPeer: boolean;
  bundle: PublicPreKeyBundle;
}

export interface RoomDirectoryItem {
  id: string;
  name: string;
  description: string;
  topic?: string;
  department?: string;
  category?: ChannelCategory;
  kind: 'channel' | 'private';
  memberIds: string[];
  unreadCount: number;
  isArchived?: boolean;
  onlyAdminsCanPost?: boolean;
  isJoined?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string; // peerId for DM, roomId for channel
  kind: 'dm' | 'group';
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  status: DeliveryStatus;
  isEdited?: boolean;
  isDeleted?: boolean;
  isPinned?: boolean;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  } | null;
  threadRootId?: string;
  dmEnvelope?: EncryptedEnvelope;
  groupEnvelope?: EncryptedGroupEnvelope;
  attachment?: EncryptedAttachmentPayload;
  reactions?: MessageReactions;
  expiresAt?: number;
  isBenchmark?: boolean;
}

export interface ConversationMeta {
  id: string; // peerId for DM, roomId for channel
  kind: ConversationKind;
  name: string;
  subtitle: string;
  topic?: string;
  department?: string;
  category?: ChannelCategory;
  enterpriseRole?: EnterpriseRole;
  isActive?: boolean;
  isArchived?: boolean;
  onlyAdminsCanPost?: boolean;
  isJoined?: boolean;
  isMuted?: boolean;
  presence?: PresenceState;
  isSystemPeer?: boolean;
  bundle?: PublicPreKeyBundle;
  session?: RatchetSession; // for DM
  selfSenderKey?: SenderKeyState; // for channels
  peerSenderKeys?: Record<string, SenderKeyState>; // senderId -> SenderKeyState
  memberIds?: string[];
  safetyNumber?: string[];
  verified: boolean;
  unreadCount: number;
  typingUsers: string[];
  disappearingTtlSec: number;
  lastMessagePreview: string;
  lastMessageAt: number;
}

export interface WireLogEntry {
  id: string;
  protocol: 'DoubleRatchet' | 'SenderKey';
  direction: 'outbound' | 'inbound';
  targetId: string;
  counter: number;
  keyPreview: string;
  ivB64: string;
  ciphertextPreview: string;
  plaintextByteLength: number;
  paddedByteLength: number;
  timestamp: number;
  threadRootId?: string;
}

export interface PerfMetrics {
  totalMessages: number;
  renderedDomNodes: number;
  lastEncryptMs: number;
  lastRenderMs: number;
}

export interface WrappedSenderKeyPacket {
  roomId: string;
  senderId: string;
  recipientId: string;
  senderIdentityPublicB64: string;
  ivB64: string;
  wrappedB64: string;
  distribution?: SenderKeyDistribution; // never sent plaintext over wire; wrapped only
}

export interface RoomAdminRecord {
  id: string;
  name: string;
  description: string;
  topic: string;
  department: string;
  category: ChannelCategory;
  kind: 'channel' | 'private';
  memberCount: number;
  isArchived: boolean;
  onlyAdminsCanPost: boolean;
  senderKeyGeneration: number;
}

export interface AdminStats {
  totalUsers: number;
  onlineUsers: number;
  activeRooms: number;
  messagesToday: number;
  suspendedUsers: number;
  verifiedRatePercent: number;
}

export interface AdminOverviewPayload {
  stats: AdminStats;
  users: EnterpriseUserRecord[];
  rooms: RoomAdminRecord[];
  policy: EnterprisePolicy;
  auditLogs: AuditLogItem[];
}

