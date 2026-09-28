// One Euro filter (Casiez et al. 2012): adaptive low-pass that smooths hard
// when the signal is still and follows closely when it moves fast.
// Also exposes the filtered derivative, which we use for prediction.

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1, beta = 0.1, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  // t in seconds
  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

// Filters a 3D point and predicts where it will be at a later time.
export class PointFilter {
  constructor() {
    this.axes = [new OneEuro(), new OneEuro(), new OneEuro()];
    this.t = null;
  }

  configure({ minCutoffXY, minCutoffZ, beta }) {
    this.axes[0].minCutoff = minCutoffXY;
    this.axes[1].minCutoff = minCutoffXY;
    this.axes[2].minCutoff = minCutoffZ;
    for (const a of this.axes) a.beta = beta;
  }

  reset() {
    for (const a of this.axes) a.reset();
    this.t = null;
  }

  push(p, t) {
    this.axes[0].filter(p.x, t);
    this.axes[1].filter(p.y, t);
    this.axes[2].filter(p.z, t);
    this.t = t;
  }

  // Extrapolate along the filtered velocity. `lead` is how far past the
  // last sample to look (seconds), already clamped by the caller.
  predict(lead, out) {
    const [ax, ay, az] = this.axes;
    out.x = ax.x + ax.dx * lead;
    out.y = ay.x + ay.dx * lead;
    out.z = az.x + az.dx * lead;
    return out;
  }
}
