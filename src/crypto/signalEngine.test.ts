import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSafetyNumber,
  decryptMessage,
  encryptMessage,
  establishSessionAsInitiator,
  establishSessionAsResponder,
  extractPublicPreKeyBundle,
  generateIdentityBundle,
  getPaddedBucketSize,
  padPlaintext,
  unpadPlaintext,
  verifySignedPreKey,
} from './signalEngine';
import {
  decryptAttachment,
  encryptAttachment,
  encryptAudioBlob,
} from './attachmentCrypto';

test('Identity bundle Signed PreKey signature verifies and rejects tampering', async () => {
  const alice = await generateIdentityBundle('alice');
  const pub = extractPublicPreKeyBundle(alice);

  assert.equal(await verifySignedPreKey(pub), true);

  const tampered = { ...pub, signedPreKeyPublicB64: pub.identityPublicB64 };
  assert.equal(await verifySignedPreKey(tampered), false);
});

test('X3DH + Double Ratchet bidirectional encryption & decryption with DH ratchet steps', async () => {
  const alice = await generateIdentityBundle('alice');
  const bob = await generateIdentityBundle('bob');

  const alicePub = extractPublicPreKeyBundle(alice);
  const bobPub = extractPublicPreKeyBundle(bob);

  const { session: aliceInit, ephemeralPublicB64 } =
    await establishSessionAsInitiator(alice, bobPub);
  let bobSession = await establishSessionAsResponder(
    bob,
    alicePub,
    ephemeralPublicB64
  );
  let aliceSession = aliceInit;

  // Alice -> Bob #1
  const m1 = await encryptMessage(aliceSession, 'alice', 'Привет, Bob! Канал защищён.');
  aliceSession = m1.nextSession;
  assert.equal(m1.envelope.counter, 0);
  assert.ok(m1.envelope.paddedByteLength >= 64);

  const d1 = await decryptMessage(bobSession, m1.envelope);
  bobSession = d1.nextSession;
  assert.equal(d1.plaintext, 'Привет, Bob! Канал защищён.');

  // Bob -> Alice (DH Ratchet already rotated automatically when Bob received m1!)
  const m2 = await encryptMessage(bobSession, 'bob', 'Подтверждаю, Double Ratchet работает.');
  bobSession = m2.nextSession;
  assert.notEqual(m2.envelope.dhPublicB64, bobPub.signedPreKeyPublicB64);

  const d2 = await decryptMessage(aliceSession, m2.envelope);
  aliceSession = d2.nextSession;
  assert.equal(d2.plaintext, 'Подтверждаю, Double Ratchet работает.');

  // Alice -> Bob #2 (Alice's DH ratchet rotated automatically on receiving m2!)
  const m3 = await encryptMessage(aliceSession, 'alice', 'Новое эфемерное плечо ключа активно.');
  aliceSession = m3.nextSession;
  assert.notEqual(m3.envelope.dhPublicB64, m1.envelope.dhPublicB64);

  const d3 = await decryptMessage(bobSession, m3.envelope);
  assert.equal(d3.plaintext, 'Новое эфемерное плечо ключа активно.');
});

test('Out-of-order message delivery decrypts via skipped keys cache and rejects replays', async () => {
  const alice = await generateIdentityBundle('alice');
  const bob = await generateIdentityBundle('bob');

  const { session: aliceInit, ephemeralPublicB64 } =
    await establishSessionAsInitiator(alice, extractPublicPreKeyBundle(bob));
  let bobSession = await establishSessionAsResponder(
    bob,
    extractPublicPreKeyBundle(alice),
    ephemeralPublicB64
  );
  let aliceSession = aliceInit;

  const e0 = await encryptMessage(aliceSession, 'alice', 'Packet 0');
  aliceSession = e0.nextSession;
  const e1 = await encryptMessage(aliceSession, 'alice', 'Packet 1');
  aliceSession = e1.nextSession;
  const e2 = await encryptMessage(aliceSession, 'alice', 'Packet 2');
  aliceSession = e2.nextSession;

  // Deliver Packet 2 first, then Packet 0, then Packet 1
  const r2 = await decryptMessage(bobSession, e2.envelope);
  bobSession = r2.nextSession;
  assert.equal(r2.plaintext, 'Packet 2');

  const r0 = await decryptMessage(bobSession, e0.envelope);
  bobSession = r0.nextSession;
  assert.equal(r0.plaintext, 'Packet 0');

  const r1 = await decryptMessage(bobSession, e1.envelope);
  bobSession = r1.nextSession;
  assert.equal(r1.plaintext, 'Packet 1');

  // Replaying Packet 1 must fail
  await assert.rejects(() => decryptMessage(bobSession, e1.envelope));
});

