# Window VR

This recreates Johnny Chung Lee's Wii Remote head-tracking demo in the browser, using only the laptop's webcam. See [CONTEXT.md](CONTEXT.md) for the vocabulary.

## Run locally

```sh
python3 -m http.server 8765
# open http://localhost:8765  (camera access needs localhost or https)
```

It needs no build step. Three.js and MediaPipe load from jsdelivr, and the face model loads from Google's model storage.

## Controls

| Key | Action |
| --- | --- |
| `D` | Tracking view (webcam thumbnail, FPS, measured distance) |
| `F` | Fullscreen |
| `S` | Settings |
| `R` | Shuffle targets |

## Layout

- `js/tracking.js`: webcam and MediaPipe. It locates the Eye Point from the eye corners.
- `js/oneEuro.js`: smoothing and prediction.
- `js/deviceProfile.js`: Mac lookup table and generic fallback.
- `js/viewport.js`: where the Viewport sits on the Screen, and the off-axis projection.
- `js/targetRoom.js`: the Target Room scene.
- `js/settings.js`: settings storage and panel.
- `js/main.js`: frame loop, Fallback Control, and UI.

## Tuning notes

- **Checking the Device Profile:** open the tracking view (`D`), sit a measured distance from the screen, and compare it with the *distance* readout. If the readout is off, adjust *Webcam field of view*. The built-in values are estimates.
- **Center Stage:** on Macs whose cameras support it, turn Center Stage off (Control Center → Video Effects). It crops and pans the video, which breaks the geometry.
