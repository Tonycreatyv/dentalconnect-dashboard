import type { KeyboardEvent, ReactNode } from "react";

export const SectionCard = ({
  title,
  description,
  action,
  onClick,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) => {
  const interactive = Boolean(onClick);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <section
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={[
        "rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.06)]",
        interactive
          ? "cursor-pointer transition hover:bg-[#F4F5F7] focus:outline-none focus:ring-2 focus:ring-blue-200"
          : "",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 truncate">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-700">{description}</p> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
};
