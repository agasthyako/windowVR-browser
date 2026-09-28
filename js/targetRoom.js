// The Target Room: Johnny Chung Lee's gridded box behind the Screen, with
// bullseye targets on stalks, a few floating in front of the glass.
//
// Viewport space (cm): origin at the Viewport's center, the glass at z = 0,
// the room extends to z = -depth.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const GRID_COLOR = 0x8f9bbd;
const WALL_COLOR = 0x0c1020;
const IN_ROOM = 10;
const POP_OUT = 3;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bullseyeTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rings = ['#e8202a', '#ffffff', '#e8202a', '#ffffff', '#e8202a'];
  rings.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(size / 2, size / 2, (size / 2) * (1 - i / rings.length), 0, Math.PI * 2);
    g.fill();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function shadowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export class TargetRoom {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.Fog(0x000000, 50, 200);

    this.lineMaterial = new LineMaterial({ color: GRID_COLOR, linewidth: 1.2, fog: true });
    this.stalkMaterial = new LineMaterial({ color: 0xd8def0, linewidth: 1.1, fog: true });
    this.wallMaterial = new THREE.MeshBasicMaterial({ color: WALL_COLOR, side: THREE.DoubleSide });
    // Just above 1.0 so the bloom pass catches the targets' white rings and nothing else.
    this.targetMaterial = new THREE.MeshBasicMaterial({
      map: bullseyeTexture(),
      color: new THREE.Color(1.05, 1.05, 1.05),
      toneMapped: false,
    });
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: shadowTexture(),
      transparent: true,
      depthWrite: false,
    });
    this.discGeometry = new THREE.CircleGeometry(1, 64);
    this.shadowGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

    this.static = new THREE.Group();
    this.targets = new THREE.Group();
    this.scene.add(this.static, this.targets);

    this.size = { w: 30, h: 19, depth: 45 };
    this.seed = 1;
    this.layout = this.makeLayout(this.seed);
  }

  setResolution(w, h) {
    this.lineMaterial.resolution.set(w, h);
    this.stalkMaterial.resolution.set(w, h);
  }

  setSize(w, h, depth) {
    const s = this.size;
    if (Math.abs(s.w - w) < 0.01 && Math.abs(s.h - h) < 0.01 && s.depth === depth && this.built) return;
    this.size = { w, h, depth };
    this.built = true;
    this.buildRoom();
    this.buildTargets();
  }

  shuffle() {
    this.seed = (Math.random() * 1e9) | 0;
    this.layout = this.makeLayout(this.seed);
    this.buildTargets();
  }

  // Positions are stored normalized so resizing the window doesn't reshuffle.
  makeLayout(seed) {
    const rnd = mulberry32(seed);
    const out = [];
    // Space targets apart as seen from straight ahead (nominal 14" room, eye at 55 cm),
    // so they don't pile up on top of each other in the picture.
    const N = { w: 30, h: 19, depth: 45 }, E = 55;
    const fits = (t) => {
      const a = this.place(t, N);
      const pa = E / (E - a.z);
      return out.every((o) => {
        const b = this.place(o, N);
        const pb = E / (E - b.z);
        return Math.hypot(a.x * pa - b.x * pb, a.y * pa - b.y * pb) > (a.r * pa + b.r * pb) * 1.3;
      });
    };
    const add = (make, count) => {
      for (let n = 0, tries = 0; n < count && tries < 800; tries++) {
        const t = make();
        if (fits(t)) out.push(t), n++;
      }
    };
    add(() => ({
      pop: false,
      u: rnd() * 2 - 1,
      v: rnd() * 1.6 - 0.75,
      d: 0.08 + rnd() * 0.85,
      r: 0.8 + rnd() * 0.45,
    }), IN_ROOM);
    // Pop-outs stay in a central zone so they aren't cut off by the Viewport's edge.
    add(() => ({
      pop: true,
      u: (rnd() * 2 - 1) * 0.38,
      v: (rnd() * 2 - 1) * 0.3 + 0.05,
      d: 0.12 + rnd() * 0.22, // fraction of the Viewport width in front of the glass
      r: 0.6 + rnd() * 0.25,
    }), POP_OUT);
    return out;
  }

  // Where a normalized target sits in a room of the given size (cm).
  place(t, { w, h, depth: D }) {
    const r = w * 0.045 * t.r;
    const floorY = -h / 2;
    return {
      r,
      x: t.u * (w / 2 - r * 1.4),
      y: t.pop ? t.v * h : clampRange(t.v * (h / 2), floorY + r * 1.6, h / 2 - r * 1.4),
      z: t.pop ? t.d * w : -t.d * D,
    };
  }

  buildRoom() {
    disposeChildren(this.static);
    const { w, h, depth: D } = this.size;
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
    const cell = w / 10;
    const xs = steps(x0, x1, Math.round(w / cell));
    const ys = steps(y0, y1, Math.max(2, Math.round(h / cell)));
    const zs = steps(-D, 0, Math.max(2, Math.round(D / cell)));

    const p = [];
    const seg = (a, b) => p.push(...a, ...b);
    for (const y of [y0, y1]) {           // floor and ceiling
      for (const x of xs) seg([x, y, 0], [x, y, -D]);
      for (const z of zs) seg([x0, y, z], [x1, y, z]);
    }
    for (const x of [x0, x1]) {           // side walls
      for (const y of ys) seg([x, y, 0], [x, y, -D]);
      for (const z of zs) seg([x, y0, z], [x, y1, z]);
    }
    for (const y of ys) seg([x0, y, -D], [x1, y, -D]); // back wall
    for (const x of xs) seg([x, y0, -D], [x, y1, -D]);

    const grid = new LineSegments2(new LineSegmentsGeometry().setPositions(p), this.lineMaterial);
    grid.userData.ownsGeometry = true;
    this.static.add(grid);

    // Dark wall surfaces, nudged outward so grid lines never z-fight with them.
    const e = 0.05;
    const wall = (width, height, pos, rotX = 0, rotY = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.wallMaterial);
      m.position.set(...pos);
      m.rotation.set(rotX, rotY, 0);
      m.userData.ownsGeometry = true;
      this.static.add(m);
    };
    wall(w, D, [0, y0 - e, -D / 2], -Math.PI / 2);
    wall(w, D, [0, y1 + e, -D / 2], Math.PI / 2);
    wall(D, h, [x0 - e, 0, -D / 2], 0, Math.PI / 2);
    wall(D, h, [x1 + e, 0, -D / 2], 0, -Math.PI / 2);
    wall(w, h, [0, 0, -D - e]);
  }

  buildTargets() {
    disposeChildren(this.targets);
    const { w, h, depth: D } = this.size;
    const stalks = [];
    const floorY = -h / 2;

    for (const t of this.layout) {
      const { x, y, z, r } = this.place(t, this.size);

      const disc = new THREE.Mesh(this.discGeometry, this.targetMaterial);
      disc.position.set(x, y, z);
      disc.scale.setScalar(r);
      this.targets.add(disc);
      stalks.push(x, y, z - 0.02, x, y, -D);

      if (!t.pop) {
        // Soft contact shadow on the floor: larger and fainter the higher the target.
        const lift = (y - floorY) / h;
        const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial.clone());
        shadow.material.opacity = 0.85 * (1 - 0.55 * lift);
        shadow.position.set(x, floorY + 0.02, z);
        shadow.scale.setScalar(r * (1.1 + 1.2 * lift));
        shadow.renderOrder = 1;
        shadow.userData.ownsMaterial = true;
        this.targets.add(shadow);
      }
    }
    const stalkLines = new LineSegments2(new LineSegmentsGeometry().setPositions(stalks), this.stalkMaterial);
    stalkLines.userData.ownsGeometry = true;
    this.targets.add(stalkLines);
  }

  // Fade the far end of the room into darkness, relative to the viewer's distance.
  update(eyeZ) {
    const D = this.size.depth;
    this.scene.fog.near = eyeZ + D * 0.1;
    this.scene.fog.far = eyeZ + D * 1.9 + 15;
  }
}

function steps(a, b, n) {
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

function clampRange(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// Removes every child, freeing only what it owns (marked in userData).
function disposeChildren(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child.userData.ownsGeometry) child.geometry.dispose();
    if (child.userData.ownsMaterial) child.material.dispose();
  }
}
