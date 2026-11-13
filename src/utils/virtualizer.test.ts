import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVirtualLayout,
  computeVisibleRange,
  estimateMessageHeight,
  findIndexAtOffset,
} from './virtualizer';

test('buildVirtualLayout builds accurate prefix sums for variable heights', () => {
  const heights = [50, 80, 120, 40];
  const layout = buildVirtualLayout(heights);
  assert.equal(layout.totalHeight, 290);
  assert.deepEqual(Array.from(layout.offsets), [0, 50, 130, 250, 290]);
});

test('findIndexAtOffset locates items in O(log N) for 10,000 messages', () => {
  const heights = Array.from({ length: 10000 }, (_, i) => 60 + (i % 5) * 15);
  const layout = buildVirtualLayout(heights);

  assert.equal(findIndexAtOffset(layout.offsets, 10000, 0), 0);
  const idx = findIndexAtOffset(layout.offsets, 10000, layout.offsets[5432] + 10);
  assert.equal(idx, 5432);
});

test('computeVisibleRange returns bounded window + overscan for 10,000 messages', () => {
  const heights = Array.from({ length: 10000 }, () => 72);
  const layout = buildVirtualLayout(heights);

  const range = computeVisibleRange(layout, 10000, 72000, 720, 4);
  // 72000 / 72 = 1000 -> visible 1000..1010, with overscan 4 -> 996..1014
  assert.equal(range.startIndex, 996);
  assert.equal(range.endIndex, 1014);
  assert.equal(range.paddingTop, 996 * 72);
  assert.equal(range.paddingBottom, (10000 - 1015) * 72);
});

test('estimateMessageHeight scales cleanly with multiline text and attachments', () => {
  const hShort = estimateMessageHeight('ok', false, false);
  const hLong = estimateMessageHeight('line1\nline2\nline3\nline4', true, true);
  assert.ok(hLong > hShort + 100);
});
