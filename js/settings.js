// Settings: the Device Profile (per Screen), tracking tuning, and scene options.
// Everything the viewer changes is remembered in this browser only.

import { detectDevice, screenKey } from './deviceProfile.js';

const STORAGE_KEY = 'windowvr:v1';

export const TUNING_DEFAULTS = {
  minCutoffXY: 0.8,
  minCutoffZ: 0.4,
  beta: 0.15,
  predictionAmount: 1,
  latencyMs: 45,
  renderSmoothingMs: 25,
};

export const SCENE_DEFAULTS = {
  roomDepthCm: 45,
};

const FIELDS = [
  {
    group: 'Screen & webcam',
    section: 'profile',
    items: [
      { key: 'screenWidthCm', label: 'Screen width', unit: 'cm', step: 0.1, min: 10, max: 200 },
      { key: 'screenHeightCm', label: 'Screen height', unit: 'cm', step: 0.1, min: 5, max: 150 },
      { key: 'camXCm', label: 'Webcam horizontal offset', unit: 'cm', step: 0.1, min: -100, max: 100,
        help: 'From the Screen’s center. Positive = right.' },
      { key: 'camYCm', label: 'Webcam height above screen', unit: 'cm', step: 0.05, min: -5, max: 30,
        help: 'From the top edge of the lit area. Negative = inside the notch.' },
      { key: 'camFovDeg', label: 'Webcam field of view', unit: '°', step: 0.5, min: 30, max: 130,
        help: 'Horizontal. If the debug distance reads wrong, adjust this.' },
      { key: 'eyeSeparationCm', label: 'Eye separation', unit: 'cm', step: 0.05, min: 4.5, max: 8,
        help: 'Distance between pupils.' },
    ],
  },
  {
    group: 'Smoothing',
    section: 'tuning',
    items: [
      { key: 'minCutoffXY', label: 'Side-to-side steadiness', unit: 'Hz', step: 0.05, min: 0.05, max: 5,
        help: 'Lower = steadier when still, but laggier.' },
      { key: 'minCutoffZ', label: 'Depth steadiness', unit: 'Hz', step: 0.05, min: 0.05, max: 5 },
      { key: 'beta', label: 'Speed responsiveness', unit: '', step: 0.01, min: 0, max: 2,
        help: 'Higher = less lag during fast moves.' },
      { key: 'predictionAmount', label: 'Prediction', unit: '×', step: 0.05, min: 0, max: 1.5,
        help: 'Extrapolates motion between camera frames.' },
      { key: 'latencyMs', label: 'Latency compensation', unit: 'ms', step: 1, min: 0, max: 120 },
      { key: 'renderSmoothingMs', label: 'Frame blending', unit: 'ms', step: 1, min: 0, max: 150 },
    ],
  },
  {
    group: 'Target Room',
    section: 'scene',
    items: [
      { key: 'roomDepthCm', label: 'Room depth', unit: 'cm', step: 1, min: 10, max: 200 },
    ],
  },
];

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

export function createSettings() {
  const stored = load();
  stored.screens ??= {};
  const key = screenKey();
  const detected = detectDevice();
  const saved = stored.screens[key] || {};

  const state = {
    detected,
    profile: { ...detected.profile, ...saved.values },
    confirmed: !!saved.confirmed,
    tuning: { ...TUNING_DEFAULTS, ...stored.tuning },
    scene: { ...SCENE_DEFAULTS, ...stored.scene },
  };
  const listeners = new Set();

  const persist = () => {
    const profileOverrides = {};
    for (const [k, v] of Object.entries(state.profile)) {
      if (v !== detected.profile[k]) profileOverrides[k] = v;
    }
    stored.screens[key] = { values: profileOverrides, confirmed: state.confirmed };
    stored.tuning = state.tuning;
    stored.scene = state.scene;
    save(stored);
  };

  const emit = (section) => listeners.forEach((fn) => fn(section));

  return {
    state,
    get needsAttention() {
      return !detected.recognized && !state.confirmed;
    },
    onChange(fn) {
      listeners.add(fn);
    },
    set(section, k, value) {
      state[section][k] = value;
      if (section === 'profile') state.confirmed = true;
      persist();
      emit(section);
    },
    confirm() {
      state.confirmed = true;
      persist();
      emit('profile');
    },
    resetProfile() {
      Object.assign(state.profile, detected.profile);
      state.confirmed = false;
      persist();
      emit('profile');
    },
    resetTuning() {
      Object.assign(state.tuning, TUNING_DEFAULTS);
      Object.assign(state.scene, SCENE_DEFAULTS);
      persist();
      emit('tuning');
      emit('scene');
    },
  };
}

