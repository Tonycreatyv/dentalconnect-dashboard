import type { ComponentType } from "react";

type Props = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  tone?: "default" | "error";
};

export default function EmptyState({ icon: Icon, title, description, tone = "default" }: Props) {
  return (
    <div className={tone === "error" ? "hub-empty hub-empty-error" : "hub-empty"} role={tone === "error" ? "alert" : undefined}>
      <Icon />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
