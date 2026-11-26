import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_RECORDING_FORM, applyWheelPreset, canSaveWheelPreset, createPresetState,
  loadWheelPresets, nextRecordingForm, rememberWheelPreset, saveWheelPresets,
} from '../src/lib/presets.js';

const front = Object.freeze({ wheel_type: 'front', spoke_length_mm: '280.5', spoke_diameter_mm: '1.8', temperature_c: '24.5' });
const rear = Object.freeze({ wheel_type: 'rear', spoke_length_mm: '282', spoke_diameter_mm: '2', temperature_c: '26' });
const liveForm = Object.freeze({
  recorder: 'Sally', wheel_type: 'front', spoke_length_mm: '290',
  spoke_diameter_mm: '2.3', tension_kgf: '103.25', temperature_c: '27.5', environment: 'noisy',
});

function memoryStorage(initial) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    get value() { return value; },
  };
}

const withoutDiameter = ({ spoke_diameter_mm, ...preset }) => preset;

test('four-field front/rear drafts round-trip with independent diameters and preserve session recorder and environment', () => {
  assert.equal(canSaveWheelPreset(front), true);
  const empty = createPresetState();
  const frontOnly = rememberWheelPreset(empty, front);
  const both = rememberWheelPreset(frontOnly, rear);
  const storage = memoryStorage();
  assert.equal(saveWheelPresets(both, storage), true);
  const restored = loadWheelPresets(storage);
  assert.equal(restored.version, 3);
  assert.equal(restored.activeWheel, 'rear');
  assert.deepEqual(applyWheelPreset(liveForm, 'front', restored), { ...liveForm, ...front, tension_kgf: '' });
  assert.deepEqual(applyWheelPreset(liveForm, 'rear', restored), { ...liveForm, ...rear, tension_kgf: '' });
  const changedFront = rememberWheelPreset(restored, { ...front, spoke_diameter_mm: '1.6' });
  assert.deepEqual(changedFront.presets.rear, rear, 'updating front must not change rear diameter');
  assert.equal(restored.presets.front.spoke_diameter_mm, '1.8', 'the previous state remains immutable');
  assert.deepEqual(empty, createPresetState());
  assert.equal(frontOnly.presets.rear, undefined);
  assert.equal(liveForm.tension_kgf, '103.25');
});

test('new drafts require a positive finite diameter and an invalid edit cannot overwrite a saved preset', () => {
  const state = rememberWheelPreset(createPresetState(), front);
  assert.equal(canSaveWheelPreset(withoutDiameter(front)), false);
  for (const spoke_diameter_mm of ['', ' ', null, 0, -1, Infinity, 'Infinity', 'invalid', true, []]) {
    const draft = { ...front, spoke_diameter_mm };
    assert.equal(canSaveWheelPreset(draft), false, String(spoke_diameter_mm));
    assert.deepEqual(rememberWheelPreset(state, draft), state, 'invalid new drafts must not replace an existing preset');
  }
  assert.equal(canSaveWheelPreset({ ...front, recorder: null, environment: 'ignored', tension_kgf: '' }), true);
});

test('version 2 keeps valid wheel/length/temperature, marks missing diameter incomplete, and requires completion', () => {
  const oldState = { version: 2, activeWheel: 'rear', presets: {
    front: withoutDiameter(front), rear: withoutDiameter(rear),
  } };
  const storage = memoryStorage(JSON.stringify(oldState));
  const migrated = loadWheelPresets(storage);
  assert.deepEqual(migrated, { version: 3, activeWheel: 'rear', presets: {
    front: { ...front, spoke_diameter_mm: '' }, rear: { ...rear, spoke_diameter_mm: '' },
  } });
  assert.deepEqual(JSON.parse(storage.value), migrated, 'existing storage is migrated to v3');
  assert.equal(canSaveWheelPreset(migrated.presets.front), false, 'a migrated slot is not ready for a new save without diameter');
  assert.deepEqual(applyWheelPreset(liveForm, 'front', migrated), {
    ...liveForm, ...front, spoke_diameter_mm: '', tension_kgf: '',
  }, 'an incomplete preset must not borrow the current wheel diameter');
  const completed = rememberWheelPreset(migrated, { ...migrated.presets.front, spoke_diameter_mm: '1.5' });
  assert.equal(canSaveWheelPreset(completed.presets.front), true);
  assert.equal(completed.presets.rear.spoke_diameter_mm, '', 'completing front must not fill rear diameter');
});

test('version 1 recovers an existing positive diameter and preserves incomplete slots when old diameter is invalid', () => {
  const oldState = { version: 1, activeWheel: 'rear', presets: {
    front: { ...front, recorder: 'Most', environment: 'quiet', tension_kgf: '99' },
    rear: { ...rear, spoke_diameter_mm: -1, recorder: 'Alexander', environment: 'noisy' },
  } };
  const storage = memoryStorage(JSON.stringify(oldState));
  const migrated = loadWheelPresets(storage);
  assert.deepEqual(migrated.presets.front, front);
  assert.deepEqual(migrated.presets.rear, { ...rear, spoke_diameter_mm: '' });
  assert.doesNotMatch(storage.value, /recorder|environment|tension_kgf/);
  const frontForm = applyWheelPreset(liveForm, 'front', migrated);
  assert.equal(frontForm.spoke_diameter_mm, '1.8');
  assert.equal(applyWheelPreset(frontForm, 'rear', migrated).spoke_diameter_mm, '', 'legacy rear cannot inherit front diameter');
});

