import type { ChatMessage } from '../types/messenger';

export interface ThreadSummary {
  rootId: string;
  replyCount: number;
  lastReplyAt: number;
  lastReplySender: string;
  lastReplyText: string;
  participantNames: string[];
}

export interface PartitionedMessages {
  mainMessages: ChatMessage[];
  repliesByRoot: Record<string, ChatMessage[]>;
  threadSummaries: Record<string, ThreadSummary>;
}

/**
 * Separates top-level conversation messages from nested thread replies
 * and builds per-root thread summaries for the timeline.
 */
export function partitionThreadMessages(
  messages: ChatMessage[]
): PartitionedMessages {
  const mainMessages: ChatMessage[] = [];
  const repliesByRoot: Record<string, ChatMessage[]> = {};
  const threadSummaries: Record<string, ThreadSummary> = {};

  for (const msg of messages) {
    const rootId = msg.threadRootId;
    if (!rootId) {
      mainMessages.push(msg);
      continue;
    }

    if (!repliesByRoot[rootId]) {
      repliesByRoot[rootId] = [];
    }
    repliesByRoot[rootId].push(msg);

    const existing = threadSummaries[rootId];
    const senderLabel = msg.senderName || 'Участник';
    const previewText = msg.isDeleted ? 'Сообщение удалено' : msg.text;
    if (!existing) {
      threadSummaries[rootId] = {
        rootId,
        replyCount: 1,
        lastReplyAt: msg.timestamp,
        lastReplySender: senderLabel,
        lastReplyText: previewText,
        participantNames: [senderLabel],
      };
    } else {
      existing.replyCount += 1;
      if (msg.timestamp >= existing.lastReplyAt) {
        existing.lastReplyAt = msg.timestamp;
        existing.lastReplySender = senderLabel;
        existing.lastReplyText = previewText;
      }
      if (!existing.participantNames.includes(senderLabel)) {
        existing.participantNames.push(senderLabel);
      }
    }
  }

  return { mainMessages, repliesByRoot, threadSummaries };
}

export function formatThreadReplyCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} ответ`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ответа`;
  }
  return `${count} ответов`;
}
