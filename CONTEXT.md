# Window VR

A browser demo that turns a laptop screen into a window into a 3D scene. It tracks the viewer's eyes through the webcam and redraws the scene from their exact viewpoint, recreating Johnny Chung Lee's Wii Remote head-tracking demo without extra hardware.

## Language

### Tracking

**Eye Center**:
The fixed center of one eye socket, located from the eye corners rather than the iris, so it doesn't move when the viewer's gaze shifts.
_Avoid_: Pupil, iris position

**Eye Point**:
The 3D position of the midpoint between the two Eye Centers, measured in real-world units relative to the physical screen. It is the single viewpoint the scene is rendered from.
_Avoid_: Head position, camera position, eye position

**Eye Separation**:
The real-world distance between the two Eye Centers. It is assumed from a population average (adjustable), and its apparent size in the image is used to infer how far the viewer is from the screen.
_Avoid_: IPD (when meaning the socket-based measure)

**Tracking Lost**:
The state in which no face is currently being tracked (camera denied, unavailable, or face out of view). The viewer is always told when this is the case.

**Rest Position**:
The Eye Point used while in Tracking Lost after the demo has started: straight in front of the Viewport at a typical viewing distance. Only the webcam can move the Eye Point during the demo.

**Intro Preview**:
The start screen's backdrop, where the pointer (or an idle drift) steers the Eye Point to hint at the effect before the webcam is on. It never applies after the demo starts.
_Avoid_: Fallback control, mouse mode, manual mode

### Physical setup

**Screen**:
The physical display the viewer is looking at.
_Avoid_: Monitor, display, window

**Viewport**:
The rectangle of the Screen the scene is drawn in, which acts as the pane of glass. It is the whole Screen in fullscreen, and a smaller offset rectangle otherwise.
_Avoid_: Window, canvas, glass

**Device Profile**:
The set of physical constants the illusion depends on (Screen dimensions, webcam offset from the Screen, webcam field of view, Eye Separation). They are auto-detected where possible and can be overridden by the viewer in settings.
_Avoid_: Config, calibration data

**Recognized Device**:
A Device Profile matched to a known hardware model, so its constants are trusted.

**Unrecognized Device**:
A Device Profile that fell back to generic defaults because the hardware couldn't be identified. The viewer is prompted (without interruption) to check the settings.
_Avoid_: Unknown device, uncalibrated

### Content

**Scene**:
One switchable 3D environment shown through the window.

**Target Room**:
The Scene that recreates Lee's original demo: a deep gridded box behind the screen with floating bullseye targets, some of which protrude in front of the glass.
_Avoid_: Lee demo, grid scene
