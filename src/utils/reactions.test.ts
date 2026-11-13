import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReactionUpdate,
  getReactionSummaries,
  REACTION_EMOJIS,
  toggleReaction,
} from './reactions';

test('toggleReaction adds a new emoji reaction and removes it when toggled again', () => {
  const added = toggleReaction(undefined, '👍', 'user_1');
  assert.equal(added.action, 'add');
  assert.deepEqual(added.nextReactions, { '👍': ['user_1'] });

  const removed = toggleReaction(added.nextReactions, '👍', 'user_1');
  assert.equal(removed.action, 'remove');
  assert.equal(removed.nextReactions, undefined);
});

test('applyReactionUpdate is idempotent for duplicate WebSocket events and preserves other users', () => {
  let state = applyReactionUpdate(undefined, '🔥', 'user_1', 'add');
  // Duplicate add event from WS reconnect should not duplicate user_1
  state = applyReactionUpdate(state, '🔥', 'user_1', 'add');
  state = applyReactionUpdate(state, '🔥', 'user_2', 'add');
  assert.deepEqual(state, { '🔥': ['user_1', 'user_2'] });

  // Removing user_1 leaves user_2 intact
  state = applyReactionUpdate(state, '🔥', 'user_1', 'remove');
  assert.deepEqual(state, { '🔥': ['user_2'] });

  // Duplicate remove is a safe no-op
  state = applyReactionUpdate(state, '🔥', 'user_1', 'remove');
  assert.deepEqual(state, { '🔥': ['user_2'] });
});

test('getReactionSummaries computes counts and current user participation', () => {
  const reactions = {
    '👍': ['user_1', 'user_2'],
    '❤️': ['user_2'],
  };
  const summaries = getReactionSummaries(reactions, 'user_1');
  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries[0], {
    emoji: '👍',
    count: 2,
    reactedByMe: true,
    userIds: ['user_1', 'user_2'],
  });
  assert.deepEqual(summaries[1], {
    emoji: '❤️',
    count: 1,
    reactedByMe: false,
    userIds: ['user_2'],
  });
  assert.ok(REACTION_EMOJIS.length >= 6);
});
