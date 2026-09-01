const PALETTE = ["#2F6FEB", "#16A34A", "#D97706", "#DB2777", "#7C3AED", "#0891B2", "#DC2626", "#4D7C0F"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export default function Avatar({ name, seed, size = 38 }: { name: string; seed?: string; size?: number }) {
  const label = name?.trim() || "Cliente";
  return (
    <span
      className="hub-avatar"
      style={{ width: size, height: size, fontSize: size * 0.32, background: colorFor(seed || label) }}
      aria-hidden="true"
    >
      {initials(label)}
    </span>
  );
}
