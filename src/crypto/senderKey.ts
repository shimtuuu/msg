/**
 * Signal-style Group Sender Keys Engine (for E2EE Channels / Rooms)
 * Uses Web Crypto API (ECDH key wrapping, ECDSA P-256 sender authentication,
 * HMAC-SHA-256 forward-secret chain ratchet, and AES-256-GCM).
 */

import {
  calculateAgreement,
  concatBytes,
  fromBase64,
  generateSigningKeyPair,
  hkdfDeriveSecrets,
  padPlaintext,
  ratchetChainKey,
  toBase64,
  unpadPlaintext,
  type IdentityBundle,
} from './signalEngine';

const subtle = globalThis.crypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const MAX_GROUP_SKIP = 200;

export interface SenderKeyState {
  roomId: string;
  senderId: string;
  keyId: number;
  iteration: number;
  chainKeyB64: string;
  signingPublicB64: string;
  signingPrivateJwk?: JsonWebKey;
  skippedKeys: Record<number, string>;
}

export interface SenderKeyDistribution {
  roomId: string;
  senderId: string;
  keyId: number;
  iteration: number;
  chainKeyB64: string;
  signingPublicB64: string;
}

export interface EncryptedGroupEnvelope {
  id: string;
  roomId: string;
  senderId: string;
  keyId: number;
  iteration: number;
  ivB64: string;
  ciphertextB64: string;
  signatureB64: string;
  plaintextByteLength: number;
  paddedByteLength: number;
  timestamp: number;
  replyToId?: string;
  threadRootId?: string;
}

export async function createSenderKeyState(
  roomId: string,
  senderId: string
): Promise<SenderKeyState> {
  const chainKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(chainKey);
  const signing = await generateSigningKeyPair();
  const idArr = new Uint32Array(1);
  globalThis.crypto.getRandomValues(idArr);

  return {
    roomId,
    senderId,
    keyId: idArr[0] || 1,
    iteration: 0,
    chainKeyB64: toBase64(chainKey),
    signingPublicB64: signing.publicKeyB64,
    signingPrivateJwk: signing.privateKeyJwk,
    skippedKeys: {},
  };
}

export function exportSenderKeyDistribution(
  state: SenderKeyState
): SenderKeyDistribution {
  return {
    roomId: state.roomId,
    senderId: state.senderId,
    keyId: state.keyId,
    iteration: state.iteration,
    chainKeyB64: state.chainKeyB64,
    signingPublicB64: state.signingPublicB64,
  };
}

export function importSenderKeyDistribution(
  dist: SenderKeyDistribution
): SenderKeyState {
  return {
    roomId: dist.roomId,
    senderId: dist.senderId,
    keyId: dist.keyId,
    iteration: dist.iteration,
    chainKeyB64: dist.chainKeyB64,
    signingPublicB64: dist.signingPublicB64,
    skippedKeys: {},
  };
}

/**
 * Wraps a SenderKeyDistribution for a specific peer using ECDH(localIdentity, peerIdentity).
 */
export async function wrapSenderKeyForPeer(
  dist: SenderKeyDistribution,
  localBundle: IdentityBundle,
  peerIdentityPublicB64: string
): Promise<{ ivB64: string; wrappedB64: string }> {
  const shared = await calculateAgreement(
    localBundle.identityKey.privateKeyJwk,
    peerIdentityPublicB64
  );
  const [wrapKey] = await hkdfDeriveSecrets(
    shared,
    new Uint8Array(32),
    'CipherLine-SenderKeyWrap-v1'
  );
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const cryptoKey = await subtle.importKey(
    'raw',
    wrapKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    textEncoder.encode(JSON.stringify(dist))
  );
  return { ivB64: toBase64(iv), wrappedB64: toBase64(new Uint8Array(ct)) };
}

export async function unwrapSenderKeyFromPeer(
  wrapped: { ivB64: string; wrappedB64: string },
  localBundle: IdentityBundle,
  peerIdentityPublicB64: string
): Promise<SenderKeyDistribution> {
  const shared = await calculateAgreement(
    localBundle.identityKey.privateKeyJwk,
    peerIdentityPublicB64
  );
  const [wrapKey] = await hkdfDeriveSecrets(
    shared,
    new Uint8Array(32),
    'CipherLine-SenderKeyWrap-v1'
  );
  const cryptoKey = await subtle.importKey(
    'raw',
    wrapKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.ivB64), tagLength: 128 },
    cryptoKey,
    fromBase64(wrapped.wrappedB64)
  );
  return JSON.parse(textDecoder.decode(new Uint8Array(pt))) as SenderKeyDistribution;
}

