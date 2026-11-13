/**
 * Signal-Protocol-inspired End-to-End Encryption Engine (Web Crypto API)
 * Works identically in modern browsers and Node.js (>= 20) without native bindings.
 *
 * Implements:
 * - Identity ECDH + ECDSA Keypairs & Signed PreKey verification
 * - X3DH-style 3-DH Key Agreement + HKDF-SHA-256 Root/Chain Key Derivation
 * - Double Ratchet (Symmetric HMAC-SHA-256 Chain Ratchet + Ephemeral DH Ratchet)
 * - Out-of-order skipped message key cache
 * - Signal-style logarithmic length padding (mitigates traffic-analysis length leaks)
 * - AES-256-GCM authenticated encryption with Envelope AAD binding
 * - Deterministic 60-digit Safety Number fingerprint (12 groups of 5 digits)
 */

const subtle = globalThis.crypto.subtle;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const MAX_SKIPPED_KEYS = 200;
const PADDING_BUCKETS = [64, 128, 256, 512, 1024, 2048, 4096, 8192];

export interface SerializedKeyPair {
  publicKeyB64: string;
  privateKeyJwk: JsonWebKey;
}

export interface IdentityBundle {
  userId: string;
  registrationId: number;
  identityKey: SerializedKeyPair; // ECDH P-256
  signingKey: SerializedKeyPair; // ECDSA P-256
  signedPreKey: SerializedKeyPair; // ECDH P-256
  signedPreKeySignatureB64: string;
  oneTimePreKey: SerializedKeyPair; // ECDH P-256
}

export interface PublicPreKeyBundle {
  userId: string;
  registrationId: number;
  identityPublicB64: string;
  signingPublicB64: string;
  signedPreKeyPublicB64: string;
  signedPreKeySignatureB64: string;
  oneTimePreKeyPublicB64?: string;
}

export interface RatchetSession {
  peerId: string;
  rootKeyB64: string;
  sendChainKeyB64: string;
  recvChainKeyB64: string;
  dhSelfPublicB64: string;
  dhSelfPrivateJwk: JsonWebKey;
  dhRemotePublicB64: string;
  sendCount: number;
  recvCount: number;
  prevSendCount: number;
  skippedKeys: Record<string, string>; // `${dhPub}:${index}` -> messageKeyB64
  remoteIdentityPublicB64: string;
  establishedAt: number;
}

export interface EncryptedEnvelope {
  id: string;
  senderId: string;
  receiverId: string;
  dhPublicB64: string;
  counter: number;
  prevCounter: number;
  ivB64: string;
  ciphertextB64: string;
  plaintextByteLength: number;
  paddedByteLength: number;
  timestamp: number;
  ephemeralFlag?: boolean;
  threadRootId?: string;
  replyToId?: string;
}

// ---------- Byte & Base64 Utilities ----------

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    const out = new Uint8Array(buf.length);
    out.set(buf);
    return out;
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ---------- Signal-Style Padding (Traffic Analysis Mitigation) ----------

export function getPaddedBucketSize(rawLength: number): number {
  const needed = rawLength + 4; // 4-byte uint32 length header
  for (const bucket of PADDING_BUCKETS) {
    if (needed <= bucket) return bucket;
  }
  return Math.ceil(needed / 1024) * 1024;
}

export function padPlaintext(plaintext: Uint8Array): Uint8Array<ArrayBuffer> {
  const targetSize = getPaddedBucketSize(plaintext.length);
  const out = new Uint8Array(targetSize);
  // Write 4-byte big-endian plaintext length
  const view = new DataView(out.buffer);
  view.setUint32(0, plaintext.length, false);
  out.set(plaintext, 4);
  // Fill remaining padding with random bytes
  if (targetSize > 4 + plaintext.length) {
    const padSlice = out.subarray(4 + plaintext.length);
    globalThis.crypto.getRandomValues(padSlice);
  }
  return out;
}

