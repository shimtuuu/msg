import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  establishSessionAsResponder,
  extractPublicPreKeyBundle,
  generateIdentityBundle,
  type EncryptedEnvelope,
  type IdentityBundle,
  type PublicPreKeyBundle,
  type RatchetSession,
} from './src/crypto/signalEngine.ts';
import {
  createSenderKeyState,
  exportSenderKeyDistribution,
  importSenderKeyDistribution,
  unwrapSenderKeyFromPeer,
  wrapSenderKeyForPeer,
  type EncryptedGroupEnvelope,
  type SenderKeyState,
} from './src/crypto/senderKey.ts';
import {
  canAccessAdminPanel,
  canAccessManagementConsole,
  canCreateAccounts,
  canCreateAccountWithRole,
  canCreateChannels,
  canManageChannels,
  canManageSecurityPolicies,
  canManageUsers,
  canPostInChannel,
  type AuditLogItem,
  type EnterprisePolicy,
  type EnterpriseRole,
  type EnterpriseUserRecord,
} from './src/utils/enterpriseAdmin.ts';
import {
  isValidCorporateEmail,
  normalizeEmail,
  validateLoginInput,
} from './src/utils/authValidation.ts';
import {
  extractBearerOrCookieToken,
  hashPassword,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './src/utils/serverAuth.ts';
import {
  loadAuthStore,
  saveAuthStore,
  type PersistedAccountRecord,
} from './src/utils/authStore.ts';
import {
  enqueueInboxPacket,
  loadChatStore,
  saveChatStore,
  upsertVaultRecord,
  type PendingInboxPacket,
  type PersistedRoomRecord,
} from './src/utils/chatStore.ts';
import type { EncryptedVaultRecord } from './src/crypto/vaultCrypto.ts';
import type { AuthUser, ChannelCategory } from './src/types/messenger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerAccount {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  enterpriseRole: EnterpriseRole;
  isActive: boolean;
  keysVerified: boolean;
  presence: 'online' | 'away' | 'dnd' | 'offline';
  passwordHash: string;
  bundle: IdentityBundle;
  dmSessions: Map<string, RatchetSession>;
  roomSelfKeys: Map<string, SenderKeyState>;
  roomPeerKeys: Map<string, SenderKeyState>;
  lastActiveAt: number;
}

interface ConnectedClient {
  userId: string;
  name: string;
  email: string;
  department: string;
  title: string;
  enterpriseRole: EnterpriseRole;
  isActive: boolean;
  keysVerified: boolean;
  presence: 'online' | 'away' | 'dnd' | 'offline';
  ws: WebSocket;
  bundle: PublicPreKeyBundle;
  lastActiveAt: number;
}

interface ActiveSession {
  sid: string;
  uid: string;
  exp: number;
}

interface ServerRoom {
  id: string;
  name: string;
  description: string;
  topic: string;
  department: string;
  category: ChannelCategory;
  kind: 'channel' | 'private';
  memberIds: Set<string>;
  isArchived: boolean;
  onlyAdminsCanPost: boolean;
  senderKeyGeneration: number;
}

const INITIAL_ACCOUNTS: Array<{
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  enterpriseRole: EnterpriseRole;
  presence: 'online' | 'away' | 'dnd' | 'offline';
  keysVerified: boolean;
  password: string;
}> = [
  {
    id: 'emp-admin',
    name: 'Александр Морозов',
    email: 'admin@corp.internal',
    department: 'Руководство и ИТ',
    title: 'Системный администратор',
    enterpriseRole: 'owner',
    presence: 'online',
    keysVerified: true,
    password: process.env.CORP_ADMIN_PASSWORD || 'AdminCorp!2026',
  },
  {
    id: 'peer-elena',
    name: 'Елена Соколова',
    email: 'e.sokolova@corp.internal',
    department: 'Информационная безопасность',
    title: 'CISO / Архитектор ИБ',
    enterpriseRole: 'security_officer',
    presence: 'online',
    keysVerified: true,
    password: 'SecOfficer!2026',
  },
  {
    id: 'peer-marcus',
    name: 'Марк Волков',
    email: 'm.volkov@corp.internal',
    department: 'Платформенная разработка',
    title: 'Staff Frontend Lead',
    enterpriseRole: 'admin',
    presence: 'online',
    keysVerified: true,
    password: 'VolkovAdmin!2026',
  },
  {
    id: 'emp-alexey',
    name: 'Алексей Петров',
    email: 'a.petrov@corp.internal',
    department: 'Облачная инфраструктура',
    title: 'Principal SRE / DevOps',
    enterpriseRole: 'member',
    presence: 'away',
    keysVerified: true,
    password: 'PetrovWork!2026',
  },
  {
    id: 'emp-anna',
    name: 'Анна Смирнова',
    email: 'a.smirnova@corp.internal',
    department: 'Юридический департамент',
    title: 'Руководитель комплаенса',
    enterpriseRole: 'moderator',
    presence: 'online',
    keysVerified: true,
    password: 'SmirnovaMod!2026',
  },
  {
    id: 'emp-dmitry',
    name: 'Дмитрий Козлов',
    email: 'd.kozlov@partner.ext',
    department: 'Внешний подрядчик',
    title: 'Приглашённый аудитор',
    enterpriseRole: 'guest',
    presence: 'offline',
    keysVerified: false,
    password: 'GuestAudit!2026',
  },
];

const INITIAL_ROOMS: Array<{
  id: string;
  name: string;
  description: string;
  topic: string;
  department: string;
  category: ChannelCategory;
  kind: 'channel' | 'private';
  onlyAdminsCanPost: boolean;
}> = [
  {
    id: 'room-announcements',
    name: 'announcements',
    description: 'Официальные объявления руководства, HR и ИБ',
    topic: 'Только администраторы и модераторы публикуют новости · Реакции открыты всем',
    department: 'Руководство и HR',
    category: 'announcement',
    kind: 'channel',
    onlyAdminsCanPost: true,
  },
  {
    id: 'room-general',
    name: 'general',
    description: 'Общий корпоративный канал',
    topic: 'Рабочие вопросы, релизы и кросс-командная координация',
    department: 'Вся компания',
    category: 'department',
    kind: 'channel',
    onlyAdminsCanPost: false,
  },
  {
    id: 'room-security',
    name: 'security-audit',
    description: 'Закрытый канал информационной безопасности и комплаенса',
    topic: 'Аудит SOC2, реагирование на инциденты и управление ключами',
    department: 'Информационная безопасность',
    category: 'department',
    kind: 'private',
    onlyAdminsCanPost: false,
  },
  {
    id: 'room-devops',
    name: 'devops-sre',
    description: 'Продакшн-инфраструктура, дежурства SRE и релизы',
    topic: 'Kubernetes-кластеры, окна обслуживания и мониторинг SLA',
    department: 'Облачная инфраструктура',
    category: 'project',
    kind: 'channel',
    onlyAdminsCanPost: false,
  },
  {
    id: 'room-legal',
    name: 'legal-compliance',
    description: 'Закрытый канал юридического департамента и 152-ФЗ',
    topic: 'NDA с контрагентами, DLP-регламенты и правовая оценка',
    department: 'Юридический департамент',
    category: 'project',
    kind: 'private',
    onlyAdminsCanPost: false,
  },
];

