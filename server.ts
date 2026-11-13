import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  decryptMessage,
  encryptMessage,
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
  decryptGroupMessage,
  encryptGroupMessage,
  exportSenderKeyDistribution,
  importSenderKeyDistribution,
  unwrapSenderKeyFromPeer,
  wrapSenderKeyForPeer,
  type EncryptedGroupEnvelope,
  type SenderKeyState,
} from './src/crypto/senderKey.ts';
import {
  canAccessAdminPanel,
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
import type { ChannelCategory } from './src/types/messenger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerPeerAgent {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  enterpriseRole: EnterpriseRole;
  isActive: boolean;
  keysVerified: boolean;
  isInteractiveAgent: boolean;
  presence: 'online' | 'away' | 'dnd' | 'offline';
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

const PEER_BLUEPRINTS: Array<{
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  enterpriseRole: EnterpriseRole;
  presence: 'online' | 'away' | 'dnd' | 'offline';
  keysVerified: boolean;
  isInteractiveAgent: boolean;
}> = [
  {
    id: 'peer-echo',
    name: 'Signal Echo Node',
    email: 'echo-node@corp.internal',
    department: 'Информационная безопасность',
    title: 'Крипто-верификатор E2EE',
    enterpriseRole: 'security_officer',
    presence: 'online',
    keysVerified: true,
    isInteractiveAgent: true,
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
    isInteractiveAgent: true,
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
    isInteractiveAgent: true,
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
    isInteractiveAgent: false,
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
    isInteractiveAgent: false,
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
    isInteractiveAgent: false,
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
    description: 'Общий корпоративный канал (Sender Keys E2EE)',
    topic: 'Рабочие вопросы, релизы и кросс-командная координация',
    department: 'Вся компания',
    category: 'department',
    kind: 'channel',
    onlyAdminsCanPost: false,
  },
  {
    id: 'room-security',
    name: 'security-audit',
    description: 'Закрытый канал ИБ, комплаенса и обмена ключами',
    topic: 'Аудит SOC2, реагирование на инциденты и ротация SenderKeys',
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

async function createPeerAgents(): Promise<Map<string, ServerPeerAgent>> {
  const agents = new Map<string, ServerPeerAgent>();
  const now = Date.now();
  for (const bp of PEER_BLUEPRINTS) {
    const bundle = await generateIdentityBundle(bp.id);
    const roomSelfKeys = new Map<string, SenderKeyState>();
    for (const r of INITIAL_ROOMS) {
      roomSelfKeys.set(r.id, await createSenderKeyState(r.id, bp.id));
    }
    agents.set(bp.id, {
      id: bp.id,
      name: bp.name,
      email: bp.email,
      department: bp.department,
      title: bp.title,
      enterpriseRole: bp.enterpriseRole,
      isActive: true,
      keysVerified: bp.keysVerified,
      isInteractiveAgent: bp.isInteractiveAgent,
      presence: bp.presence,
      bundle,
      dmSessions: new Map(),
      roomSelfKeys,
      roomPeerKeys: new Map(),
      lastActiveAt: now,
    });
  }
  return agents;
}

function buildDmAgentReply(
  agentId: string,
  incoming: string,
  counter: number,
  threadRootId?: string
): string {
  const lower = incoming.toLowerCase();
  const threadPrefix = threadRootId ? '[Ветка треда] ' : '';
  if (agentId === 'peer-echo') {
    if (lower.includes('привет') || lower.includes('hello') || lower.includes('hi')) {
      return `${threadPrefix}Привет! Расшифровано через Double Ratchet (счётчик #${counter}). Эфемерный DH-ключ обновлён.`;
    }
    return `${threadPrefix}E2EE подтверждено (#${counter}): «${incoming.slice(0, 72)}» расшифровано локально и перешифровано новым ключом цепи.`;
  }
  if (agentId === 'peer-elena') {
    if (lower.includes('ключ') || lower.includes('safety') || lower.includes('номер')) {
      return `${threadPrefix}Safety Number вычисляется из публичных ключей обеих сторон через SHA-512. Можешь сверить 60 цифр в окне «Безопасность».`;
    }
    return `${threadPrefix}Принято (Double Ratchet #${counter}). Сервер-ретранслятор видел только выровненный шифротекст AES-256-GCM.`;
  }
  if (agentId === 'peer-marcus') {
    return `${threadPrefix}Получено (#${counter}). Виртуализированный MessageList удерживает O(log N) рендеринг даже при 10 000+ сообщений.`;
  }
  return `${threadPrefix}Принято корпоративным узлом (Double Ratchet #${counter}). Политика E2EE соблюдена.`;
}

function buildRoomAgentReply(
  agent: ServerPeerAgent,
  roomId: string,
  incoming: string,
  iteration: number,
  threadRootId?: string
): string {
  const prefix = threadRootId ? `[Тред · SenderKey #${iteration}] ` : '';
  if (roomId === 'room-security') {
    return `${prefix || `[SenderKey #${iteration}] `}Подтверждаю: сообщение «${incoming.slice(0, 50)}» проверено подписью ECDSA и расшифровано только участниками ИБ.`;
  }
  if (roomId === 'room-devops') {
    return `${prefix || `[SRE #${iteration}] `}Зафиксировано в #devops-sre. Кластеры в штатном режиме, ключ цепи синхронизирован.`;
  }
  if (roomId === 'room-legal') {
    return `${prefix || `[Комплаенс #${iteration}] `}Принято в закрытом юридическом канале. Метаданные не покидают периметр.`;
  }
  if (agent.id === 'peer-marcus') {
    return `${prefix}Принято в канале (итерация цепи #${iteration}). Memoized MessageRow обновил только новую строку без пересчёта списка.`;
  }
  return `${prefix}Канальное сообщение #${iteration} расшифровано через SenderKey AES-256-GCM.`;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const peerAgents = await createPeerAgents();
  const clients = new Map<string, ConnectedClient>();
  const rooms = new Map<string, ServerRoom>();
  // Persist enterprise role & active flags by userId across reconnects
  const clientOverrides = new Map<
    string,
    {
      role?: EnterpriseRole;
      isActive?: boolean;
      department?: string;
      title?: string;
      email?: string;
      name?: string;
    }
  >();

  let enterprisePolicy: EnterprisePolicy = {
    requireE2EE: true,
    requireVerifiedSafetyNumberForExternal: true,
    restrictGuestDownloads: true,
    allowMemberChannelCreation: true,
    defaultDisappearingTtlSec: 0,
    sessionKeyRotationHours: 24,
    maxAttachmentSizeMb: 25,
  };

  let messagesTodayCount = 1284;
  const auditLogs: AuditLogItem[] = [
    {
      id: 'audit_init_1',
      action: 'policy.initialized',
      actorId: 'system',
      actorName: 'Crypto Policy Engine',
      targetType: 'policy',
      targetId: 'enterprise-default',
      summary: 'Применён базовый профиль Zero-Knowledge E2EE и DLP (AES-256-GCM)',
      timestamp: Date.now() - 3600_000 * 4,
    },
    {
      id: 'audit_init_2',
      action: 'sender_key.provisioned',
      actorId: 'peer-elena',
      actorName: 'Елена Соколова',
      targetType: 'room',
      targetId: 'room-security',
      summary: 'Выпущены первичные ключи SenderKey для закрытого канала #security-audit',
      timestamp: Date.now() - 3600_000 * 2,
    },
    {
      id: 'audit_init_3',
      action: 'user.keys_verified',
      actorId: 'peer-elena',
      actorName: 'Елена Соколова',
      targetType: 'user',
      targetId: 'peer-marcus',
      summary: 'Подтверждён 60-значный Safety Number для сотрудника Марк Волков',
      timestamp: Date.now() - 1800_000,
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

  for (const r of INITIAL_ROOMS) {
    const initialMembers = PEER_BLUEPRINTS.filter((p) => {
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
    }).map((p) => p.id);

    rooms.set(r.id, {
      ...r,
      memberIds: new Set(initialMembers),
      isArchived: false,
      senderKeyGeneration: 1,
    });
  }

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

    for (const agent of peerAgents.values()) {
      list.push({
        userId: agent.id,
        name: agent.name,
        role: agent.title,
        department: agent.department,
        enterpriseRole: agent.enterpriseRole,
        isActive: agent.isActive,
        presence: agent.isActive ? agent.presence : 'offline',
        isSystemPeer: agent.isInteractiveAgent,
        bundle: extractPublicPreKeyBundle(agent.bundle),
      });
    }

    for (const client of clients.values()) {
      if (client.userId !== excludeUserId) {
        list.push({
          userId: client.userId,
          name: client.name,
          role: client.title,
          department: client.department,
          enterpriseRole: client.enterpriseRole,
          isActive: client.isActive,
          presence: client.isActive ? client.presence : 'offline',
          isSystemPeer: false,
          bundle: client.bundle,
        });
      }
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
    for (const agent of peerAgents.values()) {
      users.push({
        userId: agent.id,
        name: agent.name,
        email: agent.email,
        department: agent.department,
        title: agent.title,
        role: agent.enterpriseRole,
        isActive: agent.isActive,
        presence: agent.isActive ? agent.presence : 'offline',
        registrationId: agent.bundle.registrationId,
        lastActiveAt: agent.lastActiveAt,
        keysVerified: agent.keysVerified,
      });
    }
    for (const client of clients.values()) {
      users.push({
        userId: client.userId,
        name: client.name,
        email: client.email,
        department: client.department,
        title: client.title,
        role: client.enterpriseRole,
        isActive: client.isActive,
        presence: client.isActive ? client.presence : 'offline',
        registrationId: client.bundle.registrationId,
        lastActiveAt: client.lastActiveAt,
        keysVerified: client.keysVerified,
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

  const agentReplyQueues = new Map<string, Promise<void>>();

  function enqueueAgentTask(queueKey: string, task: () => Promise<void>): void {
    const prev = agentReplyQueues.get(queueKey) ?? Promise.resolve();
    const next = prev
      .then(task)
      .catch((err) => {
        console.error(`Agent task failed (${queueKey}):`, err);
      });
    agentReplyQueues.set(queueKey, next);
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
    for (const agent of peerAgents.values()) {
      if (!agent.isActive) continue;
      for (const room of rooms.values()) {
        if (onlyRoomId && room.id !== onlyRoomId) continue;
        let sk = agent.roomSelfKeys.get(room.id);
        if (!sk) {
          sk = await createSenderKeyState(room.id, agent.id);
          agent.roomSelfKeys.set(room.id, sk);
        }
        const dist = exportSenderKeyDistribution(sk);
        const wrapped = await wrapSenderKeyForPeer(
          dist,
          agent.bundle,
          client.bundle.identityPublicB64
        );
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(
            JSON.stringify({
              type: 'group:senderKey',
              roomId: room.id,
              senderId: agent.id,
              recipientId: client.userId,
              senderIdentityPublicB64: agent.bundle.identityKey.publicKeyB64,
              ivB64: wrapped.ivB64,
              wrappedB64: wrapped.wrappedB64,
            })
          );
        }
      }
    }
  }

  function resolveHttpActorRole(req: express.Request): EnterpriseRole | null {
    const actorId =
      req.header('x-user-id') ||
      (typeof req.query?.userId === 'string' ? req.query.userId : undefined) ||
      (typeof req.body?.actorId === 'string' ? req.body.actorId : undefined);
    if (!actorId) return null;
    const client = clients.get(actorId);
    if (client) return client.enterpriseRole;
    const agent = peerAgents.get(actorId);
    if (agent) return agent.enterpriseRole;
    return null;
  }

  function requireAdminRole(
    predicate: (role: EnterpriseRole) => boolean = canAccessAdminPanel
  ): express.RequestHandler {
    return (req, res, next) => {
      const role = resolveHttpActorRole(req);
      if (!role || !predicate(role)) {
        res.status(403).json({
          error:
            'Доступ запрещён: операция доступна только администраторам и офицерам ИБ',
        });
        return;
      }
      next();
    };
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      connectedClients: clients.size,
      rooms: rooms.size,
      protocol: 'Signal-X3DH-DoubleRatchet-SenderKeys',
    });
  });

  app.get('/api/peers', (_req, res) => {
    res.json({ peers: getAllPublicPeers() });
  });

  app.use('/api/admin', requireAdminRole(canAccessAdminPanel));

  // Enterprise Admin REST API
  app.get('/api/admin/overview', (_req, res) => {
    res.json(buildAdminOverview());
  });

  app.post('/api/admin/users', requireAdminRole(canManageUsers), async (req, res) => {
    try {
      const {
        name,
        email,
        department,
        title,
        role,
        actorId = 'admin',
        actorName = 'Администратор',
      } = req.body as {
        name?: string;
        email?: string;
        department?: string;
        title?: string;
        role?: EnterpriseRole;
        actorId?: string;
        actorName?: string;
      };
      const cleanName = (name ?? '').trim();
      const cleanEmail = (email ?? '').trim();
      if (!cleanName || !cleanEmail) {
        res.status(400).json({ error: 'Имя и корпоративный Email обязательны' });
        return;
      }

      const id = `emp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const bundle = await generateIdentityBundle(id);
      const roomSelfKeys = new Map<string, SenderKeyState>();
      for (const room of rooms.values()) {
        roomSelfKeys.set(room.id, await createSenderKeyState(room.id, id));
        if (room.kind === 'channel') {
          room.memberIds.add(id);
        }
      }

      const cleanRole: EnterpriseRole = role ?? 'member';
      peerAgents.set(id, {
        id,
        name: cleanName,
        email: cleanEmail,
        department: (department ?? '').trim() || 'Корпоративный офис',
        title: (title ?? '').trim() || 'Специалист',
        enterpriseRole: cleanRole,
        isActive: true,
        keysVerified: cleanRole !== 'guest',
        isInteractiveAgent: false,
        presence: 'online',
        bundle,
        dmSessions: new Map(),
        roomSelfKeys,
        roomPeerKeys: new Map(),
        lastActiveAt: Date.now(),
      });

      recordAuditLog({
        action: 'user.invited',
        actorId,
        actorName,
        targetType: 'user',
        targetId: id,
        summary: `Добавлен сотрудник ${cleanName} (${cleanEmail}), роль: ${cleanRole}`,
      });

      broadcastDirectory();
      for (const c of clients.values()) {
        await sendAgentSenderKeysToClient(c);
      }
      res.status(201).json(buildAdminOverview());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка создания пользователя' });
    }
  });

  app.patch('/api/admin/users/:userId', requireAdminRole(canManageUsers), (req, res) => {
    const { userId } = req.params;
    const { role, isActive, actorId = 'admin', actorName = 'Администратор' } =
      req.body as {
        role?: EnterpriseRole;
        isActive?: boolean;
        actorId?: string;
        actorName?: string;
      };

    const agent = peerAgents.get(userId);
    const client = clients.get(userId);
    if (!agent && !client) {
      res.status(404).json({ error: 'Сотрудник не найден' });
      return;
    }

    const targetName = agent?.name ?? client?.name ?? userId;
    if (agent) {
      if (role !== undefined) agent.enterpriseRole = role;
      if (isActive !== undefined) agent.isActive = isActive;
    }
    if (client) {
      const prev = clientOverrides.get(userId) ?? {};
      if (role !== undefined) {
        client.enterpriseRole = role;
        prev.role = role;
      }
      if (isActive !== undefined) {
        client.isActive = isActive;
        prev.isActive = isActive;
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(
            JSON.stringify({
              type: 'account:status',
              isActive,
              role: client.enterpriseRole,
            })
          );
        }
      }
      clientOverrides.set(userId, prev);
    }

    if (role !== undefined) {
      recordAuditLog({
        action: 'user.role_changed',
        actorId,
        actorName,
        targetType: 'user',
        targetId: userId,
        summary: `Назначена роль ${role} сотруднику ${targetName}`,
      });
    }
    if (isActive !== undefined) {
      recordAuditLog({
        action: isActive ? 'user.restored' : 'user.suspended',
        actorId,
        actorName,
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
      const { userId } = req.params;
      const { actorId = 'admin', actorName = 'Администратор' } = (req.body ?? {}) as {
        actorId?: string;
        actorName?: string;
      };

      const agent = peerAgents.get(userId);
      const client = clients.get(userId);
      if (!agent && !client) {
        res.status(404).json({ error: 'Сотрудник не найден' });
        return;
      }

      if (agent) {
        agent.bundle = await generateIdentityBundle(agent.id);
        agent.dmSessions.clear();
        agent.roomPeerKeys.clear();
        agent.keysVerified = false;
        for (const room of rooms.values()) {
          agent.roomSelfKeys.set(room.id, await createSenderKeyState(room.id, agent.id));
        }
      }

      const targetName = agent?.name ?? client?.name ?? userId;
      if (client) {
        client.keysVerified = false;
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'keys:revoked' }));
        }
      }

      recordAuditLog({
        action: 'user.keys_revoked',
        actorId,
        actorName,
        targetType: 'security',
        targetId: userId,
        summary: `Отозваны ключи Identity/SignedPreKey и сброшены сессии для ${targetName}`,
      });

      broadcastDirectory();
      for (const c of clients.values()) {
        await sendAgentSenderKeysToClient(c);
      }
      res.json(buildAdminOverview());
    }
  );

  app.patch('/api/admin/policies', requireAdminRole(canManageSecurityPolicies), (req, res) => {
    const { policy, actorId = 'admin', actorName = 'Администратор' } = req.body as {
      policy: Partial<EnterprisePolicy>;
      actorId?: string;
      actorName?: string;
    };
    if (!policy) {
      res.status(400).json({ error: 'Не переданы параметры политики' });
      return;
    }

    enterprisePolicy = {
      ...enterprisePolicy,
      ...policy,
      requireE2EE: true, // Zero-knowledge invariant cannot be turned off in corp edition
    };

    recordAuditLog({
      action: 'policy.updated',
      actorId,
      actorName,
      targetType: 'policy',
      targetId: 'enterprise-default',
      summary: `Обновлены политики ИБ: DLP гостей=${enterprisePolicy.restrictGuestDownloads ? 'вкл' : 'выкл'}, создание каналов сотрудниками=${enterprisePolicy.allowMemberChannelCreation ? 'да' : 'нет'}, TTL=${enterprisePolicy.defaultDisappearingTtlSec}с`,
    });

    broadcastPolicyUpdate();
    res.json(buildAdminOverview());
  });

  app.post('/api/admin/rooms/:roomId/archive', requireAdminRole(canManageUsers), (req, res) => {
    const { roomId } = req.params;
    const { actorId = 'admin', actorName = 'Администратор' } = (req.body ?? {}) as {
      actorId?: string;
      actorName?: string;
    };

    const room = rooms.get(roomId);
    if (!room) {
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }

    room.isArchived = !room.isArchived;
    recordAuditLog({
      action: room.isArchived ? 'room.archived' : 'room.restored',
      actorId,
      actorName,
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
    async (req, res) => {
      const { actorId = 'admin', actorName = 'Администратор' } = (req.body ?? {}) as {
        actorId?: string;
        actorName?: string;
      };

      for (const room of rooms.values()) {
        room.senderKeyGeneration += 1;
        for (const agent of peerAgents.values()) {
          agent.roomSelfKeys.set(room.id, await createSenderKeyState(room.id, agent.id));
        }
      }

      for (const c of clients.values()) {
        await sendAgentSenderKeysToClient(c);
      }

      recordAuditLog({
        action: 'sender_key.rotated_all',
        actorId,
        actorName,
        targetType: 'security',
        targetId: 'all-rooms',
        summary: `Выполнена принудительная ротация SenderKeys по всем ${rooms.size} каналам`,
      });

      res.json(buildAdminOverview());
    }
  );

  wss.on('connection', (ws) => {
    let registeredUserId: string | null = null;
    let messageQueue = Promise.resolve();

    const handleSocketMessage = async (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'register') {
          const { userId, name, bundle, presence, role } = msg as {
            userId: string;
            name: string;
            bundle: PublicPreKeyBundle;
            presence?: 'online' | 'away' | 'dnd' | 'offline';
            role?: EnterpriseRole;
          };
          if (!userId || !bundle) return;
          registeredUserId = userId;
          const override = clientOverrides.get(userId);
          const effectiveRole: EnterpriseRole = override?.role ?? role ?? 'member';
          const client: ConnectedClient = {
            userId,
            name: override?.name || name || userId,
            email: override?.email || `${userId}@corp.internal`,
            department: override?.department || 'Платформенная разработка',
            title:
              override?.title ||
              (canAccessAdminPanel(effectiveRole) ? 'Руководитель / Администратор' : 'Сотрудник'),
            enterpriseRole: effectiveRole,
            isActive: override?.isActive ?? true,
            keysVerified: true,
            presence: presence || 'online',
            ws,
            bundle,
            lastActiveAt: Date.now(),
          };
          clients.set(userId, client);

          for (const room of rooms.values()) {
            if (room.id === 'room-announcements' || room.id === 'room-general') {
              room.memberIds.add(userId);
            } else if (room.kind === 'private' && canAccessAdminPanel(effectiveRole)) {
              room.memberIds.add(userId);
            }
          }

          ws.send(
            JSON.stringify({
              type: 'directory:sync',
              peers: getAllPublicPeers(userId),
              rooms: getRoomListForClient(userId, client.enterpriseRole),
              policy: enterprisePolicy,
              selfAccount: {
                role: client.enterpriseRole,
                isActive: client.isActive,
              },
            })
          );
          await sendAgentSenderKeysToClient(client);
          broadcastDirectory();
          return;
        }

        if (msg.type === 'role:switch') {
          if (!registeredUserId) return;
          const client = clients.get(registeredUserId);
          const nextRole = msg.role as EnterpriseRole;
          if (client && nextRole) {
            client.enterpriseRole = nextRole;
            client.title = canAccessAdminPanel(nextRole)
              ? 'Руководитель / Администратор'
              : nextRole === 'guest'
              ? 'Внешний аудитор'
              : 'Сотрудник';
            const prev = clientOverrides.get(registeredUserId) ?? {};
            clientOverrides.set(registeredUserId, {
              ...prev,
              role: nextRole,
              title: client.title,
            });
            if (canAccessAdminPanel(nextRole)) {
              rooms.get('room-security')?.memberIds.add(registeredUserId);
            }
            recordAuditLog({
              action: 'user.role_changed',
              actorId: client.userId,
              actorName: client.name,
              targetType: 'user',
              targetId: client.userId,
              summary: `Профиль сессии переключён на роль ${nextRole}`,
            });
            broadcastDirectory();
          }
          return;
        }

        const senderClient = registeredUserId ? clients.get(registeredUserId) : undefined;
        if (senderClient && !senderClient.isActive) {
          ws.send(
            JSON.stringify({
              type: 'account:status',
              isActive: false,
              role: senderClient.enterpriseRole,
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
            creatorId,
          } = msg as {
            name: string;
            description?: string;
            topic?: string;
            department?: string;
            category?: ChannelCategory;
            kind?: 'channel' | 'private';
            onlyAdminsCanPost?: boolean;
            creatorId: string;
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
            memberIds: new Set([creatorId, ...PEER_BLUEPRINTS.filter((p) => resolvedKind === 'channel' || p.enterpriseRole !== 'guest').map((p) => p.id)]),
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
          for (const agent of peerAgents.values()) {
            agent.roomSelfKeys.set(
              roomId,
              await createSenderKeyState(roomId, agent.id)
            );
          }

          recordAuditLog({
            action: 'room.created',
            actorId: creatorId,
            actorName: senderClient?.name ?? creatorId,
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
          const { senderId, receiverId, senderBundle, ephemeralPublicB64 } = msg as {
            senderId: string;
            receiverId: string;
            senderBundle: PublicPreKeyBundle;
            ephemeralPublicB64: string;
          };
          const agent = peerAgents.get(receiverId);
          if (agent) {
            const session = await establishSessionAsResponder(
              agent.bundle,
              senderBundle,
              ephemeralPublicB64
            );
            agent.dmSessions.set(senderId, session);
            ws.send(
              JSON.stringify({
                type: 'session:ack',
                peerId: agent.id,
                establishedAt: Date.now(),
              })
            );
            return;
          }
          const targetClient = clients.get(receiverId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify(msg));
          }
          return;
        }

        if (msg.type === 'group:senderKey') {
          const {
            roomId,
            senderId,
            recipientId,
            senderIdentityPublicB64,
            ivB64,
            wrappedB64,
          } = msg as {
            roomId: string;
            senderId: string;
            recipientId: string;
            senderIdentityPublicB64: string;
            ivB64: string;
            wrappedB64: string;
          };

          const agent = peerAgents.get(recipientId);
          if (agent) {
            const dist = await unwrapSenderKeyFromPeer(
              { ivB64, wrappedB64 },
              agent.bundle,
              senderIdentityPublicB64
            );
            agent.roomPeerKeys.set(
              `${roomId}:${senderId}`,
              importSenderKeyDistribution(dist)
            );
            return;
          }

          const targetClient = clients.get(recipientId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify(msg));
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

          for (const c of clients.values()) {
            if (
              c.userId !== envelope.senderId &&
              room.memberIds.has(c.userId) &&
              c.ws.readyState === WebSocket.OPEN
            ) {
              c.ws.send(
                JSON.stringify({
                  type: 'group:envelope',
                  envelope,
                  attachment,
                  ephemeralTtlSec,
                })
              );
            }
          }

          const responderId =
            envelope.roomId === 'room-announcements'
              ? null
              : envelope.roomId === 'room-security' || envelope.roomId === 'room-legal'
              ? 'peer-elena'
              : envelope.roomId === 'room-devops'
              ? 'peer-marcus'
              : 'peer-echo';
          const agent = responderId ? peerAgents.get(responderId) : undefined;
          if (agent && agent.isActive) {
            const keyKey = `${envelope.roomId}:${envelope.senderId}`;
            const senderState = agent.roomPeerKeys.get(keyKey);
            if (senderState) {
              const decrypted = await decryptGroupMessage(senderState, envelope);
              agent.roomPeerKeys.set(keyKey, decrypted.nextState);

              setTimeout(() => {
                enqueueAgentTask(`room:${agent.id}:${envelope.roomId}`, async () => {
                  const selfSk = agent.roomSelfKeys.get(envelope.roomId);
                  if (!selfSk) return;
                  const replyText = buildRoomAgentReply(
                    agent,
                    envelope.roomId,
                    decrypted.plaintext,
                    envelope.iteration,
                    envelope.threadRootId
                  );
                  const encryptedReply = await encryptGroupMessage(selfSk, replyText, {
                    replyToId: envelope.id,
                    threadRootId: envelope.threadRootId,
                  });
                  agent.roomSelfKeys.set(envelope.roomId, encryptedReply.nextState);
                  messagesTodayCount += 1;

                  for (const c of clients.values()) {
                    if (
                      room.memberIds.has(c.userId) &&
                      c.ws.readyState === WebSocket.OPEN
                    ) {
                      c.ws.send(
                        JSON.stringify({
                          type: 'group:envelope',
                          envelope: encryptedReply.envelope,
                          ephemeralTtlSec,
                        })
                      );
                    }
                  }
                });
              }, 260);
            }
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

          const agent = peerAgents.get(envelope.receiverId);
          if (agent && agent.isActive) {
            const session = agent.dmSessions.get(envelope.senderId);
            if (!session) return;

            const decrypted = await decryptMessage(session, envelope);
            agent.dmSessions.set(envelope.senderId, decrypted.nextSession);

            ws.send(
              JSON.stringify({
                type: 'msg:receipt',
                messageId: envelope.id,
                peerId: agent.id,
                status: 'read',
              })
            );

            ws.send(
              JSON.stringify({
                type: 'typing:state',
                conversationId: agent.id,
                userName: agent.name,
                isTyping: true,
              })
            );

            setTimeout(() => {
              enqueueAgentTask(`dm:${agent.id}:${envelope.senderId}`, async () => {
                const currSession = agent.dmSessions.get(envelope.senderId);
                if (!currSession || ws.readyState !== WebSocket.OPEN) return;
                const replyText = buildDmAgentReply(
                  agent.id,
                  decrypted.plaintext,
                  envelope.counter,
                  envelope.threadRootId
                );
                const encryptedReply = await encryptMessage(
                  currSession,
                  agent.id,
                  replyText,
                  {
                    threadRootId: envelope.threadRootId,
                    replyToId: envelope.id,
                  }
                );
                agent.dmSessions.set(envelope.senderId, encryptedReply.nextSession);
                messagesTodayCount += 1;

                ws.send(
                  JSON.stringify({
                    type: 'typing:state',
                    conversationId: agent.id,
                    userName: agent.name,
                    isTyping: false,
                  })
                );
                ws.send(
                  JSON.stringify({
                    type: 'msg:envelope',
                    envelope: encryptedReply.envelope,
                    ephemeralTtlSec,
                  })
                );
              });
            }, 240);
            return;
          }

          const targetClient = clients.get(envelope.receiverId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(
              JSON.stringify({
                type: 'msg:envelope',
                envelope,
                attachment,
                ephemeralTtlSec,
              })
            );
            ws.send(
              JSON.stringify({
                type: 'msg:receipt',
                messageId: envelope.id,
                peerId: envelope.receiverId,
                status: 'delivered',
              })
            );
          }
          return;
        }

        if (
          msg.type === 'msg:edit' ||
          msg.type === 'msg:delete' ||
          msg.type === 'msg:pin'
        ) {
          for (const c of clients.values()) {
            if (c.userId !== registeredUserId && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(JSON.stringify(msg));
            }
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
            const targetClient = clients.get(conversationId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(
                JSON.stringify({
                  type: 'msg:reaction',
                  conversationId: actorId,
                  kind: 'dm',
                  messageId,
                  emoji,
                  userId: actorId,
                  action,
                })
              );
            }
            return;
          }

          if (!rooms.has(conversationId)) return;
          for (const c of clients.values()) {
            if (c.userId !== actorId && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(
                JSON.stringify({
                  type: 'msg:reaction',
                  conversationId,
                  kind: 'group',
                  messageId,
                  emoji,
                  userId: actorId,
                  action,
                })
              );
            }
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
      if (registeredUserId) {
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