test('Padding bucket normalization & roundtrip', () => {
  const shortMsg = new TextEncoder().encode('hi');
  const padded = padPlaintext(shortMsg);
  assert.equal(padded.length, 64);
  assert.equal(getPaddedBucketSize(100), 128);
  const restored = unpadPlaintext(padded);
  assert.equal(new TextDecoder().decode(restored), 'hi');
});

test('Safety Number is deterministic 60-digit grid symmetric for both peers', async () => {
  const alice = await generateIdentityBundle('alice');
  const bob = await generateIdentityBundle('bob');

  const snAB = await computeSafetyNumber(
    'alice',
    alice.identityKey.publicKeyB64,
    'bob',
    bob.identityKey.publicKeyB64
  );
  const snBA = await computeSafetyNumber(
    'bob',
    bob.identityKey.publicKeyB64,
    'alice',
    alice.identityKey.publicKeyB64
  );

  assert.equal(snAB.length, 12);
  assert.ok(snAB.every((group) => /^\d{5}$/.test(group)));
  assert.deepEqual(snAB, snBA);
});

test('AttachmentCrypto encrypts, verifies HMAC digest, and detects tampering', async () => {
  const secretFile = new TextEncoder().encode('Top secret architectural blueprint PDF bytes');
  const encrypted = await encryptAttachment(secretFile, 'blueprint.pdf', 'application/pdf');

  const decrypted = await decryptAttachment(encrypted);
  assert.equal(new TextDecoder().decode(decrypted), 'Top secret architectural blueprint PDF bytes');

  // Tamper digest
  const corrupted = { ...encrypted, digestB64: encrypted.ivB64 };
  await assert.rejects(() => decryptAttachment(corrupted));
});

test('Double Ratchet envelope binds threadRootId in AES-GCM AAD and rejects thread tampering', async () => {
  const alice = await generateIdentityBundle('alice');
  const bob = await generateIdentityBundle('bob');

  const { session: aliceSession, ephemeralPublicB64 } =
    await establishSessionAsInitiator(alice, extractPublicPreKeyBundle(bob));
  const bobSession = await establishSessionAsResponder(
    bob,
    extractPublicPreKeyBundle(alice),
    ephemeralPublicB64
  );

  const threadMsg = await encryptMessage(
    aliceSession,
    'alice',
    'Ветка обсуждения инцидента #42',
    { threadRootId: 'msg_root_42' }
  );
  assert.equal(threadMsg.envelope.threadRootId, 'msg_root_42');

  // Tampering threadRootId must fail AES-GCM authentication
  await assert.rejects(() =>
    decryptMessage(bobSession, {
      ...threadMsg.envelope,
      threadRootId: 'msg_root_99',
    })
  );

  const decrypted = await decryptMessage(bobSession, threadMsg.envelope);
  assert.equal(decrypted.plaintext, 'Ветка обсуждения инцидента #42');
});

test('encryptAudioBlob encrypts MediaRecorder audio Blob and preserves MIME/digest', async () => {
  const sampleAudioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
  const audioBlob = new Blob([sampleAudioBytes], { type: 'audio/webm;codecs=opus' });

  const encrypted = await encryptAudioBlob(audioBlob, { durationSec: 7 });
  assert.equal(encrypted.mimeType, 'audio/webm;codecs=opus');
  assert.equal(encrypted.originalSize, sampleAudioBytes.length);
  assert.match(encrypted.fileName, /^voice-00m07s-\d+\.webm$/);

  const decrypted = await decryptAttachment(encrypted);
  assert.deepEqual(Array.from(decrypted), Array.from(sampleAudioBytes));
});

