import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { isHandheld } from './deviceProfile.js';
import { createSettings, mountSettingsPanel } from './settings.js';
import { Tracker, preloadLandmarker, EYE_CORNERS } from './tracking.js';
import { PointFilter } from './oneEuro.js';
import { viewportRect, applyOffAxis, isFullscreen } from './viewport.js';
import { TargetRoom } from './targetRoom.js';

const $ = (sel) => document.querySelector(sel);

if (isHandheld()) {
  $('#handheld').hidden = false;
  $('#start').hidden = true;
} else {
  boot();
}

function boot() {
  const settings = createSettings();
  const { profile, tuning } = settings.state;

  // ---------- Rendering ----------
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const room = new TargetRoom();
  const camera = new THREE.PerspectiveCamera();

  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(room.scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.2, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    room.setResolution(w, h);
  }
  addEventListener('resize', resize);
  resize();

  // ---------- Eye Point sources ----------
  const filter = new PointFilter();
  const applyTuning = () => filter.configure(tuning);
  applyTuning();
  settings.onChange((section) => section === 'tuning' && applyTuning());

  const tracker = new Tracker({
    getProfile: () => profile,
    onSample: (eye, t) => {
      eye.z = Math.min(Math.max(eye.z, 15), 300);
      filter.push(eye, t);
    },
    onStatus: (s) => {
      if (s === 'tracking') filter.reset(); // don't glide in from a stale position
      updatePill();
    },
  });
  preloadLandmarker().catch(() => {}); // warm the download while the start screen shows

  let started = false; // past the start screen

  // Intro Preview: on the start screen the pointer steers the Eye Point, and it
  // drifts on its own when idle. Once started, only the webcam moves it.
  const pointer = { nx: 0, ny: 0, lastMove: -Infinity };
  addEventListener('pointermove', (e) => {
    pointer.nx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ny = -((e.clientY / innerHeight) * 2 - 1);
    pointer.lastMove = performance.now();
  });

  function untrackedEye(rect, now, out) {
    if (started) {
      // Tracking Lost: settle at the Rest Position, straight in front of the Viewport.
      out.x = 0;
      out.y = 0;
      out.z = 55;
      return out;
    }
    const idle = now - pointer.lastMove > 4000;
    if (idle) {
      const t = now / 1000;
      out.x = Math.sin(t * 0.37) * rect.w * 0.35;
      out.y = Math.sin(t * 0.23 + 1) * rect.h * 0.3;
      out.z = 55 + Math.sin(t * 0.17) * 12;
    } else {
      out.x = pointer.nx * rect.w * 0.5;
      out.y = pointer.ny * rect.h * 0.5;
      out.z = 55;
    }
    return out;
  }

  // ---------- Frame loop ----------
  const eye = { x: 0, y: 0, z: 55 };
  const goal = { x: 0, y: 0, z: 55 };
  let lastSource = 'untracked';
  let transitionUntil = 0;
  let lastNow = performance.now();
  const renderStats = { fps: 60, frames: 0, t: lastNow };

  function frame(now) {
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;

    const rect = viewportRect(profile);
    room.setSize(rect.w, rect.h, settings.state.scene.roomDepthCm);

    const source = tracker.status === 'tracking' && filter.t !== null ? 'tracking' : 'untracked';
    if (source !== lastSource) {
      transitionUntil = now + 700; // glide, don't snap, when switching sources
      lastSource = source;
    }

    if (source === 'tracking') {
      const sinceSample = now / 1000 - filter.t;
      const lead = tuning.predictionAmount * Math.min(sinceSample + tuning.latencyMs / 1000, 0.15);
      filter.predict(Math.max(0, lead), goal);
      goal.x -= rect.cx; // Screen space -> Viewport space
      goal.y -= rect.cy;
    } else {
      untrackedEye(rect, now, goal);
    }

    const tau = Math.max(tuning.renderSmoothingMs / 1000, now < transitionUntil ? 0.25 : 0);
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    eye.x += (goal.x - eye.x) * k;
    eye.y += (goal.y - eye.y) * k;
    eye.z += (goal.z - eye.z) * k;

    applyOffAxis(camera, eye, rect.w, rect.h, 1, 5000);
    room.update(eye.z);
    composer.render();

    renderStats.frames++;
    if (now - renderStats.t > 500) {
      renderStats.fps = (renderStats.frames * 1000) / (now - renderStats.t);
      renderStats.frames = 0;
      renderStats.t = now;
    }
    if (debugOn) drawDebug(rect, source);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Start screen ----------
  function dismissStart() {
    started = true;
    $('#start').classList.add('gone');
    setTimeout(() => ($('#start').hidden = true), 600);
    updatePill();
  }
  // No automatic fullscreen: it would hide the browser's camera permission prompt.
  $('#start-webcam').addEventListener('click', () => {
    dismissStart();
    tracker.start();
  });

  // ---------- Tracking Lost pill ----------
  const pill = $('#pill');
  const PILL = {
    loading: ['Starting head tracking…', null],
    denied: ['Head not tracked: camera access is blocked. Allow it for this site, then', 'Retry'],
    nocamera: ['Head not tracked: no webcam found.', 'Retry'],
    error: ['Head not tracked: tracking failed to load.', 'Retry'],
    noface: ['Head not tracked: face not found. Look at the screen.', null],
  };
  function updatePill() {
    const entry = PILL[tracker.status];
    if (!started || !entry) {
      pill.classList.remove('show');
      return;
    }
    const [text, action] = entry;
    pill.querySelector('.pill-text').textContent = text;
    const btn = pill.querySelector('.pill-action');
    btn.hidden = !action;
    btn.textContent = action || '';
    pill.classList.toggle('busy', tracker.status === 'loading');
    pill.classList.add('show');
  }
  pill.querySelector('.pill-action').addEventListener('click', () => tracker.start());

  // ---------- HUD ----------
  function enterFullscreen() {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
  }
  function toggleFullscreen() {
    if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    else enterFullscreen();
  }
  const onFsChange = () => $('#btn-fullscreen').classList.toggle('active', isFullscreen());
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);

  // Settings panel + badge for an Unrecognized Device.
  const panel = $('#settings');
  const setPanel = (open) => {
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
  };
  mountSettingsPanel(panel, settings, {
    shuffle: () => room.shuffle(),
    close: () => setPanel(false),
  });
  const updateBadge = () => $('#btn-settings').classList.toggle('badge', settings.needsAttention);
  settings.onChange(updateBadge);
  updateBadge();
  $('#btn-settings').addEventListener('click', () => setPanel(!panel.classList.contains('open')));

  // Debug overlay.
  let debugOn = false;
  const debugEl = $('#debug');
  const debugCanvas = $('#debug-video');
  const dctx = debugCanvas.getContext('2d');
  const debugText = $('#debug-text');
  const toggleDebug = () => {
    debugOn = !debugOn;
    debugEl.hidden = !debugOn;
    $('#btn-debug').classList.toggle('active', debugOn);
  };
  $('#btn-debug').addEventListener('click', toggleDebug);

  function drawDebug(rect, source) {
    const v = tracker.video;
    const W = debugCanvas.width, H = debugCanvas.height;
    dctx.fillStyle = '#000';
    dctx.fillRect(0, 0, W, H);
    if (tracker.active && v.videoWidth) {
      // Mirrored, like looking in a mirror.
      dctx.save();
      dctx.translate(W, 0);
      dctx.scale(-1, 1);
      dctx.drawImage(v, 0, 0, W, H);
      const lm = tracker.lastLandmarks;
      if (lm) {
        dctx.fillStyle = '#39f';
        for (const i of EYE_CORNERS) dot(lm[i].x * W, lm[i].y * H, 2.5);
        const c = (a, b) => [((lm[a].x + lm[b].x) / 2) * W, ((lm[a].y + lm[b].y) / 2) * H];
        const r = c(33, 133), l = c(362, 263);
        dctx.fillStyle = '#ff3b3b';
        dot(...r, 3.5);
        dot(...l, 3.5);
        dctx.fillStyle = '#fff';
        dot((r[0] + l[0]) / 2, (r[1] + l[1]) / 2, 3.5);
      }
      dctx.restore();
    }
    const d = settings.state.detected;
    debugText.textContent = [
      `source     ${source === 'tracking' ? 'webcam' : started ? 'rest position' : 'intro preview'} (${tracker.status})`,
      `render     ${renderStats.fps.toFixed(0)} fps`,
      `tracking   ${tracker.active ? `${tracker.stats.fps.toFixed(0)} fps · ${tracker.stats.detectMs.toFixed(1)} ms` : '—'}`,
      `eye        x ${fmt(eye.x)}  y ${fmt(eye.y)} cm`,
      `distance   ${eye.z.toFixed(1)} cm from screen`,
      `viewport   ${rect.w.toFixed(1)} × ${rect.h.toFixed(1)} cm`,
      `device     ${d.name ? d.name : 'unrecognized'}`,
    ].join('\n');
  }
  function dot(x, y, r) {
    dctx.beginPath();
    dctx.arc(x, y, r, 0, Math.PI * 2);
    dctx.fill();
  }

  // Keyboard shortcuts.
  addEventListener('keydown', (e) => {
    if (e.target.matches('input')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'd') toggleDebug();
    else if (k === 'f') toggleFullscreen();
    else if (k === 's') setPanel(!panel.classList.contains('open'));
    else if (k === 'r') room.shuffle();
    else if (k === 'escape') setPanel(false);
  });
}

function fmt(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}
