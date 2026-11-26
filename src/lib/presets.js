export const EMPTY_RECORDING_FORM = Object.freeze({
  recorder: '',
  wheel_type: '',
  spoke_length_mm: '',
  spoke_diameter_mm: '',
  tension_kgf: '',
  temperature_c: '',
  environment: '',
});

const STORAGE_KEY = 'spoke-wheel-presets';
const WHEELS = ['front', 'rear'];
const SUPPORTED_VERSIONS = [1, 2, 3];
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function createPresetState() {
  return { version: 3, activeWheel: '', presets: {} };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteInput(value) {
  if (typeof value === 'string') return DECIMAL.test(value.trim()) && Number.isFinite(Number(value));
  return typeof value === 'number' && Number.isFinite(value);
}

function hasValidBase(form) {
  return isObject(form)
    && WHEELS.includes(form.wheel_type)
    && isFiniteInput(form.spoke_length_mm) && Number(form.spoke_length_mm) > 0
    && isFiniteInput(form.temperature_c) && Number(form.temperature_c) >= -273.15;
}

function hasValidDiameter(value) {
  return isFiniteInput(value) && Number(value) > 0;
}

export function canSaveWheelPreset(form) {
  return hasValidBase(form) && hasValidDiameter(form.spoke_diameter_mm);
}

function cleanPreset(form, wheel, legacy = false) {
  if (!hasValidBase(form) || form.wheel_type !== wheel) return null;
  const numericInput = (value) => typeof value === 'string' ? value.trim() : value;
  const validDiameter = hasValidDiameter(form.spoke_diameter_mm);
  // Legacy slots keep their valid existing values while the user supplies the
  // newly required diameter. Only the explicit empty value survives v3 reloads.
  if (!validDiameter && !legacy && form.spoke_diameter_mm !== '') return null;
  // Never spread untrusted stored objects: only reusable metadata belongs here.
  return {
    wheel_type: wheel,
    spoke_length_mm: numericInput(form.spoke_length_mm),
    spoke_diameter_mm: validDiameter ? numericInput(form.spoke_diameter_mm) : '',
    temperature_c: numericInput(form.temperature_c),
  };
}

function cleanState(input) {
  const state = createPresetState();
  if (!isObject(input) || !SUPPORTED_VERSIONS.includes(input.version)) return state;
  if (WHEELS.includes(input.activeWheel)) state.activeWheel = input.activeWheel;
  if (isObject(input.presets)) {
    for (const wheel of WHEELS) {
      const preset = cleanPreset(input.presets[wheel], wheel, input.version < 3);
      if (preset) state.presets[wheel] = preset;
    }
  }
  return state;
}

export function loadWheelPresets(storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    const stored = target?.getItem(STORAGE_KEY);
    if (!stored) return createPresetState();
    const parsed = JSON.parse(stored);
    const state = cleanState(parsed);
    // Remove obsolete fields from existing storage when migrating. A blocked
    // write must not prevent using the cleaned presets for this session.
    if (isObject(parsed) && SUPPORTED_VERSIONS.includes(parsed.version)) {
      const cleaned = JSON.stringify(state);
      if (cleaned !== stored && typeof target?.setItem === 'function') {
        try { target.setItem(STORAGE_KEY, cleaned); } catch { /* Session presets remain usable. */ }
      }
    }
    return state;
  } catch {
    return createPresetState();
  }
}

export function saveWheelPresets(state, storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.setItem !== 'function') return false;
    target.setItem(STORAGE_KEY, JSON.stringify(cleanState(state)));
    return true;
  } catch {
    return false;
  }
}

export function rememberWheelPreset(state, form) {
  const next = cleanState(state);
  if (!canSaveWheelPreset(form)) return next;
  const wheel = form.wheel_type;
  next.presets[wheel] = cleanPreset(form, wheel);
  next.activeWheel = wheel;
  return next;
}

export function applyWheelPreset(currentForm, wheel, state) {
  const current = { ...EMPTY_RECORDING_FORM, ...currentForm };
  const selectedWheel = WHEELS.includes(wheel) ? wheel : '';
  const preset = cleanState(state).presets[selectedWheel];
  if (preset) return { ...current, ...preset, tension_kgf: '' };
  return {
    ...current,
    wheel_type: selectedWheel,
    spoke_length_mm: '',
    spoke_diameter_mm: '',
    tension_kgf: '',
  };
}

export function nextRecordingForm(form) {
  return { ...form, tension_kgf: '' };
}
