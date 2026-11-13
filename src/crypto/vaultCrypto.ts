import {
  fromBase64,
  toBase64,
  type IdentityBundle,
} from './signalEngine';
import type { ChatMessage } from '../types/messenger';

const subtle = globalThis.crypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface EncryptedVaultRecord {
  messageId: string;
  conversationId: string;
  timestamp: number;
  expiresAt?: number;
  ivB64: string;
  ciphertextB64: string;
}

export async function deriveVaultKey(bundle: IdentityBundle): Promise<CryptoKey> {
  const material = `${bundle.userId}|${bundle.identityKey.publicKeyB64}|${bundle.identityKey.privateKeyJwk.d ?? ''}`;
  const hash = await subtle.digest('SHA-256', textEncoder.encode(material));
  return subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptVaultMessage(
  vaultKey: CryptoKey,
  message: ChatMessage
): Promise<EncryptedVaultRecord> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const aad = textEncoder.encode(
    `vault:${message.id}:${message.conversationId}`
  );
  const payload = textEncoder.encode(JSON.stringify(message));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    vaultKey,
    payload
  );
  return {
    messageId: message.id,
    conversationId: message.conversationId,
    timestamp: message.timestamp,
    expiresAt: message.expiresAt,
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(ct)),
  };
}

export async function decryptVaultMessage(
  vaultKey: CryptoKey,
  record: EncryptedVaultRecord
): Promise<ChatMessage | null> {
  try {
    const aad = textEncoder.encode(
      `vault:${record.messageId}:${record.conversationId}`
    );
    const pt = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(record.ivB64),
        additionalData: aad,
        tagLength: 128,
      },
      vaultKey,
      fromBase64(record.ciphertextB64)
    );
    return JSON.parse(textDecoder.decode(new Uint8Array(pt))) as ChatMessage;
  } catch {
    return null;
  }
}
