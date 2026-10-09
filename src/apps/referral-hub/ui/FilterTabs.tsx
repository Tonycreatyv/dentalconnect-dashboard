type Tab = { id: string; label: string; count?: number };

type Props = {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
};

export default function FilterTabs({ tabs, activeId, onChange }: Props) {
  return (
    <div className="hub-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className="hub-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === "number" ? <span className="hub-tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
