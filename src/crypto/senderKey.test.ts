import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentityBundle } from './signalEngine';
import {
  createSenderKeyState,
  decryptGroupMessage,
  encryptGroupMessage,
  exportSenderKeyDistribution,
  importSenderKeyDistribution,
  unwrapSenderKeyFromPeer,
  wrapSenderKeyForPeer,
} from './senderKey';

test('SenderKey wraps/unwraps per peer and encrypts/decrypts channel messages with ECDSA auth', async () => {
  const alice = await generateIdentityBundle('alice');
  const bob = await generateIdentityBundle('bob');

  let aliceSenderState = await createSenderKeyState('room_general', 'alice');
  const dist = exportSenderKeyDistribution(aliceSenderState);

  const wrapped = await wrapSenderKeyForPeer(
    dist,
    alice,
    bob.identityKey.publicKeyB64
  );
  const unwrapped = await unwrapSenderKeyFromPeer(
    wrapped,
    bob,
    alice.identityKey.publicKeyB64
  );
  let bobRecvState = importSenderKeyDistribution(unwrapped);

  const m0 = await encryptGroupMessage(aliceSenderState, 'Канал #general зашифрован.');
  aliceSenderState = m0.nextState;

  const m1 = await encryptGroupMessage(aliceSenderState, 'Второе сообщение канала.');
  aliceSenderState = m1.nextState;

  // Out-of-order delivery in channel
  const d1 = await decryptGroupMessage(bobRecvState, m1.envelope);
  bobRecvState = d1.nextState;
  assert.equal(d1.plaintext, 'Второе сообщение канала.');

  const d0 = await decryptGroupMessage(bobRecvState, m0.envelope);
  bobRecvState = d0.nextState;
  assert.equal(d0.plaintext, 'Канал #general зашифрован.');

  // Tampered ciphertext rejected via ECDSA signature verification
  const tampered = { ...m0.envelope, ciphertextB64: m1.envelope.ciphertextB64 };
  await assert.rejects(() => decryptGroupMessage(bobRecvState, tampered));

  // Nested thread reply carries threadRootId bound in AES-GCM AAD
  const threadReply = await encryptGroupMessage(
    aliceSenderState,
    'Ответ внутри треда канала',
    { threadRootId: m0.envelope.id, replyToId: m0.envelope.id }
  );
  aliceSenderState = threadReply.nextState;
  assert.equal(threadReply.envelope.threadRootId, m0.envelope.id);

  // Tampering threadRootId must fail AES-GCM decryption even with valid ECDSA signature
  await assert.rejects(() =>
    decryptGroupMessage(bobRecvState, {
      ...threadReply.envelope,
      threadRootId: 'tampered_root_id',
    })
  );

  const dThread = await decryptGroupMessage(bobRecvState, threadReply.envelope);
  assert.equal(dThread.plaintext, 'Ответ внутри треда канала');
});

