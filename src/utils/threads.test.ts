import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../types/messenger';
import { formatThreadReplyCount, partitionThreadMessages } from './threads';

function makeMsg(
  id: string,
  senderName: string,
  text: string,
  timestamp: number,
  threadRootId?: string
): ChatMessage {
  return {
    id,
    conversationId: 'room-general',
    kind: 'group',
    senderId: senderName.toLowerCase(),
    senderName,
    text,
    timestamp,
    status: 'read',
    threadRootId,
  };
}

test('partitionThreadMessages separates top-level messages from nested thread replies', () => {
  const messages: ChatMessage[] = [
    makeMsg('root-1', 'Елена', 'Корневое сообщение', 1000),
    makeMsg('reply-1', 'Марк', 'Первый ответ в треде', 2000, 'root-1'),
    makeMsg('root-2', 'Алексей', 'Другое сообщение в основном канале', 2500),
    makeMsg('reply-2', 'Анна', 'Второй ответ в треде', 3000, 'root-1'),
  ];

  const { mainMessages, repliesByRoot, threadSummaries } =
    partitionThreadMessages(messages);

  assert.deepEqual(
    mainMessages.map((m) => m.id),
    ['root-1', 'root-2']
  );
  assert.equal(repliesByRoot['root-1'].length, 2);
  assert.equal(repliesByRoot['root-2'], undefined);

  const summary = threadSummaries['root-1'];
  assert.ok(summary);
  assert.equal(summary.replyCount, 2);
  assert.equal(summary.lastReplyAt, 3000);
  assert.equal(summary.lastReplySender, 'Анна');
  assert.equal(summary.lastReplyText, 'Второй ответ в треде');
  assert.deepEqual(summary.participantNames, ['Марк', 'Анна']);
});

test('formatThreadReplyCount handles Russian plural rules cleanly', () => {
  assert.equal(formatThreadReplyCount(1), '1 ответ');
  assert.equal(formatThreadReplyCount(2), '2 ответа');
  assert.equal(formatThreadReplyCount(4), '4 ответа');
  assert.equal(formatThreadReplyCount(5), '5 ответов');
  assert.equal(formatThreadReplyCount(11), '11 ответов');
  assert.equal(formatThreadReplyCount(21), '21 ответ');
});
