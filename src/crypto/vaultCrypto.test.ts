import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentityBundle } from './signalEngine';
import {
  decryptVaultMessage,
  deriveVaultKey,
  encryptVaultMessage,
} from './vaultCrypto';
import type { ChatMessage } from '../types/messenger';

test('vaultCrypto encrypts and decrypts ChatMessage strictly for the owning IdentityBundle', async () => {
  const aliceBundle = await generateIdentityBundle('alice');
  const bobBundle = await generateIdentityBundle('bob');

  const aliceKey = await deriveVaultKey(aliceBundle);
  const bobKey = await deriveVaultKey(bobBundle);

  const msg: ChatMessage = {
    id: 'msg_vault_1',
    conversationId: 'room-general',
    kind: 'group',
    senderId: 'alice',
    senderName: 'Вы',
    text: 'Секретный отчёт по релизу',
    timestamp: 1700000000000,
    status: 'read',
    reactions: { '👍': ['alice', 'bob'] },
    isPinned: true,
  };

  const encrypted = await encryptVaultMessage(aliceKey, msg);
  assert.ok(encrypted.ciphertextB64.length > 0);
  assert.ok(!encrypted.ciphertextB64.includes('Секретный'));

  const decrypted = await decryptVaultMessage(aliceKey, encrypted);
  assert.deepEqual(decrypted, msg);

  // Another user's bundle cannot decrypt Alice's vault item
  const wrongDecrypted = await decryptVaultMessage(bobKey, encrypted);
  assert.equal(wrongDecrypted, null);
});
