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
        "dc-card p-5 sm:p-6",
        interactive
          ? "cursor-pointer transition hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-[#3CBDB9]/35"
          : "",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white/95 truncate">{title}</h2>
          {description ? <p className="mt-1 text-sm text-white/70">{description}</p> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
};
