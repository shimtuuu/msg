import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { EnterpriseRole, PresenceState } from '../types/messenger.ts';

export interface PersistedAccountRecord {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  enterpriseRole: EnterpriseRole;
  isActive: boolean;
  keysVerified: boolean;
  presence: PresenceState;
  passwordHash: string;
  lastActiveAt: number;
}

export interface PersistedSessionRecord {
  sid: string;
  uid: string;
  exp: number;
}

export interface PersistedAuthState {
  sessionSecret: string;
  accounts: PersistedAccountRecord[];
  sessions: PersistedSessionRecord[];
}

export function loadAuthStore(
  filePath: string,
  nowMs: number = Date.now(),
  envSecret?: string
): PersistedAuthState {
  const fallbackSecret =
    envSecret && envSecret.trim()
      ? envSecret.trim()
      : crypto.randomBytes(32).toString('hex');

  try {
    if (!fs.existsSync(filePath)) {
      return {
        sessionSecret: fallbackSecret,
        accounts: [],
        sessions: [],
      };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedAuthState>;
    const sessionSecret =
      envSecret && envSecret.trim()
        ? envSecret.trim()
        : typeof parsed.sessionSecret === 'string' && parsed.sessionSecret.length >= 16
        ? parsed.sessionSecret
        : fallbackSecret;

    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter(
          (s): s is PersistedSessionRecord =>
            Boolean(s) &&
            typeof s.sid === 'string' &&
            typeof s.uid === 'string' &&
            typeof s.exp === 'number' &&
            s.exp > nowMs
        )
      : [];

    return {
      sessionSecret,
      accounts,
      sessions,
    };
  } catch {
    return {
      sessionSecret: fallbackSecret,
      accounts: [],
      sessions: [],
    };
  }
}

export function saveAuthStore(
  filePath: string,
  state: PersistedAuthState
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}
