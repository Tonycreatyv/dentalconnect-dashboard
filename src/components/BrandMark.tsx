type Props = {
  clinicName?: string;
};

export default function BrandMark({ clinicName = "Clínica" }: Props) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-10 w-10 rounded-2xl border border-white/15 bg-white/10 overflow-hidden">
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(8,148,193,0.28), transparent 55%), radial-gradient(circle at 70% 80%, rgba(89,224,184,0.18), transparent 60%)",
          }}
        />
        <div className="absolute inset-0 rounded-2xl shadow-[0_0_20px_rgba(8,148,193,0.22)]" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-xs font-bold text-white">D</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight text-white">
          DentalConnect
        </div>
        <div className="truncate text-xs text-white/70">{clinicName}</div>
      </div>
    </div>
  );
}
