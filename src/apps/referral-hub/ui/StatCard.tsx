import { Link } from "react-router-dom";

type Props = { label: string; value: string | number; sub?: string; to?: string };

export default function StatCard({ label, value, sub, to }: Props) {
  const content = (
    <>
      <span className="hub-stat-label">{label}</span>
      <div className="hub-stat-value">{value}</div>
      {sub ? <div className="hub-stat-sub">{sub}</div> : null}
    </>
  );
  if (to) return <Link className="hub-stat-card" to={to}>{content}</Link>;
  return <div className="hub-stat-card">{content}</div>;
}
