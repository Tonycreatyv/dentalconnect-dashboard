import { TrendingUp } from "lucide-react";
import { labeledIndices } from "./trendChartLabels";

export type TrendPoint = { label: string; value: number };

export default function TrendChart({ points }: { points: TrendPoint[] }) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (total === 0) {
    return (
      <div className="hub-empty hub-empty-compact">
        <TrendingUp size={16} />
        <strong>Sin pedidos para graficar en este período</strong>
      </div>
    );
  }
  const max = Math.max(1, ...points.map((point) => point.value));
  const shownLabels = labeledIndices(points.length);
  return (
    <div className="hub-trend" role="img" aria-label="Tendencia de cupones pedidos por día">
      {points.map((point, index) => (
        <div key={`${point.label}-${index}`} className={point.value === max && max > 0 ? "hub-trend-bar is-peak" : "hub-trend-bar"}>
          <span className="hub-trend-bar-fill" style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }} title={`${point.label}: ${point.value}`} />
          <span className="hub-trend-bar-label" aria-hidden={!shownLabels.has(index)}>{shownLabels.has(index) ? point.label : ""}</span>
        </div>
      ))}
    </div>
  );
}