// Builds the settings panel inside `root`. `actions` holds scene buttons.
export function mountSettingsPanel(root, settings, actions) {
  const state = settings.state;
  const detected = state.detected;
  root.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'panel-head';
  header.innerHTML = `<h2>Settings</h2><button class="icon-btn glass close" aria-label="Close settings"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  root.append(header);

  const status = document.createElement('div');
  status.className = 'device-status';
  root.append(status);

  const inputs = {};

  for (const group of FIELDS) {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${group.group}</legend>`;
    for (const f of group.items) {
      const row = document.createElement('label');
      row.className = 'field';
      row.innerHTML = `
        <span class="field-label">${f.label}${f.help ? `<small>${f.help}</small>` : ''}</span>
        <span class="field-input">
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}">
          <input type="number" min="${f.min}" max="${f.max}" step="${f.step}">
          <span class="unit">${f.unit}</span>
        </span>`;
      const [range, num] = row.querySelectorAll('input');
      const onInput = (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isFinite(v)) return;
        settings.set(group.section, f.key, v);
        (e.target === range ? num : range).value = v;
      };
      range.addEventListener('input', onInput);
      num.addEventListener('change', onInput);
      inputs[`${group.section}.${f.key}`] = [range, num];
      fs.append(row);
    }
    if (group.section === 'profile') {
      const btns = document.createElement('div');
      btns.className = 'btn-row';
      btns.innerHTML = `<button class="btn" data-act="reset-profile">Reset to defaults</button>`;
      fs.append(btns);
    }
    if (group.section === 'scene') {
      const btns = document.createElement('div');
      btns.className = 'btn-row';
      btns.innerHTML = `<button class="btn" data-act="shuffle">Shuffle targets</button>
        <button class="btn" data-act="reset-tuning">Reset smoothing &amp; scene</button>`;
      fs.append(btns);
    }
    root.append(fs);
  }

  const note = document.createElement('p');
  note.className = 'fine-print';
  note.textContent = 'Settings are stored in this browser only. Nothing is uploaded.';
  root.append(note);

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset-profile') settings.resetProfile();
    if (act === 'reset-tuning') settings.resetTuning();
    if (act === 'confirm') settings.confirm();
    if (act === 'shuffle') actions.shuffle();
    if (e.target.closest('.close')) actions.close();
  });

  const refresh = () => {
    for (const [id, [range, num]] of Object.entries(inputs)) {
      const [section, k] = id.split('.');
      const v = state[section][k];
      if (document.activeElement !== num) num.value = v;
      if (document.activeElement !== range) range.value = v;
    }
    if (detected.recognized) {
      status.className = 'device-status ok';
      status.innerHTML = `Auto detected <strong>${detected.name}</strong>`;
    } else if (settings.needsAttention) {
      status.className = 'device-status warn';
      status.innerHTML = `${detected.name
        ? `This looks like a <strong>${detected.name.replace(/\?$/, '')}</strong>, but it could be another model.`
        : 'Couldn’t identify this screen.'} The values below are estimates, so check the screen size and webcam position with a ruler.
        <div class="btn-row"><button class="btn primary" data-act="confirm">These look right</button></div>`;
    } else {
      status.className = 'device-status ok';
      status.textContent = 'Using your saved values for this screen.';
    }
  };

  settings.onChange(refresh);
  refresh();
}
