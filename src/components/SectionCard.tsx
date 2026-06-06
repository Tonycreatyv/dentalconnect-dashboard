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
        "ui-card ui-card-pad overflow-hidden",
        interactive
          ? "cursor-pointer transition hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-[#3CBDB9]/35"
          : "",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="ui-title text-lg font-semibold">{title}</h2>
          {description ? <p className="ui-muted mt-1 text-safe">{description}</p> : null}
        </div>
        {action ? <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div> : null}
      </div>

      <div className="mt-6 min-w-0">{children}</div>
    </section>
  );
};