async function createInitialAccounts(): Promise<{
  accounts: Map<string, ServerAccount>;
  emailIndex: Map<string, string>;
}> {
  const accounts = new Map<string, ServerAccount>();
  const emailIndex = new Map<string, string>();
  const now = Date.now();
  for (const bp of INITIAL_ACCOUNTS) {
    const bundle = await generateIdentityBundle(bp.id);
    const roomSelfKeys = new Map<string, SenderKeyState>();
    for (const r of INITIAL_ROOMS) {
      roomSelfKeys.set(r.id, await createSenderKeyState(r.id, bp.id));
    }
    const cleanEmail = normalizeEmail(bp.email);
    accounts.set(bp.id, {
      id: bp.id,
      name: bp.name,
      email: cleanEmail,
      department: bp.department,
      title: bp.title,
      enterpriseRole: bp.enterpriseRole,
      isActive: true,
      keysVerified: bp.keysVerified,
      presence: bp.presence,
      passwordHash: hashPassword(bp.password),
      bundle,
      dmSessions: new Map(),
      roomSelfKeys,
      roomPeerKeys: new Map(),
      lastActiveAt: now,
    });
    emailIndex.set(cleanEmail, bp.id);
  }
  return { accounts, emailIndex };
}

function toAuthUser(acc: ServerAccount): AuthUser {
  return {
    userId: acc.id,
    name: acc.name,
    email: acc.email,
    department: acc.department,
    title: acc.title,
    role: acc.enterpriseRole,
    isActive: acc.isActive,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const authStorePath = path.resolve(process.cwd(), '.data', 'auth-store.json');
  const persistedAuth = loadAuthStore(
    authStorePath,
    Date.now(),
    process.env.SESSION_SECRET
  );
  const sessionSecret = persistedAuth.sessionSecret;
  const { accounts, emailIndex } = await createInitialAccounts();
  const activeSessions = new Map<string, ActiveSession>();
  for (const s of persistedAuth.sessions) {
    activeSessions.set(s.sid, { sid: s.sid, uid: s.uid, exp: s.exp });
  }
  const clients = new Map<string, ConnectedClient>();
  const rooms = new Map<string, ServerRoom>();

  // Hydrate persisted accounts & updated roles/statuses on top of initial directory
  for (const p of persistedAuth.accounts) {
    const cleanEmail = normalizeEmail(p.email);
    const existing = accounts.get(p.id);
    if (existing) {
      existing.name = p.name;
      existing.email = cleanEmail;
      existing.department = p.department;
      existing.title = p.title;
      existing.enterpriseRole = p.enterpriseRole;
      existing.isActive = p.isActive;
      existing.keysVerified = p.keysVerified;
      existing.presence = p.presence;
      existing.passwordHash = p.passwordHash;
      existing.lastActiveAt = p.lastActiveAt;
      emailIndex.set(cleanEmail, p.id);
    } else {
      const bundle = await generateIdentityBundle(p.id);
      const roomSelfKeys = new Map<string, SenderKeyState>();
      for (const r of INITIAL_ROOMS) {
        roomSelfKeys.set(r.id, await createSenderKeyState(r.id, p.id));
      }
      accounts.set(p.id, {
        id: p.id,
        name: p.name,
        email: cleanEmail,
        department: p.department,
        title: p.title,
        enterpriseRole: p.enterpriseRole,
        isActive: p.isActive,
        keysVerified: p.keysVerified,
        presence: p.presence,
        passwordHash: p.passwordHash,
        bundle,
        dmSessions: new Map(),
        roomSelfKeys,
        roomPeerKeys: new Map(),
        lastActiveAt: p.lastActiveAt,
      });
      emailIndex.set(cleanEmail, p.id);
    }
  }

  function persistAuthState() {
    const now = Date.now();
    const serializedAccounts: PersistedAccountRecord[] = Array.from(
      accounts.values()
    ).map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      department: a.department,
      title: a.title,
      enterpriseRole: a.enterpriseRole,
      isActive: a.isActive,
      keysVerified: a.keysVerified,
      presence: a.presence,
      passwordHash: a.passwordHash,
      lastActiveAt: a.lastActiveAt,
    }));
    const serializedSessions = Array.from(activeSessions.values()).filter(
      (s) => s.exp > now
    );
    saveAuthStore(authStorePath, {
      sessionSecret,
      accounts: serializedAccounts,
      sessions: serializedSessions,
    });
  }

  persistAuthState();

  let enterprisePolicy: EnterprisePolicy = {
    requireE2EE: true,
    requireVerifiedSafetyNumberForExternal: true,
    restrictGuestDownloads: true,
    allowMemberChannelCreation: true,
    defaultDisappearingTtlSec: 0,
    sessionKeyRotationHours: 24,
    maxAttachmentSizeMb: 25,
  };

  let messagesTodayCount = 0;
  const auditLogs: AuditLogItem[] = [
    {
      id: 'audit_init_1',
      action: 'policy.initialized',
      actorId: 'system',
      actorName: 'Система безопасности',
      targetType: 'policy',
      targetId: 'enterprise-default',
      summary: 'Применён базовый профиль сквозного шифрования и DLP',
      timestamp: Date.now() - 3600_000 * 4,
    },
  ];

  function recordAuditLog(
    entry: Omit<AuditLogItem, 'id' | 'timestamp'>
  ): AuditLogItem {
    const item: AuditLogItem = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    auditLogs.unshift(item);
    if (auditLogs.length > 500) {
      auditLogs.length = 500;
    }
    return item;
  }

  const chatStorePath = path.resolve(process.cwd(), '.data', 'chat-store.json');
  const persistedChat = loadChatStore(chatStorePath, Date.now());
  const liveBundles = new Map<string, PublicPreKeyBundle>(
    Object.entries(persistedChat.liveBundles)
  );
  const userVaults = new Map<string, EncryptedVaultRecord[]>(
    Object.entries(persistedChat.vaults)
  );
  const pendingInbox = new Map<string, PendingInboxPacket[]>(
    Object.entries(persistedChat.pendingInbox)
  );

  for (const r of INITIAL_ROOMS) {
    const initialMembers = Array.from(accounts.values())
      .filter((p) => {
        if (r.kind === 'private') {
          if (r.id === 'room-security') {
            return (
              p.enterpriseRole === 'security_officer' ||
              p.enterpriseRole === 'admin' ||
              p.enterpriseRole === 'owner'
            );
          }
          return p.enterpriseRole !== 'guest';
        }
        return true;
      })
      .map((p) => p.id);

    rooms.set(r.id, {
      ...r,
      memberIds: new Set(initialMembers),
      isArchived: false,
      senderKeyGeneration: 1,
    });
  }

  for (const pr of persistedChat.rooms) {
    const existing = rooms.get(pr.id);
    const mergedMembers = new Set<string>(pr.memberIds);
    if (existing && pr.kind === 'channel') {
      for (const acc of accounts.values()) {
        if (
          (pr.id === 'room-announcements' || pr.id === 'room-general') &&
          acc.isActive
        ) {
          mergedMembers.add(acc.id);
        }
      }
    }
    rooms.set(pr.id, {
      id: pr.id,
      name: pr.name,
      description: pr.description,
      topic: pr.topic,
      department: pr.department,
      category: pr.category,
      kind: pr.kind,
      memberIds: mergedMembers,
      isArchived: Boolean(pr.isArchived),
      onlyAdminsCanPost: Boolean(pr.onlyAdminsCanPost),
      senderKeyGeneration: pr.senderKeyGeneration || 1,
    });
    for (const acc of accounts.values()) {
      if (!acc.roomSelfKeys.has(pr.id)) {
        acc.roomSelfKeys.set(pr.id, await createSenderKeyState(pr.id, acc.id));
      }
    }
  }

  function persistChatState() {
    const serializedRooms: PersistedRoomRecord[] = Array.from(
      rooms.values()
    ).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      topic: r.topic,
      department: r.department,
      category: r.category,
      kind: r.kind,
      memberIds: Array.from(r.memberIds),
      isArchived: r.isArchived,
      onlyAdminsCanPost: r.onlyAdminsCanPost,
      senderKeyGeneration: r.senderKeyGeneration,
    }));
    saveChatStore(chatStorePath, {
      rooms: serializedRooms,
      liveBundles: Object.fromEntries(liveBundles.entries()),
      vaults: Object.fromEntries(userVaults.entries()),
      pendingInbox: Object.fromEntries(pendingInbox.entries()),
    });
  }

  function queueInboxPayload(
    targetUserId: string,
    payload: Record<string, unknown>
  ): boolean {
    const acc = accounts.get(targetUserId);
    if (!acc || !acc.isActive) return false;
    const existing = pendingInbox.get(targetUserId) ?? [];
    const packet: PendingInboxPacket = {
      id: `pkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      queuedAt: Date.now(),
      payload,
    };
    pendingInbox.set(targetUserId, enqueueInboxPacket(existing, packet));
    return true;
  }

  persistChatState();

  function getAllPublicPeers(excludeUserId?: string) {
    const list: Array<{
      userId: string;
      name: string;
      role: string;
      department: string;
      enterpriseRole: EnterpriseRole;
      isActive: boolean;
      presence: string;
      isSystemPeer: boolean;
      bundle: PublicPreKeyBundle;
    }> = [];

    for (const acc of accounts.values()) {
      if (acc.id === excludeUserId) continue;
      const live = clients.get(acc.id);
      list.push({
        userId: acc.id,
        name: acc.name,
        role: acc.title,
        department: acc.department,
        enterpriseRole: acc.enterpriseRole,
        isActive: acc.isActive,
        presence: acc.isActive ? (live ? live.presence : acc.presence) : 'offline',
        isSystemPeer: false,
        bundle: live
          ? live.bundle
          : liveBundles.get(acc.id) ?? extractPublicPreKeyBundle(acc.bundle),
      });
    }

    return list;
  }

  function getRoomListForClient(userId?: string, role?: EnterpriseRole) {
    return Array.from(rooms.values())
      .filter((r) => {
        if (r.kind === 'channel') return true;
        if (userId && r.memberIds.has(userId)) return true;
        if (role && canAccessAdminPanel(role)) return true;
        return false;
      })
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        topic: r.topic,
        department: r.department,
        category: r.category,
        kind: r.kind,
        memberIds: Array.from(r.memberIds),
        unreadCount: 0,
        isArchived: r.isArchived,
        onlyAdminsCanPost: r.onlyAdminsCanPost,
        isJoined: userId ? r.memberIds.has(userId) : true,
      }));
  }

  function buildEnterpriseUsers(): EnterpriseUserRecord[] {
    const users: EnterpriseUserRecord[] = [];
    for (const acc of accounts.values()) {
      const live = clients.get(acc.id);
      users.push({
        userId: acc.id,
        name: acc.name,
        email: acc.email,
        department: acc.department,
        title: acc.title,
        role: acc.enterpriseRole,
        isActive: acc.isActive,
        presence: acc.isActive ? (live ? live.presence : acc.presence) : 'offline',
        registrationId: live ? live.bundle.registrationId : acc.bundle.registrationId,
        lastActiveAt: live ? live.lastActiveAt : acc.lastActiveAt,
        keysVerified: acc.keysVerified,
      });
    }
    return users;
  }

  function buildAdminOverview() {
    const users = buildEnterpriseUsers();
    const roomList = Array.from(rooms.values()).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      topic: r.topic,
      department: r.department,
      category: r.category,
      kind: r.kind,
      memberCount: r.memberIds.size,
      isArchived: r.isArchived,
      onlyAdminsCanPost: r.onlyAdminsCanPost,
      senderKeyGeneration: r.senderKeyGeneration,
    }));
    const onlineUsers = users.filter(
      (u) => u.isActive && (u.presence === 'online' || u.presence === 'dnd' || u.presence === 'away')
    ).length;
    const suspendedUsers = users.filter((u) => !u.isActive).length;
    const verifiedCount = users.filter((u) => u.keysVerified).length;
    return {
      stats: {
        totalUsers: users.length,
        onlineUsers,
        activeRooms: roomList.filter((r) => !r.isArchived).length,
        messagesToday: messagesTodayCount,
        suspendedUsers,
        verifiedRatePercent:
          users.length > 0 ? Math.round((verifiedCount / users.length) * 100) : 100,
      },
      users,
      rooms: roomList,
      policy: enterprisePolicy,
      auditLogs: auditLogs.slice(0, 120),
    };
  }

  function broadcastDirectory() {
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'directory:sync',
            peers: getAllPublicPeers(client.userId),
            rooms: getRoomListForClient(client.userId, client.enterpriseRole),
            policy: enterprisePolicy,
            selfAccount: {
              role: client.enterpriseRole,
              isActive: client.isActive,
            },
          })
        );
      }
    }
  }

  function broadcastPolicyUpdate() {
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'policy:updated',
            policy: enterprisePolicy,
          })
        );
      }
    }
  }

  async function sendAgentSenderKeysToClient(
    client: ConnectedClient,
    onlyRoomId?: string
  ) {
    for (const acc of accounts.values()) {
      if (!acc.isActive || acc.id === client.userId) continue;
      for (const room of rooms.values()) {
        if (onlyRoomId && room.id !== onlyRoomId) continue;
        let sk = acc.roomSelfKeys.get(room.id);
        if (!sk) {
          sk = await createSenderKeyState(room.id, acc.id);
          acc.roomSelfKeys.set(room.id, sk);
        }
        const dist = exportSenderKeyDistribution(sk);
        const wrapped = await wrapSenderKeyForPeer(
          dist,
          acc.bundle,
          client.bundle.identityPublicB64
        );
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(
            JSON.stringify({
              type: 'group:senderKey',
              roomId: room.id,
              senderId: acc.id,
              recipientId: client.userId,
              senderIdentityPublicB64: acc.bundle.identityKey.publicKeyB64,
              ivB64: wrapped.ivB64,
              wrappedB64: wrapped.wrappedB64,
            })
          );
        }
      }
    }
  }

  const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function verifyAuthSession(token: string | null): {
    account: ServerAccount;
    session: ActiveSession;
  } | null {
    if (!token) return null;
    const payload = verifySessionToken(token, sessionSecret);
    if (!payload) return null;
    const now = Date.now();
    let session = activeSessions.get(payload.sid);
    if (!session) {
      if (payload.exp <= now) return null;
      session = { sid: payload.sid, uid: payload.uid, exp: payload.exp };
      activeSessions.set(payload.sid, session);
    }
    if (session.uid !== payload.uid || session.exp <= now) {
      activeSessions.delete(payload.sid);
      persistAuthState();
      return null;
    }
    const account = accounts.get(payload.uid);
    if (!account) return null;
    // Sliding session extension when close to expiration
    if (session.exp - now < SESSION_TTL_MS / 2) {
      session.exp = now + SESSION_TTL_MS;
      persistAuthState();
    }
    return { account, session };
  }

  function resolveHttpSession(req: express.Request) {
    const token = extractBearerOrCookieToken({
      authorizationHeader: req.header('authorization'),
      cookieHeader: req.header('cookie'),
    });
    return verifyAuthSession(token);
  }

  function issueAuthCookieAndToken(
    account: ServerAccount,
    res: express.Response
  ): { token: string; user: AuthUser } {
    const sid = crypto.randomBytes(16).toString('hex');
    const iat = Date.now();
    const exp = iat + SESSION_TTL_MS;
    activeSessions.set(sid, { sid, uid: account.id, exp });
    persistAuthState();
    const token = signSessionToken({ uid: account.id, sid, iat, exp }, sessionSecret);
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(
        token
      )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    );
    return { token, user: toAuthUser(account) };
  }

  function revokeUserSessions(userId: string) {
    let changed = false;
    for (const [sid, sess] of activeSessions.entries()) {
      if (sess.uid === userId) {
        activeSessions.delete(sid);
        changed = true;
      }
    }
    if (changed) {
      persistAuthState();
    }
  }

  function requireAdminRole(
    predicate: (role: EnterpriseRole) => boolean = canAccessAdminPanel
  ): express.RequestHandler {
    return (req, res, next) => {
      const auth = resolveHttpSession(req);
      if (!auth) {
        res.status(401).json({ error: 'Требуется авторизация' });
        return;
      }
      if (!auth.account.isActive) {
        res.status(403).json({ error: 'Учётная запись заблокирована администратором' });
        return;
      }
      if (!predicate(auth.account.enterpriseRole)) {
        res.status(403).json({
          error:
            'Доступ запрещён: недостаточно прав для выполнения операции',
        });
        return;
      }
      res.locals.authAccount = auth.account;
      next();
    };
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      connectedClients: clients.size,
      rooms: rooms.size,
    });
  });

  // Authentication REST API
  app.post('/api/auth/login', (req, res) => {
    const { email = '', password = '' } = (req.body ?? {}) as {
      email?: string;
      password?: string;
    };
    const check = validateLoginInput(email, password);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const cleanEmail = normalizeEmail(email);
    const accountId = emailIndex.get(cleanEmail);
    const account = accountId ? accounts.get(accountId) : undefined;
    if (!account || !verifyPassword(password, account.passwordHash)) {
      res.status(401).json({ error: 'Неверный корпоративный email или пароль' });
      return;
    }
    if (!account.isActive) {
      res.status(403).json({
        error: 'Учётная запись заблокирована администратором организации',
      });
      return;
    }

    account.lastActiveAt = Date.now();
    const authPayload = issueAuthCookieAndToken(account, res);
    recordAuditLog({
      action: 'auth.login',
      actorId: account.id,
      actorName: account.name,
      targetType: 'user',
      targetId: account.id,
      summary: `Выполнен вход в систему (${account.email})`,
    });
    res.json(authPayload);
  });

  app.post('/api/auth/register', (_req, res) => {
    res.status(403).json({
      error:
        'Самостоятельная регистрация отключена. Создавать учётные записи могут только администраторы и модераторы.',
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = resolveHttpSession(req);
    if (!auth) {
      res.status(401).json({ error: 'Сессия не найдена или истекла' });
      return;
    }
    if (!auth.account.isActive) {
      res.status(403).json({
        error: 'Учётная запись заблокирована администратором организации',
      });
      return;
    }
    res.json({ user: toAuthUser(auth.account) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const auth = resolveHttpSession(req);
    if (auth) {
      activeSessions.delete(auth.session.sid);
      persistAuthState();
      recordAuditLog({
        action: 'auth.logout',
        actorId: auth.account.id,
        actorName: auth.account.name,
        targetType: 'user',
        targetId: auth.account.id,
        summary: `Выход из системы (${auth.account.email})`,
      });
    }
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    );
    res.json({ ok: true });
  });

  app.get('/api/peers', (req, res) => {
    const auth = resolveHttpSession(req);
    if (!auth) {
      res.status(401).json({ error: 'Требуется авторизация' });
      return;
    }
    res.json({ peers: getAllPublicPeers(auth.account.id) });
  });

  app.use('/api/admin', requireAdminRole(canAccessManagementConsole));

  // Enterprise Admin REST API
  app.get('/api/admin/overview', (_req, res) => {
    const actor = res.locals.authAccount as ServerAccount;
    const overview = buildAdminOverview();
    if (!canAccessAdminPanel(actor.enterpriseRole)) {
      overview.auditLogs = [];
    }
    res.json(overview);
  });

  app.post('/api/admin/users', requireAdminRole(canCreateAccounts), async (req, res) => {
    try {
      const actor = res.locals.authAccount as ServerAccount;
      const {
        name,
        email,
        department,
        title,
        role,
        password,
      } = req.body as {
        name?: string;
        email?: string;
        department?: string;
        title?: string;
        role?: EnterpriseRole;
        password?: string;
      };
      const cleanName = (name ?? '').trim();
      const cleanEmail = normalizeEmail(email ?? '');
      if (!cleanName || !cleanEmail || !isValidCorporateEmail(cleanEmail)) {
        res.status(400).json({ error: 'Имя и корректный корпоративный Email обязательны' });
        return;
      }
      if (emailIndex.has(cleanEmail)) {
        res.status(409).json({ error: 'Сотрудник с таким Email уже существует' });
        return;
      }
      if (password && password.length < 6) {
        res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
        return;
      }

      const cleanRole: EnterpriseRole = role ?? 'member';
      if (!canCreateAccountWithRole(actor.enterpriseRole, cleanRole)) {
        res.status(403).json({
          error:
            'Недостаточно прав для создания учётной записи с выбранной ролью',
        });
        return;
      }

      const assignedPassword =
        password && password.length >= 6
          ? password
          : `Corp_${crypto.randomBytes(4).toString('hex')}`;

      const id = `emp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const bundle = await generateIdentityBundle(id);
      const roomSelfKeys = new Map<string, SenderKeyState>();
      for (const room of rooms.values()) {
        roomSelfKeys.set(room.id, await createSenderKeyState(room.id, id));
        if (room.kind === 'channel') {
          room.memberIds.add(id);
        }
      }

      accounts.set(id, {
        id,
        name: cleanName,
        email: cleanEmail,
        department: (department ?? '').trim() || 'Корпоративный офис',
        title: (title ?? '').trim() || 'Специалист',
        enterpriseRole: cleanRole,
        isActive: true,
        keysVerified: cleanRole !== 'guest',
        presence: 'online',
        passwordHash: hashPassword(assignedPassword),
        bundle,
        dmSessions: new Map(),
        roomSelfKeys,
        roomPeerKeys: new Map(),
        lastActiveAt: Date.now(),
      });
      emailIndex.set(cleanEmail, id);
      persistAuthState();
      persistChatState();

      recordAuditLog({
        action: 'user.invited',
        actorId: actor.id,
        actorName: actor.name,
        targetType: 'user',
        targetId: id,
        summary: `Добавлен сотрудник ${cleanName} (${cleanEmail}), роль: ${cleanRole}`,
      });

      broadcastDirectory();
      for (const c of clients.values()) {
        await sendAgentSenderKeysToClient(c);
      }
      res.status(201).json({
        ...buildAdminOverview(),
        provisionedCredentials: {
          email: cleanEmail,
          temporaryPassword: assignedPassword,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка создания пользователя' });
    }
  });

  app.patch('/api/admin/users/:userId', requireAdminRole(canManageUsers), (req, res) => {
    const actor = res.locals.authAccount as ServerAccount;
    const { userId } = req.params;
    const { role, isActive } = req.body as {
      role?: EnterpriseRole;
      isActive?: boolean;
    };

    const account = accounts.get(userId);
    const client = clients.get(userId);
    if (!account && !client) {
      res.status(404).json({ error: 'Сотрудник не найден' });
      return;
    }

    const targetName = account?.name ?? client?.name ?? userId;
    if (account) {
      if (role !== undefined) account.enterpriseRole = role;
      if (isActive !== undefined) {
        account.isActive = isActive;
        if (!isActive) {
          revokeUserSessions(userId);
        }
      }
      persistAuthState();
    }
    if (client) {
      if (role !== undefined) {
        client.enterpriseRole = role;
      }
      if (isActive !== undefined) {
        client.isActive = isActive;
      }
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'account:status',
            isActive: client.isActive,
            role: client.enterpriseRole,
          })
        );
      }
    }

    if (role !== undefined) {
      recordAuditLog({
        action: 'user.role_changed',
        actorId: actor.id,
        actorName: actor.name,
        targetType: 'user',
        targetId: userId,
        summary: `Назначена роль ${role} сотруднику ${targetName}`,
      });
    }
    if (isActive !== undefined) {
      recordAuditLog({
        action: isActive ? 'user.restored' : 'user.suspended',
        actorId: actor.id,
        actorName: actor.name,
        targetType: 'user',
        targetId: userId,
        summary: isActive
          ? `Доступ восстановлен для ${targetName}`
          : `Учётная запись ${targetName} заблокирована политикой администратора`,
      });
    }

    broadcastDirectory();
    res.json(buildAdminOverview());
  });

  app.post(
    '/api/admin/users/:userId/revoke-keys',
    requireAdminRole(canManageSecurityPolicies),
    async (req, res) => {
      const actor = res.locals.authAccount as ServerAccount;
      const { userId } = req.params;

      const account = accounts.get(userId);
      const client = clients.get(userId);
      if (!account && !client) {
        res.status(404).json({ error: 'Сотрудник не найден' });
        return;
      }

      if (account) {
        account.bundle = await generateIdentityBundle(account.id);
        account.dmSessions.clear();
        account.roomPeerKeys.clear();
        account.keysVerified = false;
        liveBundles.delete(account.id);
        persistChatState();
        for (const room of rooms.values()) {
          account.roomSelfKeys.set(room.id, await createSenderKeyState(room.id, account.id));
        }
      }

      const targetName = account?.name ?? client?.name ?? userId;
      if (client) {
        client.keysVerified = false;
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'keys:revoked' }));
        }
      }

      recordAuditLog({
        action: 'user.keys_revoked',
        actorId: actor.id,
        actorName: actor.name,
        targetType: 'security',
        targetId: userId,
        summary: `Отозваны ключи и сброшены сессии для ${targetName}`,
      });

      broadcastDirectory();
      for (const c of clients.values()) {
        await sendAgentSenderKeysToClient(c);
      }
      res.json(buildAdminOverview());
    }
  );

  app.patch('/api/admin/policies', requireAdminRole(canManageSecurityPolicies), (req, res) => {
    const actor = res.locals.authAccount as ServerAccount;
    const { policy } = req.body as {
      policy: Partial<EnterprisePolicy>;
    };
    if (!policy) {
      res.status(400).json({ error: 'Не переданы параметры политики' });
      return;
    }

    enterprisePolicy = {
      ...enterprisePolicy,
      ...policy,
      requireE2EE: true,
    };

    recordAuditLog({
      action: 'policy.updated',
      actorId: actor.id,
      actorName: actor.name,
      targetType: 'policy',
      targetId: 'enterprise-default',
      summary: `Обновлены политики ИБ: DLP гостей=${enterprisePolicy.restrictGuestDownloads ? 'вкл' : 'выкл'}, создание каналов сотрудниками=${enterprisePolicy.allowMemberChannelCreation ? 'да' : 'нет'}, TTL=${enterprisePolicy.defaultDisappearingTtlSec}с`,
    });

    broadcastPolicyUpdate();
    res.json(buildAdminOverview());
  });

  app.post('/api/admin/rooms/:roomId/archive', requireAdminRole(canManageUsers), (req, res) => {
    const actor = res.locals.authAccount as ServerAccount;
    const { roomId } = req.params;

    const room = rooms.get(roomId);
    if (!room) {
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }

    room.isArchived = !room.isArchived;
    persistChatState();
    recordAuditLog({
      action: room.isArchived ? 'room.archived' : 'room.restored',
      actorId: actor.id,
      actorName: actor.name,
      targetType: 'room',
      targetId: roomId,
      summary: room.isArchived
        ? `Канал #${room.name} переведён в режим архива (только чтение)`
        : `Канал #${room.name} восстановлен для активной работы`,
    });

    broadcastDirectory();
    res.json(buildAdminOverview());
  });

  app.post(
    '/api/admin/security/rotate-all-keys',
    requireAdminRole(canManageSecurityPolicies),
    async (_req, res) => {
      const actor = res.locals.authAccount as ServerAccount;

      for (const room of rooms.values()) {
        room.senderKeyGeneration += 1;
        for (const acc of accounts.values()) {
          acc.roomSelfKeys.set(room.id, await createSenderKeyState(room.id, acc.id));
        }
      }

      for (const c of clients.values()) {
        await sendAgentSenderKeysToClient(c);
      }

      recordAuditLog({
        action: 'sender_key.rotated_all',
        actorId: actor.id,
        actorName: actor.name,
        targetType: 'security',
        targetId: 'all-rooms',
        summary: `Выполнена принудительная ротация ключей по всем ${rooms.size} каналам`,
      });

      res.json(buildAdminOverview());
    }
  );

  wss.on('connection', (ws, req) => {
    let registeredUserId: string | null = null;
    let messageQueue = Promise.resolve();

    const handleSocketMessage = async (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'register') {
          const { token, bundle, presence } = msg as {
            token?: string;
            bundle: PublicPreKeyBundle;
            presence?: 'online' | 'away' | 'dnd' | 'offline';
          };
          const resolvedToken = extractBearerOrCookieToken({
            explicitToken: token,
            cookieHeader: req.headers.cookie,
          });
          const auth = verifyAuthSession(resolvedToken);
          if (!auth) {
            ws.send(
              JSON.stringify({
                type: 'auth:error',
                error: 'Сессия недействительна или истекла. Войдите снова.',
              })
            );
            ws.close(4001, 'Unauthorized');
            return;
          }
          const acc = auth.account;
          if (!acc.isActive) {
            ws.send(
              JSON.stringify({
                type: 'auth:error',
                error: 'Учётная запись заблокирована администратором организации.',
              })
            );
            ws.close(4003, 'Suspended');
            return;
          }
          if (!bundle) return;

          registeredUserId = acc.id;
          acc.presence = presence || 'online';
          acc.lastActiveAt = Date.now();

          const client: ConnectedClient = {
            userId: acc.id,
            name: acc.name,
            email: acc.email,
            department: acc.department,
            title: acc.title,
            enterpriseRole: acc.enterpriseRole,
            isActive: acc.isActive,
            keysVerified: acc.keysVerified,
            presence: acc.presence,
            ws,
            bundle,
            lastActiveAt: Date.now(),
          };
          clients.set(acc.id, client);
          liveBundles.set(acc.id, bundle);

          for (const room of rooms.values()) {
            if (room.id === 'room-announcements' || room.id === 'room-general') {
              room.memberIds.add(acc.id);
            } else if (room.kind === 'private' && canAccessAdminPanel(acc.enterpriseRole)) {
              room.memberIds.add(acc.id);
            }
          }

          ws.send(
            JSON.stringify({
              type: 'directory:sync',
              peers: getAllPublicPeers(acc.id),
              rooms: getRoomListForClient(acc.id, client.enterpriseRole),
              policy: enterprisePolicy,
              selfAccount: {
                role: client.enterpriseRole,
                isActive: client.isActive,
              },
            })
          );

          const nowMs = Date.now();
          const savedRecords = (userVaults.get(acc.id) ?? []).filter(
            (r) => r.expiresAt === undefined || r.expiresAt > nowMs
          );
          if (savedRecords.length > 0) {
            ws.send(
              JSON.stringify({
                type: 'vault:sync',
                records: savedRecords,
              })
            );
          }

          const queued = pendingInbox.get(acc.id);
          if (queued && queued.length > 0) {
            for (const pkt of queued) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(pkt.payload));
              }
            }
            pendingInbox.delete(acc.id);
          }

          persistChatState();
          await sendAgentSenderKeysToClient(client);
          broadcastDirectory();
          return;
        }

        if (msg.type === 'vault:save') {
          if (!registeredUserId) return;
          const record = msg.record as EncryptedVaultRecord | undefined;
          if (
            !record ||
            typeof record.messageId !== 'string' ||
            typeof record.conversationId !== 'string' ||
            typeof record.timestamp !== 'number' ||
            typeof record.ivB64 !== 'string' ||
            typeof record.ciphertextB64 !== 'string'
          ) {
            return;
          }
          const currentVault = userVaults.get(registeredUserId) ?? [];
          userVaults.set(
            registeredUserId,
            upsertVaultRecord(currentVault, record)
          );
          persistChatState();
          return;
        }

        if (!registeredUserId) {
          ws.send(
            JSON.stringify({
              type: 'auth:error',
              error: 'Требуется авторизация перед отправкой сообщений',
            })
          );
          return;
        }

        const senderClient = clients.get(registeredUserId);
        const senderAccount = accounts.get(registeredUserId);
        if ((senderClient && !senderClient.isActive) || (senderAccount && !senderAccount.isActive)) {
          ws.send(
            JSON.stringify({
              type: 'account:status',
              isActive: false,
              role: senderClient?.enterpriseRole ?? senderAccount?.enterpriseRole ?? 'member',
            })
          );
          return;
        }

        if (msg.type === 'room:create') {
          const senderRole: EnterpriseRole = senderClient?.enterpriseRole ?? 'member';
          if (!canCreateChannels(senderRole, enterprisePolicy)) return;

          const {
            name,
            description,
            topic,
            department,
            category,
            kind,
            onlyAdminsCanPost,
          } = msg as {
            name: string;
            description?: string;
            topic?: string;
            department?: string;
            category?: ChannelCategory;
            kind?: 'channel' | 'private';
            onlyAdminsCanPost?: boolean;
          };
          const cleanName = (name || '').trim().toLowerCase().replace(/\s+/g, '-');
          if (!cleanName) return;
          const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const resolvedKind = kind === 'private' ? 'private' : 'channel';
          const resolvedCategory: ChannelCategory =
            category === 'announcement' || category === 'department' || category === 'project'
              ? category
              : 'project';
          const newRoom: ServerRoom = {
            id: roomId,
            name: cleanName,
            description: description?.trim() || 'Зашифрованный корпоративный канал',
            topic: topic?.trim() || 'Рабочее обсуждение и синхронизация команды',
            department: department?.trim() || 'Кросс-функциональная команда',
            category: resolvedCategory,
            kind: resolvedKind,
            memberIds: new Set([
              registeredUserId,
              ...Array.from(accounts.values())
                .filter((p) => resolvedKind === 'channel' || p.enterpriseRole !== 'guest')
                .map((p) => p.id),
            ]),
            isArchived: false,
            onlyAdminsCanPost: canManageChannels(senderRole) ? Boolean(onlyAdminsCanPost) : false,
            senderKeyGeneration: 1,
          };
          for (const c of clients.values()) {
            if (newRoom.kind === 'channel') {
              newRoom.memberIds.add(c.userId);
            }
          }
          rooms.set(roomId, newRoom);
          persistChatState();
          for (const acc of accounts.values()) {
            acc.roomSelfKeys.set(
              roomId,
              await createSenderKeyState(roomId, acc.id)
            );
          }

          recordAuditLog({
            action: 'room.created',
            actorId: registeredUserId,
            actorName: senderClient?.name ?? registeredUserId,
            targetType: 'room',
            targetId: roomId,
            summary: `Создан ${newRoom.kind === 'private' ? 'закрытый' : 'корпоративный'} канал #${cleanName} (${newRoom.department})`,
          });

          broadcastDirectory();
          for (const c of clients.values()) {
            await sendAgentSenderKeysToClient(c, roomId);
          }
          return;
        }

        if (msg.type === 'room:join') {
          if (!registeredUserId || !senderClient) return;
          const { roomId } = msg as { roomId?: string };
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;
          if (room.kind === 'private' && !canManageChannels(senderClient.enterpriseRole)) {
            return;
          }
          room.memberIds.add(registeredUserId);
          persistChatState();
          recordAuditLog({
            action: 'room.joined',
            actorId: senderClient.userId,
            actorName: senderClient.name,
            targetType: 'room',
            targetId: roomId,
            summary: `Сотрудник ${senderClient.name} присоединился к каналу #${room.name}`,
          });
          await sendAgentSenderKeysToClient(senderClient, roomId);
          broadcastDirectory();
          return;
        }

        if (msg.type === 'room:leave') {
          if (!registeredUserId || !senderClient) return;
          const { roomId } = msg as { roomId?: string };
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;
          room.memberIds.delete(registeredUserId);
          persistChatState();
          recordAuditLog({
            action: 'room.left',
            actorId: senderClient.userId,
            actorName: senderClient.name,
            targetType: 'room',
            targetId: roomId,
            summary: `Сотрудник ${senderClient.name} покинул канал #${room.name}`,
          });
          broadcastDirectory();
          return;
        }

        if (msg.type === 'room:update') {
          if (!registeredUserId || !senderClient) return;
          if (!canManageChannels(senderClient.enterpriseRole)) return;
          const {
            roomId,
            description,
            topic,
            department,
            category,
            onlyAdminsCanPost,
            isArchived,
            memberIds,
          } = msg as {
            roomId?: string;
            description?: string;
            topic?: string;
            department?: string;
            category?: ChannelCategory;
            onlyAdminsCanPost?: boolean;
            isArchived?: boolean;
            memberIds?: string[];
          };
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;

          if (description !== undefined) room.description = description.trim() || room.description;
          if (topic !== undefined) room.topic = topic.trim();
          if (department !== undefined) room.department = department.trim() || room.department;
          if (
            category === 'announcement' ||
            category === 'department' ||
            category === 'project'
          ) {
            room.category = category;
          }
          if (onlyAdminsCanPost !== undefined) room.onlyAdminsCanPost = Boolean(onlyAdminsCanPost);
          if (isArchived !== undefined) room.isArchived = Boolean(isArchived);
          if (Array.isArray(memberIds)) {
            room.memberIds = new Set(memberIds);
          }
          persistChatState();

          recordAuditLog({
            action: 'room.updated',
            actorId: senderClient.userId,
            actorName: senderClient.name,
            targetType: 'room',
            targetId: roomId,
            summary: `Обновлены параметры корпоративного канала #${room.name}`,
          });

          broadcastDirectory();
          for (const c of clients.values()) {
            if (room.memberIds.has(c.userId)) {
              await sendAgentSenderKeysToClient(c, roomId);
            }
          }
          return;
        }

        if (msg.type === 'presence:update') {
          if (!registeredUserId) return;
          const c = clients.get(registeredUserId);
          if (c) {
            c.presence = msg.presence || 'online';
            c.lastActiveAt = Date.now();
            broadcastDirectory();
          }
          return;
        }

        if (msg.type === 'session:init') {
          const { receiverId } = msg as {
            senderId: string;
            receiverId: string;
            senderBundle: PublicPreKeyBundle;
            ephemeralPublicB64: string;
          };
          const targetClient = clients.get(receiverId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify(msg));
            return;
          }
          if (liveBundles.has(receiverId) && queueInboxPayload(receiverId, msg)) {
            persistChatState();
            ws.send(
              JSON.stringify({
                type: 'session:ack',
                peerId: receiverId,
                establishedAt: Date.now(),
              })
            );
          }
          return;
        }

        if (msg.type === 'group:senderKey') {
          const { recipientId } = msg as {
            roomId: string;
            senderId: string;
            recipientId: string;
            senderIdentityPublicB64: string;
            ivB64: string;
            wrappedB64: string;
          };

          const targetClient = clients.get(recipientId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify(msg));
            return;
          }

          if (liveBundles.has(recipientId) && queueInboxPayload(recipientId, msg)) {
            persistChatState();
          }
          return;
        }

        if (msg.type === 'group:envelope') {
          const envelope = msg.envelope as EncryptedGroupEnvelope;
          const attachment = msg.attachment;
          const ephemeralTtlSec = msg.ephemeralTtlSec;
          if (!envelope || !envelope.roomId) return;
          const room = rooms.get(envelope.roomId);
          if (!room) return;
          const senderRole: EnterpriseRole = senderClient?.enterpriseRole ?? 'member';
          if (
            !canPostInChannel(senderRole, {
              isArchived: room.isArchived,
              onlyAdminsCanPost: room.onlyAdminsCanPost,
            })
          ) {
            return;
          }
          if (!room.memberIds.has(envelope.senderId)) return;

          messagesTodayCount += 1;
          if (senderClient) senderClient.lastActiveAt = Date.now();

          const outboundPayload = {
            type: 'group:envelope',
            envelope,
            attachment,
            ephemeralTtlSec,
          };

          let queuedOffline = false;
          for (const memberId of room.memberIds) {
            if (memberId === envelope.senderId) continue;
            const c = clients.get(memberId);
            if (c && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(JSON.stringify(outboundPayload));
            } else if (queueInboxPayload(memberId, outboundPayload)) {
              queuedOffline = true;
            }
          }
          if (queuedOffline) {
            persistChatState();
          }
          return;
        }

        if (msg.type === 'msg:envelope') {
          const envelope = msg.envelope as EncryptedEnvelope;
          const attachment = msg.attachment;
          const ephemeralTtlSec = msg.ephemeralTtlSec;
          if (!envelope || !envelope.receiverId) return;

          messagesTodayCount += 1;
          if (senderClient) senderClient.lastActiveAt = Date.now();

          const outboundPayload = {
            type: 'msg:envelope',
            envelope,
            attachment,
            ephemeralTtlSec,
          };

          const targetClient = clients.get(envelope.receiverId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify(outboundPayload));
            ws.send(
              JSON.stringify({
                type: 'msg:receipt',
                messageId: envelope.id,
                peerId: envelope.receiverId,
                status: 'delivered',
              })
            );
          } else if (queueInboxPayload(envelope.receiverId, outboundPayload)) {
            persistChatState();
          }
          return;
        }

        if (
          msg.type === 'msg:edit' ||
          msg.type === 'msg:delete' ||
          msg.type === 'msg:pin'
        ) {
          const { conversationId, kind } = msg as {
            conversationId?: string;
            kind?: 'dm' | 'group';
          };
          if (!conversationId) return;

          const isDm =
            kind === 'dm' ||
            (!rooms.has(conversationId) && accounts.has(conversationId));

          if (isDm) {
            const targetId = conversationId;
            const outboundPayload = {
              ...msg,
              conversationId: registeredUserId,
            };
            const targetClient = clients.get(targetId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(JSON.stringify(outboundPayload));
            } else if (queueInboxPayload(targetId, outboundPayload)) {
              persistChatState();
            }
            return;
          }

          const room = rooms.get(conversationId);
          if (!room) return;
          let queuedOffline = false;
          for (const memberId of room.memberIds) {
            if (memberId === registeredUserId) continue;
            const c = clients.get(memberId);
            if (c && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(JSON.stringify(msg));
            } else if (queueInboxPayload(memberId, msg)) {
              queuedOffline = true;
            }
          }
          if (queuedOffline) {
            persistChatState();
          }
          return;
        }

        if (msg.type === 'msg:reaction') {
          const { conversationId, kind, messageId, emoji, userId, action } = msg as {
            conversationId?: string;
            kind?: 'dm' | 'group';
            messageId?: string;
            emoji?: string;
            userId?: string;
            action?: 'add' | 'remove';
          };
          if (
            !conversationId ||
            !messageId ||
            !emoji ||
            (action !== 'add' && action !== 'remove')
          ) {
            return;
          }
          const actorId = registeredUserId ?? userId;
          if (!actorId) return;

          if (kind === 'dm') {
            const outboundPayload = {
              type: 'msg:reaction',
              conversationId: actorId,
              kind: 'dm',
              messageId,
              emoji,
              userId: actorId,
              action,
            };
            const targetClient = clients.get(conversationId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(JSON.stringify(outboundPayload));
            } else if (queueInboxPayload(conversationId, outboundPayload)) {
              persistChatState();
            }
            return;
          }

          const room = rooms.get(conversationId);
          if (!room) return;
          const outboundPayload = {
            type: 'msg:reaction',
            conversationId,
            kind: 'group',
            messageId,
            emoji,
            userId: actorId,
            action,
          };
          let queuedOffline = false;
          for (const memberId of room.memberIds) {
            if (memberId === actorId) continue;
            const c = clients.get(memberId);
            if (c && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(JSON.stringify(outboundPayload));
            } else if (queueInboxPayload(memberId, outboundPayload)) {
              queuedOffline = true;
            }
          }
          if (queuedOffline) {
            persistChatState();
          }
          return;
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    ws.on('message', (raw) => {
      messageQueue = messageQueue.then(() => handleSocketMessage(raw));
    });

    ws.on('close', () => {
      if (registeredUserId && clients.get(registeredUserId)?.ws === ws) {
        clients.delete(registeredUserId);
        broadcastDirectory();
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Corp Messenger E2EE server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
