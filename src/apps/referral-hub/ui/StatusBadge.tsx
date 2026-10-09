export type StatusTone = "danger" | "warning" | "success" | "neutral";

export default function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`hub-badge hub-badge-${tone}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
