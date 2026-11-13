/**
 * Signal-style Encrypted Attachment Helper
 * Mirrors Signal-Desktop's ts/AttachmentCrypto.node.ts architecture:
 * - Random 256-bit AES key + 12-byte IV
 * - AES-256-GCM encrypted payload
 * - SHA-256 plaintextHash + HMAC-SHA-256 integrity digest verified in constant time
 */

import {
  concatBytes,
  constantTimeEqual,
  fromBase64,
  hmacSha256,
  toBase64,
} from './signalEngine';
import { buildVoiceFileName } from '../utils/voice';

const subtle = globalThis.crypto.subtle;

export interface EncryptedAttachmentPayload {
  fileName: string;
  mimeType: string;
  originalSize: number;
  ciphertextB64: string;
  ivB64: string;
  keyB64: string;
  macKeyB64: string;
  digestB64: string;
  plaintextHashB64: string;
}

export async function encryptAttachment(
  data: Uint8Array<ArrayBuffer>,
  fileName: string,
  mimeType: string
): Promise<EncryptedAttachmentPayload> {
  const aesKeyRaw = new Uint8Array(32);
  const macKeyRaw = new Uint8Array(32);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(aesKeyRaw);
  globalThis.crypto.getRandomValues(macKeyRaw);
  globalThis.crypto.getRandomValues(iv);

  const plaintextHash = new Uint8Array(await subtle.digest('SHA-256', data));

  const aesKey = await subtle.importKey(
    'raw',
    aesKeyRaw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, data)
  );

  const digest = await hmacSha256(macKeyRaw, concatBytes(iv, ciphertext));

  return {
    fileName,
    mimeType: mimeType || 'application/octet-stream',
    originalSize: data.length,
    ciphertextB64: toBase64(ciphertext),
    ivB64: toBase64(iv),
    keyB64: toBase64(aesKeyRaw),
    macKeyB64: toBase64(macKeyRaw),
    digestB64: toBase64(digest),
    plaintextHashB64: toBase64(plaintextHash),
  };
}

export async function encryptAudioBlob(
  audioBlob: Blob,
  options?: { durationSec?: number; fileName?: string }
): Promise<EncryptedAttachmentPayload> {
  const mimeType = audioBlob.type || 'audio/webm';
  const fileName =
    options?.fileName ??
    buildVoiceFileName(options?.durationSec ?? 1, mimeType);
  const buffer = await audioBlob.arrayBuffer();
  return encryptAttachment(new Uint8Array(buffer), fileName, mimeType);
}

export async function decryptAttachment(
  payload: EncryptedAttachmentPayload
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = fromBase64(payload.ivB64);
  const ciphertext = fromBase64(payload.ciphertextB64);
  const aesKeyRaw = fromBase64(payload.keyB64);
  const macKeyRaw = fromBase64(payload.macKeyB64);
  const expectedDigest = fromBase64(payload.digestB64);
  const expectedPlaintextHash = fromBase64(payload.plaintextHashB64);

  const computedDigest = await hmacSha256(macKeyRaw, concatBytes(iv, ciphertext));
  if (!constantTimeEqual(computedDigest, expectedDigest)) {
    throw new Error('Attachment integrity digest mismatch');
  }

  const aesKey = await subtle.importKey(
    'raw',
    aesKeyRaw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plaintext = new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      aesKey,
      ciphertext
    )
  );

  const actualPlaintextHash = new Uint8Array(
    await subtle.digest('SHA-256', plaintext)
  );
  if (!constantTimeEqual(actualPlaintextHash, expectedPlaintextHash)) {
    throw new Error('Attachment plaintext SHA-256 verification failed');
  }

  return plaintext;
}
