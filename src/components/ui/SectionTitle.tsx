export function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-white/95 sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-white/70">{subtitle}</p> : null}
    </div>
  );
}