function buildGroupAad(
  roomId: string,
  senderId: string,
  keyId: number,
  iteration: number,
  threadRootId?: string
): Uint8Array<ArrayBuffer> {
  const base = `${roomId}|${senderId}|${keyId}|${iteration}`;
  return textEncoder.encode(threadRootId ? `${base}|thread:${threadRootId}` : base);
}

export async function encryptGroupMessage(
  state: SenderKeyState,
  plaintext: string,
  options?: { id?: string; replyToId?: string; threadRootId?: string }
): Promise<{ envelope: EncryptedGroupEnvelope; nextState: SenderKeyState }> {
  if (!state.signingPrivateJwk) {
    throw new Error('Cannot encrypt group message without signing private key');
  }

  const { messageKeyB64, nextChainKeyB64 } = await ratchetChainKey(
    state.chainKeyB64
  );
  const iteration = state.iteration;
  const rawBytes = textEncoder.encode(plaintext);
  const padded = padPlaintext(rawBytes);

  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const aad = buildGroupAad(
    state.roomId,
    state.senderId,
    state.keyId,
    iteration,
    options?.threadRootId
  );

  const aesKey = await subtle.importKey(
    'raw',
    fromBase64(messageKeyB64),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      aesKey,
      padded
    )
  );

  // Sign iv || ciphertext with SenderKey ECDSA private key
  const signingPriv = await subtle.importKey(
    'jwk',
    state.signingPrivateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sigBuf = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingPriv,
    concatBytes(iv, ct)
  );

  const envelope: EncryptedGroupEnvelope = {
    id:
      options?.id ??
      `gmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    roomId: state.roomId,
    senderId: state.senderId,
    keyId: state.keyId,
    iteration,
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(ct),
    signatureB64: toBase64(new Uint8Array(sigBuf)),
    plaintextByteLength: rawBytes.length,
    paddedByteLength: padded.length,
    timestamp: Date.now(),
    replyToId: options?.replyToId,
    ...(options?.threadRootId ? { threadRootId: options.threadRootId } : {}),
  };

  return {
    envelope,
    nextState: {
      ...state,
      chainKeyB64: nextChainKeyB64,
      iteration: iteration + 1,
    },
  };
}

export async function decryptGroupMessage(
  state: SenderKeyState,
  envelope: EncryptedGroupEnvelope
): Promise<{ plaintext: string; nextState: SenderKeyState }> {
  if (envelope.keyId !== state.keyId || envelope.roomId !== state.roomId) {
    throw new Error('SenderKey keyId/roomId mismatch');
  }

  const iv = fromBase64(envelope.ivB64);
  const ct = fromBase64(envelope.ciphertextB64);
  const sig = fromBase64(envelope.signatureB64);

  const verifyKey = await subtle.importKey(
    'raw',
    fromBase64(state.signingPublicB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const validSig = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    sig,
    concatBytes(iv, ct)
  );
  if (!validSig) {
    throw new Error('Invalid SenderKey ECDSA signature');
  }

  const aad = buildGroupAad(
    envelope.roomId,
    envelope.senderId,
    envelope.keyId,
    envelope.iteration,
    envelope.threadRootId
  );
  const skipped = { ...state.skippedKeys };

  let messageKeyB64: string;
  let nextChainKeyB64 = state.chainKeyB64;
  let nextIteration = state.iteration;

  if (skipped[envelope.iteration]) {
    messageKeyB64 = skipped[envelope.iteration];
    delete skipped[envelope.iteration];
  } else {
    if (envelope.iteration < state.iteration) {
      throw new Error('Replay or stale SenderKey iteration');
    }
    if (envelope.iteration - state.iteration > MAX_GROUP_SKIP) {
      throw new Error('SenderKey skip window exceeded');
    }

    let ck = state.chainKeyB64;
    let iter = state.iteration;
    while (iter < envelope.iteration) {
      const stepped = await ratchetChainKey(ck);
      skipped[iter] = stepped.messageKeyB64;
      ck = stepped.nextChainKeyB64;
      iter += 1;
    }
    const target = await ratchetChainKey(ck);
    messageKeyB64 = target.messageKeyB64;
    nextChainKeyB64 = target.nextChainKeyB64;
    nextIteration = iter + 1;
  }

  const aesKey = await subtle.importKey(
    'raw',
    fromBase64(messageKeyB64),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const padded = new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      aesKey,
      ct
    )
  );
  const raw = unpadPlaintext(padded);

  return {
    plaintext: textDecoder.decode(raw),
    nextState: {
      ...state,
      chainKeyB64: nextChainKeyB64,
      iteration: nextIteration,
      skippedKeys: skipped,
    },
  };
}