export function unpadPlaintext(padded: Uint8Array): Uint8Array<ArrayBuffer> {
  if (padded.length < 4) {
    throw new Error('Invalid padded payload: too short');
  }
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const length = view.getUint32(0, false);
  if (4 + length > padded.length) {
    throw new Error('Invalid padded payload: corrupted length header');
  }
  const out = new Uint8Array(length);
  out.set(padded.subarray(4, 4 + length));
  return out;
}

// ---------- Curve & Key Generation (ECDH / ECDSA P-256) ----------

export async function generateEcdhKeyPair(): Promise<SerializedKeyPair> {
  const pair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const rawPub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const privJwk = await subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKeyB64: toBase64(rawPub),
    privateKeyJwk: privJwk,
  };
}

export async function generateSigningKeyPair(): Promise<SerializedKeyPair> {
  const pair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const rawPub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const privJwk = await subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKeyB64: toBase64(rawPub),
    privateKeyJwk: privJwk,
  };
}

async function importEcdhPublic(publicB64: string): Promise<CryptoKey> {
  return subtle.importKey(
    'raw',
    fromBase64(publicB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

async function importEcdhPrivate(privateJwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
}

export async function calculateAgreement(
  privateJwk: JsonWebKey,
  remotePublicB64: string
): Promise<Uint8Array<ArrayBuffer>> {
  const [privKey, pubKey] = await Promise.all([
    importEcdhPrivate(privateJwk),
    importEcdhPublic(remotePublicB64),
  ]);
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: pubKey },
    privKey,
    256
  );
  return new Uint8Array(bits);
}

// ---------- HKDF & HMAC-SHA-256 KDF (Mirrors Signal Crypto.node.ts) ----------

export async function hkdfDeriveSecrets(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  infoStr: string
): Promise<[Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>]> {
  const baseKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const derived = new Uint8Array(
    await subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: textEncoder.encode(infoStr),
      },
      baseKey,
      96 * 8 // 3 * 32 bytes
    )
  );
  return [
    derived.slice(0, 32),
    derived.slice(32, 64),
    derived.slice(64, 96),
  ];
}

