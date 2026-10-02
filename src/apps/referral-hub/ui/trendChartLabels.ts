const MAX_READABLE_LABELS = 6;

// Which bar indices get a visible x-axis label. <=7 points (day/week
// periods) label every bar — that's already readable. More than that
// (month, ~30 day buckets) would collide at ~390px mobile width, so only
// an evenly spaced subset (first, last, and points in between) gets a
// label; every bar still renders, just without text, preserving the
// visual shape without the label collision.
export function labeledIndices(count: number): Set<number> {
  if (count <= 7) return new Set(Array.from({ length: count }, (_, i) => i));
  const target = Math.min(MAX_READABLE_LABELS, count);
  const step = (count - 1) / (target - 1);
  const indices = new Set<number>();
  for (let i = 0; i < target; i++) indices.add(Math.round(i * step));
  return indices;
}
