/**
 * O(log N) Binary-Search Variable-Height Virtualizer
 * Eliminates O(N) DOM layout thrashing on large 10,000+ message histories.
 */

export interface VirtualItemMetric {
  id: string;
  height: number;
}

export interface VirtualLayout {
  offsets: Float64Array; // length = count + 1; offsets[i] = top of item i, offsets[count] = totalHeight
  totalHeight: number;
}

export interface VisibleRange {
  startIndex: number;
  endIndex: number; // inclusive
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Estimates message row height deterministically before ResizeObserver measures it.
 */
export function estimateMessageHeight(
  text: string,
  hasAttachment: boolean,
  isGroupHead: boolean
): number {
  const charsPerLine = 46;
  const explicitLines = text.split('\n');
  let lineCount = 0;
  for (const line of explicitLines) {
    lineCount += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  const basePadding = isGroupHead ? 54 : 30;
  const attachmentHeight = hasAttachment ? 58 : 0;
  return basePadding + lineCount * 21 + attachmentHeight;
}

/**
 * Builds prefix-sum offset array in O(N). Cached via useMemo when item heights change.
 */
export function buildVirtualLayout(heights: number[]): VirtualLayout {
  const n = heights.length;
  const offsets = new Float64Array(n + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = acc;
    acc += heights[i];
  }
  offsets[n] = acc;
  return { offsets, totalHeight: acc };
}

/**
 * Binary search for the first index whose bottom > targetOffset.
 */
export function findIndexAtOffset(
  offsets: Float64Array,
  count: number,
  targetOffset: number
): number {
  if (count === 0) return 0;
  if (targetOffset <= 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid + 1] <= targetOffset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Computes visible slice + overscan in O(log N) time.
 */
export function computeVisibleRange(
  layout: VirtualLayout,
  count: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 6
): VisibleRange {
  if (count === 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0 };
  }

  const rawStart = findIndexAtOffset(layout.offsets, count, scrollTop);
  const rawEnd = findIndexAtOffset(
    layout.offsets,
    count,
    scrollTop + viewportHeight
  );

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(count - 1, rawEnd + overscan);

  const paddingTop = layout.offsets[startIndex];
  const paddingBottom = Math.max(
    0,
    layout.totalHeight - layout.offsets[endIndex + 1]
  );

  return {
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
  };
}
