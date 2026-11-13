import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadAuthStore, saveAuthStore } from './authStore';

test('authStore persists sessionSecret, accounts, and filters expired sessions on reload', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-auth-store-'));
  const storePath = path.join(tmpDir, 'auth-state.json');

  try {
    const initial = loadAuthStore(storePath, 1000);
    assert.ok(initial.sessionSecret.length >= 32);
    assert.equal(initial.accounts.length, 0);
    assert.equal(initial.sessions.length, 0);

    saveAuthStore(storePath, {
      sessionSecret: initial.sessionSecret,
      accounts: [
        {
          id: 'emp_1',
          name: 'Тест Сотрудник',
          email: 'test@corp.internal',
          department: 'ИТ',
          title: 'Инженер',
          enterpriseRole: 'member',
          isActive: true,
          keysVerified: true,
          presence: 'online',
          passwordHash: 'salt:hash',
          lastActiveAt: 1000,
        },
      ],
      sessions: [
        { sid: 'active_sid', uid: 'emp_1', exp: 5000 },
        { sid: 'expired_sid', uid: 'emp_1', exp: 1500 },
      ],
    });

    const reloaded = loadAuthStore(storePath, 2000);
    assert.equal(reloaded.sessionSecret, initial.sessionSecret);
    assert.equal(reloaded.accounts.length, 1);
    assert.equal(reloaded.accounts[0].email, 'test@corp.internal');
    assert.equal(reloaded.sessions.length, 1);
    assert.equal(reloaded.sessions[0].sid, 'active_sid');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
