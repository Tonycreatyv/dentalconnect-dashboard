export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="hub-skeleton-wrap" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div className="hub-skeleton-row" key={index}>
          <span className="hub-skeleton-block" style={{ width: "70%" }} />
          <span className="hub-skeleton-block" style={{ width: "85%" }} />
          <span className="hub-skeleton-block" style={{ width: "50%" }} />
          <span className="hub-skeleton-block" style={{ width: "40%" }} />
        </div>
      ))}
    </div>
  );
}
