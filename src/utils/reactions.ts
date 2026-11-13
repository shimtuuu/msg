export type MessageReactions = Record<string, string[]>;

export type ReactionAction = 'add' | 'remove';

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

export const REACTION_EMOJIS = ['👍', '❤️', '🔥', '🎉', '👀', '✅'] as const;

export function applyReactionUpdate(
  reactions: MessageReactions | undefined,
  emoji: string,
  userId: string,
  action: ReactionAction
): MessageReactions | undefined {
  const cleanEmoji = emoji.trim();
  if (!cleanEmoji || !userId) return reactions;

  const currentMap: MessageReactions = reactions ? { ...reactions } : {};
  const existingUsers = currentMap[cleanEmoji] ?? [];

  if (action === 'add') {
    if (existingUsers.includes(userId)) {
      return reactions;
    }
    currentMap[cleanEmoji] = [...existingUsers, userId];
    return currentMap;
  }

  // action === 'remove'
  if (!existingUsers.includes(userId)) {
    return reactions;
  }
  const remaining = existingUsers.filter((id) => id !== userId);
  if (remaining.length === 0) {
    delete currentMap[cleanEmoji];
  } else {
    currentMap[cleanEmoji] = remaining;
  }
  return Object.keys(currentMap).length > 0 ? currentMap : undefined;
}

export function toggleReaction(
  reactions: MessageReactions | undefined,
  emoji: string,
  userId: string
): { nextReactions: MessageReactions | undefined; action: ReactionAction } {
  const existing = reactions?.[emoji] ?? [];
  const action: ReactionAction = existing.includes(userId) ? 'remove' : 'add';
  const nextReactions = applyReactionUpdate(reactions, emoji, userId, action);
  return { nextReactions, action };
}

export function getReactionSummaries(
  reactions: MessageReactions | undefined,
  currentUserId: string
): ReactionSummary[] {
  if (!reactions) return [];
  const summaries: ReactionSummary[] = [];
  for (const [emoji, userIds] of Object.entries(reactions)) {
    if (!Array.isArray(userIds) || userIds.length === 0) continue;
    summaries.push({
      emoji,
      count: userIds.length,
      reactedByMe: userIds.includes(currentUserId),
      userIds,
    });
  }
  return summaries;
}
