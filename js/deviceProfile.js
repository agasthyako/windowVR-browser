// Works out the Device Profile: the physical constants the illusion needs.
//
// Browsers can't report the hardware model or physical screen size, but every
// Apple laptop panel has a distinctive set of "looks like" resolutions. We key
// on CSS size × devicePixelRatio (the backing-store size), which is unaffected
// by browser zoom, and match it against the known scaled modes of each panel.

// camY: webcam height relative to the Screen's top edge, cm (+ above, − inside the notch)
// fov: webcam horizontal field of view for a 16:9 stream, degrees (estimate)
const MODELS = [
  {
    id: 'mbp14', name: 'MacBook Pro 14″ (2021+)', diag: 14.2, native: [3024, 1964],
    looks: [[1024, 665], [1147, 745], [1312, 852], [1512, 982], [1800, 1169]],
    camY: -0.35, fov: 70,
  },
  {
    id: 'mbp16', name: 'MacBook Pro 16″ (2021+)', diag: 16.2, native: [3456, 2234],
    looks: [[1168, 755], [1312, 848], [1496, 967], [1728, 1117], [2056, 1329]],
    camY: -0.35, fov: 70,
  },
  {
    id: 'mba13n', name: 'MacBook Air 13″ (M2 and later)', diag: 13.6, native: [2560, 1664],
    looks: [[1024, 666], [1280, 832], [1470, 956], [1710, 1112]],
    camY: -0.35, fov: 70,
  },
  {
    id: 'mba15', name: 'MacBook Air 15″', diag: 15.3, native: [2880, 1864],
    looks: [[1280, 828], [1440, 932], [1710, 1112], [1920, 1243]],
    camY: -0.35, fov: 70,
  },
  {
    id: 'mb13', name: 'MacBook Air / Pro 13″ (2016–2022)', diag: 13.3, native: [2560, 1600],
    looks: [[1024, 640], [1280, 800], [1440, 900], [1680, 1050]],
    camY: 0.8, fov: 58, gpu: /Apple M/i,
  },
  {
    id: 'mbp15', name: 'MacBook Pro 15″ (2016–2019)', diag: 15.4, native: [2880, 1800],
    looks: [[1024, 640], [1280, 800], [1440, 900], [1680, 1050], [1920, 1200]],
    camY: 0.8, fov: 58, gpu: /AMD|Radeon/i,
  },
  {
    id: 'mbp16i', name: 'MacBook Pro 16″ (2019)', diag: 16.0, native: [3072, 1920],
    looks: [[1152, 720], [1344, 840], [1536, 960], [1792, 1120], [2048, 1280]],
    camY: 0.9, fov: 58,
  },
];

// Averages that apply to anyone.
export const EYE_SEPARATION_CM = 6.3;

// Across common laptop and desktop setups at their default OS scaling, one CSS
// pixel comes out close to 0.023 cm, so this is a decent guess when unmatched.
const GENERIC_CM_PER_CSS_PX = 0.0233;

function panelSizeCm(diagIn, [nw, nh]) {
  const aspect = nw / nh;
  const hIn = diagIn / Math.sqrt(1 + aspect * aspect);
  return { w: hIn * aspect * 2.54, h: hIn * 2.54 };
}

function gpuRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

// A stable key for "this particular Screen", used to store per-screen overrides.
export function screenKey() {
  const dpr = window.devicePixelRatio || 1;
  return `${Math.round(screen.width * dpr)}x${Math.round(screen.height * dpr)}`;
}

export function detectDevice() {
  const dpr = window.devicePixelRatio || 1;
  const bw = screen.width * dpr;
  const bh = screen.height * dpr;
  const near = (a, b) => Math.abs(a - b) <= 4;

  let candidates = MODELS.filter((m) =>
    m.looks.some(([w, h]) => near(bw, w * 2) && near(bh, h * 2)),
  );

  // Several panels share scaled modes; the GPU name can sometimes split them.
  if (candidates.length > 1) {
    const gpu = gpuRenderer();
    const narrowed = candidates.filter((m) => m.gpu && m.gpu.test(gpu));
    if (narrowed.length === 1) candidates = narrowed;
  }

  if (candidates.length >= 1) {
    const m = candidates[0];
    const { w, h } = panelSizeCm(m.diag, m.native);
    return {
      recognized: candidates.length === 1,
      name: candidates.length === 1 ? m.name : `${m.name}?`,
      profile: {
        screenWidthCm: round2(w),
        screenHeightCm: round2(h),
        camXCm: 0,
        camYCm: m.camY,
        camFovDeg: m.fov,
        eyeSeparationCm: EYE_SEPARATION_CM,
      },
    };
  }

  return {
    recognized: false,
    name: null,
    profile: {
      screenWidthCm: round2(screen.width * GENERIC_CM_PER_CSS_PX),
      screenHeightCm: round2(screen.height * GENERIC_CM_PER_CSS_PX),
      camXCm: 0,
      camYCm: 1.0,
      camFovDeg: 60,
      eyeSeparationCm: EYE_SEPARATION_CM,
    },
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Phones and tablets are out of scope: block anything without a fine pointer.
export function isHandheld() {
  const uaMobile = navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); // iPadOS desktop mode
  const noFinePointer = !matchMedia('(any-pointer: fine)').matches;
  return uaMobile || noFinePointer;
}
