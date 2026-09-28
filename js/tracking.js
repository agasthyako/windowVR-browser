// Webcam head tracking: finds the Eye Point in Screen space (cm).
//
// Screen space: origin at the Screen's center, x right and y up (as the
// viewer sees it), z out of the Screen towards the viewer.

const MP_VERSION = '1.0.1';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Eye corners in the MediaPipe face mesh. Eye Centers come from the corners,
// not the irises, so they stay put when the viewer's gaze moves.
const R_OUTER = 33, R_INNER = 133, L_INNER = 362, L_OUTER = 263;
export const EYE_CORNERS = [R_OUTER, R_INNER, L_INNER, L_OUTER];

let landmarkerPromise = null;

// Safe to call early: downloads the model while the start screen is showing.
export function preloadLandmarker() {
  landmarkerPromise ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      return await make('GPU');
    } catch (err) {
      console.warn('GPU face tracking unavailable, using CPU', err);
      return make('CPU');
    }
  })();
  landmarkerPromise.catch(() => {
    landmarkerPromise = null; // allow a retry
  });
  return landmarkerPromise;
}

// status: 'off' | 'loading' | 'denied' | 'nocamera' | 'error' | 'noface' | 'tracking'
export class Tracker {
  constructor({ getProfile, onSample, onStatus }) {
    this.getProfile = getProfile;
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.status = 'off';
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastFaceAt = 0;
    this.lastLandmarks = null;
    this.stats = { detectMs: 0, fps: 0 };
    this._frames = 0;
    this._fpsT = performance.now();
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  get active() {
    return !!this.video.srcObject;
  }

  async start() {
    if (this.active || this.status === 'loading') return;
    this.setStatus('loading');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 },
        },
      });
    } catch (err) {
      const name = err?.name;
      this.setStatus(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera'
            : 'error',
      );
      return;
    }
    try {
      this.landmarker = await preloadLandmarker();
    } catch (err) {
      console.error(err);
      stream.getTracks().forEach((t) => t.stop());
      this.setStatus('error');
      return;
    }
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      this.video.srcObject = null;
      this.setStatus('nocamera');
    });
    this.setStatus('noface');
    this.loop();
  }

  loop() {
    const v = this.video;
    const next = () => {
      if (!v.srcObject) return;
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this.frame(next));
      else requestAnimationFrame(() => this.frame(next));
    };
    next();
  }

  frame(next) {
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      let result;
      try {
        result = this.landmarker.detectForVideo(v, t0);
      } catch (err) {
        console.error(err);
      }
      const t1 = performance.now();
      this.stats.detectMs += (t1 - t0 - this.stats.detectMs) * 0.1;
      this._frames++;
      if (t1 - this._fpsT > 500) {
        this.stats.fps = (this._frames * 1000) / (t1 - this._fpsT);
        this._frames = 0;
        this._fpsT = t1;
      }

      const lm = result?.faceLandmarks?.[0];
      if (lm) {
        this.lastFaceAt = t1;
        this.lastLandmarks = lm;
        const eye = this.eyePoint(lm);
        if (eye) {
          this.setStatus('tracking');
          this.onSample(eye, t0 / 1000);
        }
      } else {
        this.lastLandmarks = null;
        if (t1 - this.lastFaceAt > 500) this.setStatus('noface');
      }
    }
    next();
  }

  // Eye Point from face landmarks, using the Device Profile's physical constants.
  eyePoint(lm) {
    const p = this.getProfile();
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (!W || !H) return null;

    // The FOV setting is for a 16:9 stream. A narrower stream (e.g. 4:3) is
    // usually a crop of the same sensor at the same height.
    const aspect = W / H;
    let tanHalf = Math.tan((p.camFovDeg * Math.PI) / 360);
    if (aspect < 16 / 9) tanHalf *= aspect / (16 / 9);
    const f = W / 2 / tanHalf; // focal length in pixels

    const pt = (i) => [lm[i].x * W, lm[i].y * H, lm[i].z * W];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const right = mid(pt(R_OUTER), pt(R_INNER));
    const left = mid(pt(L_INNER), pt(L_OUTER));
    const c = mid(right, left);

    // 3D distance between Eye Centers: including depth keeps it stable when the head turns.
    const sepPx = Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
    if (sepPx < 1) return null;

    const z = (f * p.eyeSeparationCm) / sepPx;
    // The raw camera image is un-mirrored: moving to your right moves you left in it.
    const x = (-(c[0] - W / 2) * z) / f;
    const y = (-(c[1] - H / 2) * z) / f;

    return {
      x: p.camXCm + x,
      y: p.screenHeightCm / 2 + p.camYCm + y,
      z,
    };
  }
}
