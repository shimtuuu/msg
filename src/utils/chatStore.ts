import fs from 'fs';
import path from 'path';
import type { PublicPreKeyBundle } from '../crypto/signalEngine.ts';
import type { EncryptedVaultRecord } from '../crypto/vaultCrypto.ts';
import type { ChannelCategory } from '../types/messenger.ts';

export interface PersistedRoomRecord {
  id: string;
  name: string;
  description: string;
  topic: string;
  department: string;
  category: ChannelCategory;
  kind: 'channel' | 'private';
  memberIds: string[];
  isArchived: boolean;
  onlyAdminsCanPost: boolean;
  senderKeyGeneration: number;
}

export interface PendingInboxPacket {
  id: string;
  queuedAt: number;
  payload: Record<string, unknown>;
}

export interface PersistedChatState {
  rooms: PersistedRoomRecord[];
  liveBundles: Record<string, PublicPreKeyBundle>;
  vaults: Record<string, EncryptedVaultRecord[]>;
  pendingInbox: Record<string, PendingInboxPacket[]>;
}

const MAX_VAULT_ITEMS_PER_USER = 1000;
const MAX_INBOX_ITEMS_PER_USER = 500;

export function loadChatStore(
  filePath: string,
  nowMs: number = Date.now()
): PersistedChatState {
  const empty: PersistedChatState = {
    rooms: [],
    liveBundles: {},
    vaults: {},
    pendingInbox: {},
  };

  try {
    if (!fs.existsSync(filePath)) {
      return empty;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedChatState>;

    const rooms = Array.isArray(parsed.rooms) ? parsed.rooms : [];
    const liveBundles =
      parsed.liveBundles && typeof parsed.liveBundles === 'object'
        ? parsed.liveBundles
        : {};

    const vaults: Record<string, EncryptedVaultRecord[]> = {};
    if (parsed.vaults && typeof parsed.vaults === 'object') {
      for (const [uid, items] of Object.entries(parsed.vaults)) {
        if (!Array.isArray(items)) continue;
        vaults[uid] = items
          .filter(
            (item) =>
              item &&
              typeof item.messageId === 'string' &&
              typeof item.ciphertextB64 === 'string' &&
              (item.expiresAt === undefined || item.expiresAt > nowMs)
          )
          .slice(-MAX_VAULT_ITEMS_PER_USER);
      }
    }

    const pendingInbox: Record<string, PendingInboxPacket[]> = {};
    if (parsed.pendingInbox && typeof parsed.pendingInbox === 'object') {
      for (const [uid, packets] of Object.entries(parsed.pendingInbox)) {
        if (!Array.isArray(packets)) continue;
        pendingInbox[uid] = packets.slice(-MAX_INBOX_ITEMS_PER_USER);
      }
    }

    return { rooms, liveBundles, vaults, pendingInbox };
  } catch {
    return empty;
  }
}

export function upsertVaultRecord(
  existing: EncryptedVaultRecord[],
  record: EncryptedVaultRecord,
  nowMs: number = Date.now()
): EncryptedVaultRecord[] {
  const active = existing.filter(
    (r) =>
      r.messageId !== record.messageId &&
      (r.expiresAt === undefined || r.expiresAt > nowMs)
  );
  active.push(record);
  active.sort((a, b) => a.timestamp - b.timestamp);
  if (active.length > MAX_VAULT_ITEMS_PER_USER) {
    return active.slice(-MAX_VAULT_ITEMS_PER_USER);
  }
  return active;
}

export function enqueueInboxPacket(
  existing: PendingInboxPacket[],
  packet: PendingInboxPacket
): PendingInboxPacket[] {
  const next = [...existing, packet];
  if (next.length > MAX_INBOX_ITEMS_PER_USER) {
    return next.slice(-MAX_INBOX_ITEMS_PER_USER);
  }
  return next;
}

export function saveChatStore(
  filePath: string,
  state: PersistedChatState
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state), 'utf8');
  fs.renameSync(tmpPath, filePath);
}
