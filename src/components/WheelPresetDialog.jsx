import { useEffect, useRef, useState } from "react";
import { ChevronDown, Save, Settings2, X } from "lucide-react";
import { canSaveWheelPreset } from "../lib/presets.js";

export default function WheelPresetDialog({ form, presets, t, onClose, onSave }) {
  const dialog = useRef(null);
  const [draft, setDraft] = useState(() => {
    const saved = presets[form.wheel_type];
    return {
      wheel_type: form.wheel_type,
      spoke_length_mm: saved?.spoke_length_mm ?? form.spoke_length_mm,
      spoke_diameter_mm: saved?.spoke_diameter_mm ?? form.spoke_diameter_mm,
      temperature_c: saved?.temperature_c ?? form.temperature_c,
    };
  });

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  const update = (name, value) => {
    setDraft((current) => {
      if (name !== "wheel_type") return { ...current, [name]: value };
      const saved = presets[value];
      return {
        wheel_type: value,
        spoke_length_mm:
          saved?.spoke_length_mm ??
          (value === form.wheel_type ? form.spoke_length_mm : ""),
        spoke_diameter_mm:
          saved?.spoke_diameter_mm ??
          (value === form.wheel_type ? form.spoke_diameter_mm : ""),
        temperature_c: saved?.temperature_c ?? current.temperature_c,
      };
    });
  };

  const submit = (event) => {
    event.preventDefault();
    if (canSaveWheelPreset(draft) && event.currentTarget.reportValidity()) {
      onSave(draft);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="export-dialog preset-dialog"
      aria-label={t.presetTitle}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <form className="dialog-inner" onSubmit={submit}>
        <div className="dialog-heading">
          <span className="dialog-icon">
            <Settings2 size={22} aria-hidden="true" />
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t.close}
          >
            <X size={19} />
          </button>
        </div>
        <div className="fields-grid">
          <div className="field">
            <label className="field-label" htmlFor="preset-wheel-type">
              {t.wheelType}
              <span className="required-star" aria-hidden="true">*</span>
            </label>
            <div className="select-wrap">
              <select
                id="preset-wheel-type"
                name="wheel_type"
                value={draft.wheel_type}
                onChange={(event) => update("wheel_type", event.target.value)}
                required
                autoFocus
              >
                <option value="" disabled>{t.selectWheel}</option>
                <option value="front">{t.frontWheel}</option>
                <option value="rear">{t.rearWheel}</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </div>
          {[
            ["spoke_length_mm", "preset-spoke-length", t.spokeLength, "mm", 0.000001],
            ["spoke_diameter_mm", "preset-spoke-diameter", t.spokeDiameter, "mm", 0.000001],
            ["temperature_c", "preset-temperature", t.temperature, "°C", -273.15],
          ].map(([name, id, label, unit, min]) => (
            <div className="field" key={name}>
              <label className="field-label" htmlFor={id}>
                {label}
                <span className="required-star" aria-hidden="true">*</span>
                <span className="field-unit">{unit}</span>
              </label>
              <input
                id={id}
                name={name}
                type="number"
                inputMode="decimal"
                step="any"
                min={min}
                value={draft[name]}
                onChange={(event) => update(name, event.target.value)}
                placeholder="—"
                required
              />
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!canSaveWheelPreset(draft)}
          >
            {t.savePreset}
          </button>
        </div>
      </form>
    </dialog>
  );
}
