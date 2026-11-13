import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesktopNotificationPayload,
  isWindowBlurred,
  shouldTriggerDesktopNotification,
  truncateNotificationText,
} from './desktopNotifications';

test('isWindowBlurred returns true when document lacks focus or tab is hidden', () => {
  assert.equal(isWindowBlurred({ hasFocus: true, visibilityState: 'visible' }), false);
  assert.equal(isWindowBlurred({ hasFocus: false, visibilityState: 'visible' }), true);
  assert.equal(isWindowBlurred({ hasFocus: true, visibilityState: 'hidden' }), true);
  assert.equal(isWindowBlurred({ hasFocus: false, visibilityState: 'hidden' }), true);
});

test('shouldTriggerDesktopNotification enforces permission, blur, mute, DND, and sender rules', () => {
  const base = {
    permission: 'granted' as const,
    enabled: true,
    windowBlurred: true,
    isOwnMessage: false,
    isConversationMuted: false,
    presence: 'online' as const,
  };

  assert.equal(shouldTriggerDesktopNotification(base), true);
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, windowBlurred: false }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, permission: 'default' }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, permission: 'denied' }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, enabled: false }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, isOwnMessage: true }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, isConversationMuted: true }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, presence: 'dnd' }),
    false
  );
  assert.equal(
    shouldTriggerDesktopNotification({ ...base, presence: 'away' }),
    true
  );
});

test('buildDesktopNotificationPayload formats DM and channel notifications cleanly', () => {
  const dm = buildDesktopNotificationPayload({
    conversationId: 'emp-alexey',
    conversationKind: 'dm',
    conversationName: 'Алексей Петров',
    senderName: 'Алексей Петров',
    messageId: 'm1',
    text: 'Проверь новый релиз',
  });
  assert.equal(dm.title, 'Алексей Петров');
  assert.equal(dm.body, 'Проверь новый релиз');
  assert.equal(dm.tag, 'cm-m1');
  assert.equal(dm.conversationId, 'emp-alexey');

  const group = buildDesktopNotificationPayload({
    conversationId: 'room-general',
    conversationKind: 'channel',
    conversationName: 'general',
    senderName: 'Елена Соколова',
    messageId: 'm2',
    text: 'Документ загружен',
    attachmentFileName: 'audit.pdf',
  });
  assert.equal(group.title, '#general · Елена Соколова');
  assert.equal(group.body, 'Документ загружен (файл: audit.pdf)');

  const voice = buildDesktopNotificationPayload({
    conversationId: 'room-general',
    conversationKind: 'channel',
    conversationName: 'general',
    senderName: 'Марк Волков',
    messageId: 'm3',
    text: 'Голосовое сообщение (0:12)',
    attachmentFileName: 'voice.webm',
  });
  assert.equal(voice.body, 'Голосовое сообщение (0:12)');
});

test('truncateNotificationText collapses whitespace and truncates long strings cleanly', () => {
  const long = 'А'.repeat(160);
  const res = truncateNotificationText(long, 140);
  assert.equal(res.length, 140);
  assert.ok(res.endsWith('…'));
});
