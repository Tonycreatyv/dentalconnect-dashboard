type Segment = { id: string; label: string };

type Props = {
  segments: Segment[];
  activeId: string;
  onChange: (id: string) => void;
};

export default function SegmentedControl({ segments, activeId, onChange }: Props) {
  return (
    <div className="hub-segmented" role="tablist">
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          role="tab"
          aria-selected={segment.id === activeId}
          onClick={() => onChange(segment.id)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
