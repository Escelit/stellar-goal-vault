export interface AssetFilterDropdownProps {
  options: string[]; // sorted distinct asset codes
  value: string; // "" = "All assets"
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function AssetFilterDropdown({
  options,
  value,
  onChange,
  disabled = false,
}: AssetFilterDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Filter by asset"
      style={{
        padding: "8px 12px",
        border: "1px solid #cbd5e1",
        borderRadius: "12px",
        background: "#ffffff",
        font: "inherit",
        fontSize: "0.9rem",
        color: "#14213d",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <option value="">All assets</option>
      {options.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
