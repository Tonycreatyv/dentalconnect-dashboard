type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  allLabel?: string;
};

// Native <select> filter — used instead of chip/tab rows on list workspaces
// (Servicios, Beneficios) so filter density stays low on mobile.
export default function DropdownFilter({ label, value, options, onChange, allLabel = "Todos" }: Props) {
  return (
    <label className="hub-dropdown-filter">
      <span className="hub-dropdown-filter-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
