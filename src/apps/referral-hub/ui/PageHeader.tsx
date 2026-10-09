import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  actions?: ReactNode;
};

export default function PageHeader({ eyebrow, title, subtitle, meta, actions }: Props) {
  return (
    <header className="hub-page-header">
      <div className="hub-page-header-main">
        {eyebrow ? <p className="hub-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="hub-page-subtitle">{subtitle}</p> : null}
      </div>
      {meta || actions ? (
        <div className="hub-page-header-side">
          {meta}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
