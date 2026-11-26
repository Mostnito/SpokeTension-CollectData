import { ChevronDown, SlidersHorizontal, X } from "lucide-react";

export default function DatasetFilters({
  filters,
  sortOrder = "newest",
  onSortChange,
  onChange,
  onClear,
  disabled,
  t,
}) {
  const active = Object.values(filters).some(Boolean);
  const fields = [
    {
      name: "recorder",
      label: t.recorder,
      all: t.allRecorders,
      options: ["Most", "Alexander", "Sally", "Devolia"].map((name) => [
        name,
        name,
      ]),
    },
    {
      name: "wheel_type",
      label: t.wheelType,
      all: t.allWheels,
      options: [
        ["front", t.frontWheel],
        ["rear", t.rearWheel],
      ],
    },
    {
      name: "environment",
      label: t.environment,
      all: t.allEnvironments,
      options: [
        ["quiet", t.quietRoom],
        ["noisy", t.noisyRoom],
      ],
    },
  ];

  return (
    <section
      className="dataset-filters"
      aria-labelledby="dataset-filters-title"
    >
      <div className="filter-heading">
        <h2 id="dataset-filters-title">
          <SlidersHorizontal size={16} />
          {t.filters}
        </h2>
        <button
          type="button"
          className="text-button clear-filters"
          onClick={onClear}
          disabled={!active || disabled}
        >
          <X size={13} />
          {t.clearFilters}
        </button>
      </div>
      <div className="filter-grid">
        {fields.map(({ name, label, all, options }) => (
          <div className="field" key={name}>
            <label className="field-label" htmlFor={`filter-${name}`}>
              {label}
            </label>
            <div className="select-wrap">
              <select
                id={`filter-${name}`}
                name={`filter-${name}`}
                value={filters[name]}
                disabled={disabled}
                onChange={(event) => onChange(name, event.target.value)}
              >
                <option value="">{all}</option>
                {options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>
          </div>
        ))}
        {onSortChange && (
          <div className="field dataset-sort">
            <label className="field-label" htmlFor="dataset-sort">{t.sortBy}</label>
            <div className="select-wrap">
              <select
                id="dataset-sort"
                name="dataset-sort"
                value={sortOrder}
                disabled={disabled}
                onChange={(event) => onSortChange(event.target.value)}
              >
                <option value="newest">{t.sortNewest}</option>
                <option value="tension-asc">{t.sortTensionAsc}</option>
                <option value="tension-desc">{t.sortTensionDesc}</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