export async function hmacSha256(
  keyBytes: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

/**
 * Advances symmetric chain key one step forward.
 * Produces a 32-byte one-time Message Key and the next 32-byte Chain Key.
 */
export async function ratchetChainKey(
  chainKeyB64: string
): Promise<{ messageKeyB64: string; nextChainKeyB64: string }> {
  const ck = fromBase64(chainKeyB64);
  const [messageKey, nextChainKey] = await Promise.all([
    hmacSha256(ck, new Uint8Array([0x01])),
    hmacSha256(ck, new Uint8Array([0x02])),
  ]);
  return {
    messageKeyB64: toBase64(messageKey),
    nextChainKeyB64: toBase64(nextChainKey),
  };
}

/**
 * Root DH Ratchet KDF step: mixes Root Key + new ECDH output into (newRootKey, newChainKey).
 */
async function kdfRootKey(
  rootKeyB64: string,
  dhOutput: Uint8Array<ArrayBuffer>
): Promise<{ nextRootKeyB64: string; chainKeyB64: string }> {
  const salt = fromBase64(rootKeyB64);
  const [nextRoot, chainKey] = await hkdfDeriveSecrets(
    dhOutput,
    salt,
    'CipherLine-DoubleRatchet-v1'
  );
  return {
    nextRootKeyB64: toBase64(nextRoot),
    chainKeyB64: toBase64(chainKey),
  };
}

// ---------- Identity Bundle & Signed PreKey Verification ----------

export function generateRegistrationId(): number {
  const arr = new Uint16Array(1);
  globalThis.crypto.getRandomValues(arr);
  return (arr[0] % 16382) + 1;
}

export async function generateIdentityBundle(userId: string): Promise<IdentityBundle> {
  const [identityKey, signingKey, signedPreKey, oneTimePreKey] = await Promise.all([
    generateEcdhKeyPair(),
    generateSigningKeyPair(),
    generateEcdhKeyPair(),
    generateEcdhKeyPair(),
  ]);

  const signingPriv = await subtle.importKey(
    'jwk',
    signingKey.privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sigBuf = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingPriv,
    fromBase64(signedPreKey.publicKeyB64)
  );

  return {
    userId,
    registrationId: generateRegistrationId(),
    identityKey,
    signingKey,
    signedPreKey,
    signedPreKeySignatureB64: toBase64(new Uint8Array(sigBuf)),
    oneTimePreKey,
  };
}

export function extractPublicPreKeyBundle(bundle: IdentityBundle): PublicPreKeyBundle {
  return {
    userId: bundle.userId,
    registrationId: bundle.registrationId,
    identityPublicB64: bundle.identityKey.publicKeyB64,
    signingPublicB64: bundle.signingKey.publicKeyB64,
    signedPreKeyPublicB64: bundle.signedPreKey.publicKeyB64,
    signedPreKeySignatureB64: bundle.signedPreKeySignatureB64,
    oneTimePreKeyPublicB64: bundle.oneTimePreKey.publicKeyB64,
  };
}

export async function verifySignedPreKey(bundle: PublicPreKeyBundle): Promise<boolean> {
  try {
    const verifyKey = await subtle.importKey(
      'raw',
      fromBase64(bundle.signingPublicB64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    return await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      fromBase64(bundle.signedPreKeySignatureB64),
      fromBase64(bundle.signedPreKeyPublicB64)
    );
  } catch {
    return false;
  }
}

// ---------- X3DH Session Establishment ----------

export async function establishSessionAsInitiator(
  localBundle: IdentityBundle,
  remoteBundle: PublicPreKeyBundle
): Promise<{ session: RatchetSession; ephemeralPublicB64: string }> {
  const validSig = await verifySignedPreKey(remoteBundle);
  if (!validSig) {
    throw new Error(`Signed PreKey verification failed for peer ${remoteBundle.userId}`);
  }

  const ephemeral = await generateEcdhKeyPair();

  // X3DH 3-DH (+ optional 4th DH with One-Time PreKey)
  const dh1 = await calculateAgreement(
    localBundle.identityKey.privateKeyJwk,
    remoteBundle.signedPreKeyPublicB64
  );
  const dh2 = await calculateAgreement(
    ephemeral.privateKeyJwk,
    remoteBundle.identityPublicB64
  );
  const dh3 = await calculateAgreement(
    ephemeral.privateKeyJwk,
    remoteBundle.signedPreKeyPublicB64
  );
  const dhParts: Uint8Array[] = [dh1, dh2, dh3];
  if (remoteBundle.oneTimePreKeyPublicB64) {
    const dh4 = await calculateAgreement(
      ephemeral.privateKeyJwk,
      remoteBundle.oneTimePreKeyPublicB64
    );
    dhParts.push(dh4);
  }

  const ikm = concatBytes(...dhParts);
  const salt = new Uint8Array(32);
  const [sharedSecret, fallbackRecvChain] = await hkdfDeriveSecrets(
    ikm,
    salt,
    'CipherLine-X3DH-v1'
  );

  // Initiator initializes sending DH ratchet step against remote Signed PreKey
  const dhSelf = await generateEcdhKeyPair();
  const dhOut = await calculateAgreement(
    dhSelf.privateKeyJwk,
    remoteBundle.signedPreKeyPublicB64
  );
  const { nextRootKeyB64, chainKeyB64 } = await kdfRootKey(
    toBase64(sharedSecret),
    dhOut
  );

  return {
    ephemeralPublicB64: ephemeral.publicKeyB64,
    session: {
      peerId: remoteBundle.userId,
      rootKeyB64: nextRootKeyB64,
      sendChainKeyB64: chainKeyB64,
      recvChainKeyB64: toBase64(fallbackRecvChain),
      dhSelfPublicB64: dhSelf.publicKeyB64,
      dhSelfPrivateJwk: dhSelf.privateKeyJwk,
      dhRemotePublicB64: remoteBundle.signedPreKeyPublicB64,
      sendCount: 0,
      recvCount: 0,
      prevSendCount: 0,
      skippedKeys: {},
      remoteIdentityPublicB64: remoteBundle.identityPublicB64,
      establishedAt: Date.now(),
    },
  };
}

export async function establishSessionAsResponder(
  localBundle: IdentityBundle,
  remoteBundle: PublicPreKeyBundle,
  initiatorEphemeralPublicB64: string
): Promise<RatchetSession> {
  const validSig = await verifySignedPreKey(remoteBundle);
  if (!validSig) {
    throw new Error(`Signed PreKey verification failed for peer ${remoteBundle.userId}`);
  }

  // Mirror of initiator's 3-DH (+ 4th DH if OPK present)
  const dh1 = await calculateAgreement(
    localBundle.signedPreKey.privateKeyJwk,
    remoteBundle.identityPublicB64
  );
  const dh2 = await calculateAgreement(
    localBundle.identityKey.privateKeyJwk,
    initiatorEphemeralPublicB64
  );
  const dh3 = await calculateAgreement(
    localBundle.signedPreKey.privateKeyJwk,
    initiatorEphemeralPublicB64
  );
  const dhParts: Uint8Array[] = [dh1, dh2, dh3];
  if (remoteBundle.oneTimePreKeyPublicB64) {
    const dh4 = await calculateAgreement(
      localBundle.oneTimePreKey.privateKeyJwk,
      initiatorEphemeralPublicB64
    );
    dhParts.push(dh4);
  }

  const ikm = concatBytes(...dhParts);
  const salt = new Uint8Array(32);
  const [sharedSecret, fallbackSendChain] = await hkdfDeriveSecrets(
    ikm,
    salt,
    'CipherLine-X3DH-v1'
  );

  // dhRemotePublicB64 starts empty so initiator's first message triggers Bob's DH ratchet step
  return {
    peerId: remoteBundle.userId,
    rootKeyB64: toBase64(sharedSecret),
    sendChainKeyB64: toBase64(fallbackSendChain),
    recvChainKeyB64: '',
    dhSelfPublicB64: localBundle.signedPreKey.publicKeyB64,
    dhSelfPrivateJwk: localBundle.signedPreKey.privateKeyJwk,
    dhRemotePublicB64: '',
    sendCount: 0,
    recvCount: 0,
    prevSendCount: 0,
    skippedKeys: {},
    remoteIdentityPublicB64: remoteBundle.identityPublicB64,
    establishedAt: Date.now(),
  };
}

// ---------- AES-256-GCM Authenticated Encryption ----------

function buildEnvelopeAad(
  senderId: string,
  receiverId: string,
  dhPublicB64: string,
  counter: number,
  threadRootId?: string
): Uint8Array<ArrayBuffer> {
  const base = `${senderId}|${receiverId}|${dhPublicB64}|${counter}`;
  return textEncoder.encode(threadRootId ? `${base}|thread:${threadRootId}` : base);
}

async function aesGcmEncrypt(
  keyB64: string,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>
): Promise<{ ivB64: string; ciphertextB64: string }> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const cryptoKey = await subtle.importKey(
    'raw',
    fromBase64(keyB64),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    cryptoKey,
    plaintext
  );
  return {
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(ct)),
  };
}

