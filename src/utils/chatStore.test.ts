import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  enqueueInboxPacket,
  loadChatStore,
  saveChatStore,
  upsertVaultRecord,
} from './chatStore';

test('chatStore persists encrypted vaults, rooms, and prunes expired disappearing messages', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-chat-store-'));
  const storePath = path.join(tmpDir, 'chat-store.json');

  try {
    let vault = upsertVaultRecord(
      [],
      {
        messageId: 'm1',
        conversationId: 'room-general',
        timestamp: 100,
        ivB64: 'iv1',
        ciphertextB64: 'ct1',
      },
      1000
    );
    vault = upsertVaultRecord(
      vault,
      {
        messageId: 'm2',
        conversationId: 'room-general',
        timestamp: 200,
        expiresAt: 1500,
        ivB64: 'iv2',
        ciphertextB64: 'ct2',
      },
      1000
    );
    // Update existing m1 (e.g., reaction/pin)
    vault = upsertVaultRecord(
      vault,
      {
        messageId: 'm1',
        conversationId: 'room-general',
        timestamp: 100,
        ivB64: 'iv1_updated',
        ciphertextB64: 'ct1_updated',
      },
      1000
    );
    assert.equal(vault.length, 2);
    assert.equal(vault[0].ciphertextB64, 'ct1_updated');

    const inbox = enqueueInboxPacket([], {
      id: 'pkt_1',
      queuedAt: 1200,
      payload: { type: 'msg:envelope', id: 'm3' },
    });

    saveChatStore(storePath, {
      rooms: [
        {
          id: 'room-custom',
          name: 'custom',
          description: 'desc',
          topic: 'topic',
          department: 'IT',
          category: 'project',
          kind: 'channel',
          memberIds: ['admin'],
          isArchived: false,
          onlyAdminsCanPost: false,
          senderKeyGeneration: 1,
        },
      ],
      liveBundles: {},
      vaults: { admin: vault },
      pendingInbox: { emp_1: inbox },
    });

    // Reload at t=2000: m2 (expiresAt=1500) should be pruned cleanly
    const reloaded = loadChatStore(storePath, 2000);
    assert.equal(reloaded.rooms.length, 1);
    assert.equal(reloaded.rooms[0].id, 'room-custom');
    assert.equal(reloaded.vaults.admin.length, 1);
    assert.equal(reloaded.vaults.admin[0].messageId, 'm1');
    assert.equal(reloaded.vaults.admin[0].ciphertextB64, 'ct1_updated');
    assert.equal(reloaded.pendingInbox.emp_1.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
