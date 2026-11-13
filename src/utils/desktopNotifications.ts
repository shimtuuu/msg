import type { PresenceState } from '../types/messenger';

export type DesktopNotificationPermission =
  | NotificationPermission
  | 'unsupported';

export interface NotificationEligibilityInput {
  permission: DesktopNotificationPermission;
  enabled: boolean;
  windowBlurred: boolean;
  isOwnMessage: boolean;
  isConversationMuted: boolean;
  presence: PresenceState;
}

export interface DesktopNotificationPayloadInput {
  conversationId: string;
  conversationKind: 'dm' | 'channel' | 'private';
  conversationName: string;
  senderName: string;
  messageId: string;
  text: string;
  attachmentFileName?: string;
}

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  tag: string;
  conversationId: string;
}

export function isWindowBlurred(state: {
  hasFocus: boolean;
  visibilityState: string;
}): boolean {
  return !state.hasFocus || state.visibilityState === 'hidden';
}

export function shouldTriggerDesktopNotification(
  input: NotificationEligibilityInput
): boolean {
  if (input.permission !== 'granted') return false;
  if (!input.enabled) return false;
  if (!input.windowBlurred) return false;
  if (input.isOwnMessage) return false;
  if (input.isConversationMuted) return false;
  if (input.presence === 'dnd') return false;
  return true;
}

export function truncateNotificationText(text: string, maxLen = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

export function buildDesktopNotificationPayload(
  input: DesktopNotificationPayloadInput
): DesktopNotificationPayload {
  const title =
    input.conversationKind === 'dm'
      ? input.senderName
      : `#${input.conversationName} · ${input.senderName}`;

  let rawBody = input.text.trim();
  if (input.attachmentFileName) {
    const isVoiceCaption = rawBody.startsWith('Голосовое сообщение');
    if (!isVoiceCaption) {
      rawBody = rawBody
        ? `${rawBody} (файл: ${input.attachmentFileName})`
        : `Файл: ${input.attachmentFileName}`;
    }
  }
  if (!rawBody) {
    rawBody = 'Новое зашифрованное сообщение';
  }

  return {
    title,
    body: truncateNotificationText(rawBody, 140),
    tag: `cm-${input.messageId}`,
    conversationId: input.conversationId,
  };
}

export function getNotificationPermissionState(): DesktopNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (window.Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export function showDesktopNotification(
  payload: DesktopNotificationPayload,
  onSelectConversation?: (conversationId: string) => void
): Notification | null {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }
  if (window.Notification.permission !== 'granted') {
    return null;
  }

  try {
    const notification = new window.Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore focus errors in restricted frames
      }
      onSelectConversation?.(payload.conversationId);
      notification.close();
    };
    window.setTimeout(() => {
      try {
        notification.close();
      } catch {
        // ignore close errors
      }
    }, 6000);
    return notification;
  } catch {
    return null;
  }
}