async function aesGcmDecrypt(
  keyB64: string,
  ivB64: string,
  ciphertextB64: string,
  aad: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await subtle.importKey(
    'raw',
    fromBase64(keyB64),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64), additionalData: aad, tagLength: 128 },
    cryptoKey,
    fromBase64(ciphertextB64)
  );
  return new Uint8Array(pt);
}

// ---------- Double Ratchet Encrypt / Decrypt ----------

export async function encryptMessage(
  session: RatchetSession,
  senderId: string,
  plaintext: string,
  options?: {
    id?: string;
    stepDhRatchet?: boolean;
    threadRootId?: string;
    replyToId?: string;
  }
): Promise<{ envelope: EncryptedEnvelope; nextSession: RatchetSession }> {
  let workingSession = { ...session };

  if (options?.stepDhRatchet) {
    const newDh = await generateEcdhKeyPair();
    const dhOut = await calculateAgreement(
      newDh.privateKeyJwk,
      workingSession.dhRemotePublicB64
    );
    const { nextRootKeyB64, chainKeyB64 } = await kdfRootKey(
      workingSession.rootKeyB64,
      dhOut
    );
    workingSession = {
      ...workingSession,
      rootKeyB64: nextRootKeyB64,
      sendChainKeyB64: chainKeyB64,
      dhSelfPublicB64: newDh.publicKeyB64,
      dhSelfPrivateJwk: newDh.privateKeyJwk,
      prevSendCount: workingSession.sendCount,
      sendCount: 0,
    };
  }

  const { messageKeyB64, nextChainKeyB64 } = await ratchetChainKey(
    workingSession.sendChainKeyB64
  );
  const counter = workingSession.sendCount;

  const rawBytes = textEncoder.encode(plaintext);
  const padded = padPlaintext(rawBytes);
  const aad = buildEnvelopeAad(
    senderId,
    workingSession.peerId,
    workingSession.dhSelfPublicB64,
    counter,
    options?.threadRootId
  );

  const { ivB64, ciphertextB64 } = await aesGcmEncrypt(messageKeyB64, padded, aad);

  const envelope: EncryptedEnvelope = {
    id:
      options?.id ??
      `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    senderId,
    receiverId: workingSession.peerId,
    dhPublicB64: workingSession.dhSelfPublicB64,
    counter,
    prevCounter: workingSession.prevSendCount,
    ivB64,
    ciphertextB64,
    plaintextByteLength: rawBytes.length,
    paddedByteLength: padded.length,
    timestamp: Date.now(),
    ...(options?.threadRootId ? { threadRootId: options.threadRootId } : {}),
    ...(options?.replyToId ? { replyToId: options.replyToId } : {}),
  };

  return {
    envelope,
    nextSession: {
      ...workingSession,
      sendChainKeyB64: nextChainKeyB64,
      sendCount: counter + 1,
    },
  };
}

export async function decryptMessage(
  session: RatchetSession,
  envelope: EncryptedEnvelope
): Promise<{ plaintext: string; nextSession: RatchetSession }> {
  const skipped = { ...session.skippedKeys };
  const skipId = `${envelope.dhPublicB64}:${envelope.counter}`;
  const aad = buildEnvelopeAad(
    envelope.senderId,
    envelope.receiverId,
    envelope.dhPublicB64,
    envelope.counter,
    envelope.threadRootId
  );

  // 1. Check skipped message keys cache for out-of-order messages
  if (skipped[skipId]) {
    const mk = skipped[skipId];
    delete skipped[skipId];
    const padded = await aesGcmDecrypt(mk, envelope.ivB64, envelope.ciphertextB64, aad);
    const raw = unpadPlaintext(padded);
    return {
      plaintext: textDecoder.decode(raw),
      nextSession: { ...session, skippedKeys: skipped },
    };
  }

  let working: RatchetSession = { ...session, skippedKeys: skipped };

  // 2. If sender rotated DH ephemeral key, advance DH ratchet
  if (envelope.dhPublicB64 !== working.dhRemotePublicB64) {
    // Store remaining skipped keys in previous receiving chain
    if (working.recvChainKeyB64) {
      let prevRecvChain = working.recvChainKeyB64;
      let prevIdx = working.recvCount;
      while (prevIdx < envelope.prevCounter) {
        if (Object.keys(working.skippedKeys).length >= MAX_SKIPPED_KEYS) break;
        const stepped = await ratchetChainKey(prevRecvChain);
        working.skippedKeys[`${working.dhRemotePublicB64}:${prevIdx}`] =
          stepped.messageKeyB64;
        prevRecvChain = stepped.nextChainKeyB64;
        prevIdx += 1;
      }
    }

    // Receive DH ratchet step
    const dhRecv = await calculateAgreement(
      working.dhSelfPrivateJwk,
      envelope.dhPublicB64
    );
    const recvKdf = await kdfRootKey(working.rootKeyB64, dhRecv);

    // Generate fresh self DH keypair & advance send ratchet
    const nextSelfDh = await generateEcdhKeyPair();
    const dhSend = await calculateAgreement(
      nextSelfDh.privateKeyJwk,
      envelope.dhPublicB64
    );
    const sendKdf = await kdfRootKey(recvKdf.nextRootKeyB64, dhSend);

    working = {
      ...working,
      rootKeyB64: sendKdf.nextRootKeyB64,
      recvChainKeyB64: recvKdf.chainKeyB64,
      sendChainKeyB64: sendKdf.chainKeyB64,
      dhRemotePublicB64: envelope.dhPublicB64,
      dhSelfPublicB64: nextSelfDh.publicKeyB64,
      dhSelfPrivateJwk: nextSelfDh.privateKeyJwk,
      prevSendCount: working.sendCount,
      sendCount: 0,
      recvCount: 0,
    };
  }

  // 3. Skip ahead if messages arrived out-of-order in current chain
  let recvChain = working.recvChainKeyB64;
  let recvCounter = working.recvCount;

  if (envelope.counter < recvCounter) {
    throw new Error(
      `Replay or stale counter detected (received ${envelope.counter}, expected >= ${recvCounter})`
    );
  }
  if (envelope.counter - recvCounter > MAX_SKIPPED_KEYS) {
    throw new Error('Skipped message count exceeded security window');
  }

  while (recvCounter < envelope.counter) {
    const stepped = await ratchetChainKey(recvChain);
    working.skippedKeys[`${working.dhRemotePublicB64}:${recvCounter}`] =
      stepped.messageKeyB64;
    recvChain = stepped.nextChainKeyB64;
    recvCounter += 1;
  }

  // 4. Derive target message key
  const { messageKeyB64, nextChainKeyB64 } = await ratchetChainKey(recvChain);
  const padded = await aesGcmDecrypt(
    messageKeyB64,
    envelope.ivB64,
    envelope.ciphertextB64,
    aad
  );
  const raw = unpadPlaintext(padded);

  return {
    plaintext: textDecoder.decode(raw),
    nextSession: {
      ...working,
      recvChainKeyB64: nextChainKeyB64,
      recvCount: recvCounter + 1,
    },
  };
}

// ---------- Signal 60-Digit Safety Number Fingerprint ----------

async function hashFingerprintChunk(
  userId: string,
  identityPublicB64: string,
  iterations = 512
): Promise<string> {
  const idBytes = textEncoder.encode(userId);
  const keyBytes = fromBase64(identityPublicB64);
  let digest = new Uint8Array(
    await subtle.digest('SHA-512', concatBytes(new Uint8Array([0, 0]), keyBytes, idBytes))
  );
  for (let i = 1; i < iterations; i++) {
    digest = new Uint8Array(
      await subtle.digest('SHA-512', concatBytes(digest, keyBytes))
    );
  }
  // Extract 30 digits (6 groups of 5 digits) using 5-byte modulo chunks
  let digits = '';
  for (let offset = 0; offset < 30; offset += 5) {
    const num =
      (digest[offset] * 2 ** 32 +
        digest[offset + 1] * 2 ** 24 +
        digest[offset + 2] * 2 ** 16 +
        digest[offset + 3] * 2 ** 8 +
        digest[offset + 4]) %
      100000;
    digits += num.toString().padStart(5, '0');
  }
  return digits;
}

/**
 * Computes Signal-compatible 60-digit Safety Number (12 groups of 5 digits).
 * Symmetric: computeSafetyNumber(A, B) === computeSafetyNumber(B, A).
 */
export async function computeSafetyNumber(
  localUserId: string,
  localIdentityPublicB64: string,
  remoteUserId: string,
  remoteIdentityPublicB64: string
): Promise<string[]> {
  const [localHalf, remoteHalf] = await Promise.all([
    hashFingerprintChunk(localUserId, localIdentityPublicB64),
    hashFingerprintChunk(remoteUserId, remoteIdentityPublicB64),
  ]);

  // Lexicographically sort halves so both participants see identical 60 digits
  const combined =
    localHalf <= remoteHalf ? localHalf + remoteHalf : remoteHalf + localHalf;

  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) {
    groups.push(combined.slice(i, i + 5));
  }
  return groups;
}
