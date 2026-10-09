import type { ReactNode } from "react";

export function Table({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <div className="hub-table" role="table" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function TableHead({ columns }: { columns: string[] }) {
  return (
    <div className="hub-table-head" role="row">
      {columns.map((column) => (
        <span key={column}>{column}</span>
      ))}
    </div>
  );
}

export function TableRow({ children }: { children: ReactNode }) {
  return (
    <div className="hub-table-row" role="row">
      {children}
    </div>
  );
}

type CellVariant = "primary" | "muted" | "time";

export function TableCell({
  children,
  label,
  variant,
}: {
  children: ReactNode;
  label?: string;
  variant?: CellVariant;
}) {
  const variantClass = variant ? ` hub-table-cell-${variant}` : "";
  return (
    <div className={`hub-table-cell${variantClass}`} role="cell" data-label={label}>
      {children}
    </div>
  );
}