test('an incomplete migrated slot survives repeated version 3 saves and reloads until diameter is supplied', () => {
  const storage = memoryStorage(JSON.stringify({ version: 2, activeWheel: 'rear', presets: {
    front: withoutDiameter(front), rear: withoutDiameter(rear),
  } }));
  const migrated = loadWheelPresets(storage);
  const changedFront = rememberWheelPreset(migrated, front);
  assert.equal(saveWheelPresets(changedFront, storage), true);
  const reloaded = loadWheelPresets(storage);
  assert.equal(reloaded.version, 3);
  assert.deepEqual(reloaded.presets.front, front);
  assert.deepEqual(reloaded.presets.rear, { ...rear, spoke_diameter_mm: '' });
  assert.equal(saveWheelPresets(reloaded, storage), true);
  assert.deepEqual(loadWheelPresets(storage), reloaded);
});

test('unconfigured wheels clear length, diameter and tension while successful saves still clear only tension', () => {
  const state = rememberWheelPreset(createPresetState(), front);
  assert.deepEqual(applyWheelPreset(liveForm, 'rear', state), {
    ...liveForm, wheel_type: 'rear', spoke_length_mm: '', spoke_diameter_mm: '', tension_kgf: '',
  }, 'temperature, recorder and environment remain available');
  assert.deepEqual(nextRecordingForm(liveForm), { ...liveForm, tension_kgf: '' });
  assert.deepEqual(EMPTY_RECORDING_FORM, {
    recorder: '', wheel_type: '', spoke_length_mm: '', spoke_diameter_mm: '',
    tension_kgf: '', temperature_c: '', environment: '',
  });
});

test('corrupt, unsupported or blocked storage falls back safely and a read-only migration remains usable', () => {
  for (const value of ['{broken-json', 'null', '[]', '{"version":4,"activeWheel":"rear","presets":{}}']) {
    assert.deepEqual(loadWheelPresets(memoryStorage(value)), createPresetState());
  }
  const blocked = { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Quota exceeded'); } };
  assert.deepEqual(loadWheelPresets(blocked), createPresetState());
  assert.equal(saveWheelPresets(createPresetState(), blocked), false);
  assert.deepEqual(loadWheelPresets(null), createPresetState());
  assert.equal(saveWheelPresets(createPresetState(), null), false);
  const readOnly = {
    getItem: () => JSON.stringify({ version: 2, activeWheel: 'front', presets: { front: withoutDiameter(front) } }),
    setItem() { throw new Error('Storage is read-only'); },
  };
  assert.deepEqual(loadWheelPresets(readOnly), {
    version: 3, activeWheel: 'front', presets: { front: { ...front, spoke_diameter_mm: '' } },
  });
});

test('invalid v3 values discard only the affected slot while the explicit incomplete diameter remains loadable', () => {
  const invalidFields = [
    { spoke_length_mm: '' }, { spoke_length_mm: 'Infinity' }, { spoke_length_mm: 0 },
    { spoke_length_mm: -1 }, { spoke_length_mm: true }, { temperature_c: '' },
    { temperature_c: -274 }, { temperature_c: null }, { temperature_c: [] }, { wheel_type: 'rear' },
    { spoke_diameter_mm: -1 }, { spoke_diameter_mm: 0 }, { spoke_diameter_mm: null },
    { spoke_diameter_mm: 'invalid' }, { spoke_diameter_mm: 'Infinity' },
  ];
  for (const invalid of invalidFields) {
    const stored = memoryStorage(JSON.stringify({ version: 3, activeWheel: 'rear', presets: {
      front: { ...front, ...invalid }, rear,
    } }));
    const restored = loadWheelPresets(stored);
    assert.equal(restored.presets.front, undefined, JSON.stringify(invalid));
    assert.deepEqual(restored.presets.rear, rear);
  }
  assert.equal(canSaveWheelPreset({ ...front, temperature_c: -273.15 }), true);
  assert.equal(canSaveWheelPreset({ ...front, temperature_c: Infinity }), false);
});

test('version 3 storage whitelists exactly four preset fields and strips private or unrelated values', () => {
  const untrusted = {
    version: 3, activeWheel: 'front', service_role_key: 'must-not-persist',
    presets: { front: {
      ...liveForm, ...front, id: 'old-record-id', audio_path: 'old.mp3', blob: { type: 'audio/mpeg' },
      credentials: { token: 'must-not-persist' }, unknown: 'extra',
    }, other: rear },
  };
  Object.defineProperty(untrusted.presets.front, '__proto__', {
    value: { injected: true }, enumerable: true,
  });
  const storage = memoryStorage(JSON.stringify(untrusted));
  const loaded = loadWheelPresets(storage);
  assert.deepEqual(Object.keys(JSON.parse(storage.value).presets.front).sort(), [
    'spoke_diameter_mm', 'spoke_length_mm', 'temperature_c', 'wheel_type',
  ]);
  assert.equal(saveWheelPresets(untrusted, storage), true);
  assert.deepEqual(JSON.parse(storage.value), loaded);
  assert.equal(loaded.presets.other, undefined);
  assert.equal({}.injected, undefined);
  assert.doesNotMatch(storage.value, /recorder|environment|tension_kgf|must-not-persist|old-record-id|old\.mp3|injected/);
});
