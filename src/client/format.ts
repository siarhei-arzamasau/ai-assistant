export function strategyLabel(strategy?: string, slidingWindowSize?: number): string {
  switch (strategy) {
    case 'sliding-window': return `Sliding Window (${slidingWindowSize ?? '?'})`;
    case 'sticky-facts':   return 'Sticky Facts';
    case 'branching':      return 'Branching';
    default:               return 'default';
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
