// Where the Viewport (the pane of glass) physically sits on the Screen, and
// the off-axis projection that makes it behave like real glass.

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// Returns the Viewport rectangle in Screen space (cm): center (cx, cy), size (w, h).
export function viewportRect(profile) {
  const sw = screen.width;
  const sh = screen.height;
  const kx = profile.screenWidthCm / sw;
  const ky = profile.screenHeightCm / sh;
  const vw = Math.min(innerWidth, sw);
  const vh = Math.min(innerHeight, sh);

  let left, top;
  if (isFullscreen()) {
    left = (sw - vw) / 2;
    top = (sh - vh) / 2;
  } else {
    // Browser chrome is assumed to sit on top, with equal thin side borders.
    const border = Math.max(0, (outerWidth - innerWidth) / 2);
    const chromeTop = Math.max(0, outerHeight - innerHeight - border);
    const originX = screen.left ?? 0; // Chrome: this display's origin in desktop coords
    const originY = screen.top ?? 0;
    left = window.screenX - originX + border;
    top = window.screenY - originY + chromeTop;
    left = clamp(left, 0, sw - vw);
    top = clamp(top, 0, sh - vh);
  }

  const x0 = (left - sw / 2) * kx;
  const y0 = (sh / 2 - top) * ky;
  const w = vw * kx;
  const h = vh * ky;
  return { cx: x0 + w / 2, cy: y0 - h / 2, w, h };
}

// Positions `camera` at the eye (given relative to the Viewport's center, cm)
// with an asymmetric frustum whose edges pass exactly through the Viewport's edges.
export function applyOffAxis(camera, eye, w, h, near = 1, far = 5000) {
  const ez = Math.max(eye.z, 5);
  const s = near / ez;
  camera.position.set(eye.x, eye.y, ez);
  camera.quaternion.identity();
  camera.near = near;
  camera.far = far;
  camera.projectionMatrix.makePerspective(
    (-w / 2 - eye.x) * s,
    (w / 2 - eye.x) * s,
    (h / 2 - eye.y) * s,
    (-h / 2 - eye.y) * s,
    near,
    far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
