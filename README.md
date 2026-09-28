# Spatial Kanban

**A kanban board you pin to your wall in mixed reality, where every card is something you can pick up.**

Open the page, press **Enter AR**, stick the board to a wall, lay it on your desk or leave it floating — then grab cards with your hands or controllers and move them between columns. The same board works as a 3D desktop view and as an accessible 2D board on devices without WebXR (for example iOS Safari).

**Live:** https://mneuffer-protogen.github.io/spatial-kanban/

The product and technical plan is in [PLAN.md](PLAN.md). This README covers what's built, how to run it, and how it's put together.

---

## Highlights

- **Anchor anywhere.** Wall, desk (tilted like a drafting table), or float. The ghost board snaps to detected surfaces: semantically labeled planes from Quest Space Setup first, then hit-test normals, then manual placement.
- **The board stays put.** On Meta Quest the board is saved with a persistent anchor and comes back where you left it. If the room changed, you get "Board not found here — place it again?", with the size and skin kept.
- **Direct manipulation.** Rays, pinch/grab, poke, touch and mouse all go through one pointer model. Pick up, drag, drop, tear a card off the board (pull it more than 12 cm away), park it in the room, throw it downward to archive it, or drop it on the bin. Create cards by pulling a blank one from the pad.
- **Two skins, switched live.** *Projects* is a clean, GitHub-style board. *Whiteboard* is glossy melamine with an aluminum frame, a marker tray, and paper sticky notes that peel, sway and slap down. Cards flip in a wave while the layout morphs between skins.
- **Text input in XR.** A 3D keyboard plus voice dictation (Web Speech API) where it's available.
- **Local-first.** Everything is saved to IndexedDB on this device, with undo/redo and JSON import/export.
- **Accessible.** The 2D board is fully keyboard- and screen-reader-operable. Labels always pair color with an icon, and there are high-contrast, reduced-motion and left-hand modes.
- **Fast.** Instanced card bodies, pills and shadows, and batched SDF text. A 16-card board draws in **about 50 draw calls and 25k triangles** in XR, including controller models (the budget is under 150 calls).

## Platform support

Features are detected at runtime (`isSessionSupported`, `session.enabledFeatures`). The app never sniffs user agents.

| Platform | Experience |
|---|---|
| Meta Quest 3 / 3S / Pro (Quest Browser) | `immersive-ar` passthrough, plane + hit-test snapping, persistent anchors, hands and controllers |
| Android Chrome (ARCore) | `immersive-ar` with a DOM-overlay HUD, hit-test placement, touch drag. The board is placed again each session |
| Apple Vision Pro (Safari) | `immersive-vr` in a calm virtual room, float placement, gaze + pinch through transient pointers |
| Desktop browsers | 3D view (orbit, drag cards with the mouse) and the 2D board |
| iOS Safari / no WebXR | 2D board and 3D view |

## Controls

| Action | Hands / controllers | Phone AR | Desktop 3D | 2D board |
|---|---|---|---|---|
| Pick up / move | Pinch or trigger on a card (ray), or grab nearby (grip) | Touch drag | Mouse drag | Drag, or Space then arrow keys |
| Card details | Quick tap (< 300 ms, < 1 cm up close; far rays allow a little more). Tap it again, or tap empty board, to close | Tap | Click | Click / Enter |
| Tear off, park in the room | Grab and pull > 12 cm further from the board than where you grabbed it | – | – | – |
| Return a parked card | Drag it back onto the board (a ray moves it at its own depth until it's over the board) | – | Details → Return to board | Details → Return to board |
| Archive | Drop on the bin, or throw a torn-off card downward | Drop on the bin | Drop on the bin | Details → Archive |
| New card | Pull from the pad, or tap it | Tap the pad | Drag or click the pad | "Add card" |
| Scroll a long column (Projects) | Thumbstick while hovering | Swipe | Wheel | Scroll |
| Reorder columns | Drag a column header sideways | Same | Same | Column menu |
| Move / resize the board | Drag the bar under the board / the corner | Same | – | – |
| Menu (skins, size, settings, exit) | "Menu" on the board | HUD buttons | Top bar | Top bar |

Press **?** in the 2D or 3D view for in-app help. Undo and redo are **⌘Z** and **⇧⌘Z**.

## Getting started

Requirements: Node 22+ (CI uses Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
```

On `localhost` without a headset, the dev build **emulates a Meta Quest 3 in a synthetic office** using Meta's IWER, so you can walk through the whole XR flow in a desktop browser: **Enter AR → Wall → point at a wall → trigger**. Two options:

- `?room=living_room`: choose another synthetic room (`office_small`, `office_large`, `meeting_room`, `living_room`, `music_room`).
- `?devui=0`: hide the emulator panel so a script can drive controller poses directly.
- `?emulate=0`: turn emulation off.

### On a Quest

WebXR needs a secure context. Either:

```bash
adb reverse tcp:5173 tcp:5173   # then open http://localhost:5173 in Quest Browser
```

or serve HTTPS on your LAN with a self-signed certificate:

```bash
npm run dev:https               # https://<your-ip>:5173
```

Run **Space Setup** on the Quest first so walls and tables have semantic labels. Without it, snapping falls back to hit-test normals.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `dev:https` | Vite dev server (plain HTTP or self-signed HTTPS) |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript project build, no emit |

## Architecture

```
Platform  ─ WebXR session (ref spaces, hit test, anchors, planes, hands) · DOM / desktop 3D
Input     ─ unified pointer events (@pmndrs/pointer-events): ray, grab, poke, touch, mouse
Spatial   ─ placement & snapping · anchor manager · surface registry
Board     ─ layout engine (pure, meters) · drag state machine (pure) · springs
Present   ─ active skin (surface, cards, motion, sound) · 3D menus & panels · 2D UI
Data      ─ Zustand store (serializable actions, Immer patches, undo) · IndexedDB (Dexie)
```

The key decisions follow [PLAN §8](PLAN.md#8-architecture):

1. **Board space is 2D, in meters.** Layout, hit testing and drop logic are pure functions over `(u, v)`, with origin at the top-left and v pointing down. The only 3D transform is the board root, which comes from anchor × offset. That's why the hard logic has unit tests without a headset.
2. **The store is the single source of truth.** Drag previews are transient view state, and only the drop becomes a `card/move` action.
3. **Actions are small and serializable** (`card/create`, `card/move`, `column/move`, …). Immer patches drive undo/redo and incremental persistence: each save writes only the entities a patch touched.
4. **Placement is per device.** A `Placement` record (anchor handle, mode, size, skin, anchor → board offset) is stored under a device id and is never shared as spatial truth.
5. **Capabilities drive features.** Everything optional is requested as optional and then read back from `enabledFeatures`.

### Rendering

A skin never creates one mesh per card. Per frame, a shared driver (`board/cardFrames.ts`) computes each card's target from the layout and the drag state, then steps a spring per card. Everything runs in `useFrame`, outside React. The skin writes the results into:

- `ChipBatch`: instanced rounded rectangles for card bodies, lanes, pills, avatars and dots. Each instance gets its own size and corner radius (corner-parametrized geometry, so corners never stretch), plus a per-instance clip range for scrolling columns.
- `PaperBatch`: instanced sticky notes with a vertex-shader curl (a resting corner curl and a peel while grabbed). The dragged note stays in the batch.
- `ShadowBatch`: instanced soft contact-shadow blobs that grow with lift. There are no shadow maps.
- `TextBatch`: troika `BatchedText`, so all SDF text in a layer takes one draw call.

Invisible per-card hit proxies take pointer events, so hands (sphere intersection), pokes and rays all work the same way. Proxies are clipped to their column's scroll viewport and switched off through pointer-events (three's `visible` does not stop raycasts). The board surface sits below everything else in pointer-events order, so a grab sphere that reaches both a card and the board picks the card. Hover is tracked per pointer, and each controller's thumbstick scrolls the column its own ray is over.

### Project layout

```
src/
  app/          App shell, 3D scene, persistence wiring, styles
  data/         model, store + actions, ordering, seed, placements, settings, Dexie
  board/        space math, layout types, drag reducer, animator, card driver, interaction
  skins/        skin interface, registry, projects/, whiteboard/
  render/       chips, paper, shadows, text batches, marker strokes, fonts
  xr/           session store, capabilities, anchors, surfaces, placement/, handles, phone HUD, emulator
  ui/           flat/ (2D board, drawer, dialogs), xr/ (3D panels, keyboard), toasts
  fx/           procedural WebAudio sounds, haptics
tests/unit/     ordering, store, layout (both skins), drag, snapping, persistence
```

## Plan coverage

**Phase 0 (spike): complete.** HTTPS scaffold, `immersive-ar` with passthrough, a hit-test reticle that tells walls from desks, and anchor create / persist / restore.

**Phase 1 (MVP): complete.**
- Data model, store and Dexie persistence
- Layout engine and the Projects skin
- Wall, desk and float placement with ghost preview, plane-edge snapping and smoothing
- Move, resize and re-place the board, with re-anchoring after moves over 1 m
- Drag within and between columns with hysteresis, insertion gaps and WIP feedback
- Detail panel in XR, 2D fallback board, capability detection with fallbacks

**Phase 2 (tactile and skins): complete, with the simplifications listed below.**
- Whiteboard skin: curl shader, seeded jitter, peel, sway, slap and squash, marker strokes, procedural paper sounds
- Live skin switching with a flip-and-morph animation, remembered per placement
- Creating cards in XR from the pad, with a 3D keyboard and voice dictation
- Tear off, park and return cards; throw to archive; the done bin
- Haptics, audio and reduced-motion mode
- Phone AR DOM-overlay HUD

**Phase 3 (Yjs sync, accounts, GitHub Projects sync) and Phase 4: not started.** The action log and patch stream are the intended seams for these.

### Deliberate deviations from the plan

| Plan | Built | Why |
|---|---|---|
| Tap threshold 150 ms | 300 ms | Pinches on Quest routinely take longer than 150 ms, which made opening details unreliable |
| Tap threshold 1 cm | 1 cm for hands, grabs and pokes; about 1.1° of ray angle (1–6 cm) for far rays, a smaller angle for the mouse | Hand tremor and the pinch itself sweep a far ray several centimetres across the board |
| `@react-three/uikit`, `@react-three/handle` | Small custom 3D UI kit and handle logic | Fewer moving parts and full control over the look and hit areas |
| Skin `Card` component per card | Skin `Cards` layer that renders all cards | Required by the instancing and batching budget (PLAN §12) |
| Free cards get their own anchors | Parked cards are stored relative to the board | They persist and restore together with the board anchor, which is simpler and more robust |
| Whiteboard "loose" freeform offsets | Not built | Open question 3 in the plan. Column membership stays canonical |
| Two-handed scale/rotate, room mode, marker drawing | Not built | Listed as stretch goals in the plan |
| Playwright + IWER end-to-end tests | Manual IWER runs during development, plus unit tests in CI | Planned next step, see Testing |

## Testing

- `npm test` runs 75 unit tests: fractional ordering, store actions and undo/redo, both skin layouts (gaps, WIP counts, scroll, stacking, jitter), the drag state machine (tap, distance-scaled tap slop, drag, tear-off hysteresis, parked cards, throw to archive, pad, bin), pointer projection (ray/plane, grazing rays, grab positions), selection, snapping math (normal classification, wall/desk/float poses, edge snapping, smoothing), and persistence round-trips on fake IndexedDB.
- **XR in the browser:** `npm run dev`, then use the IWER emulator. With `?devui=0`, a script can drive `xrStore.getState().emulator.controllers.right`.
- **On device:** Quest 3 over `adb reverse`, with remote debugging at `chrome://inspect`.

> Status: verified in desktop browsers and in the IWER Quest 3 emulator (placement on a detected wall, anchoring, persistent-anchor restore, ray drag, grip tear-off, menus, skin switching). It has not yet been tested on physical Quest, Android or Vision Pro hardware. Run the device checklist in [PLAN §15](PLAN.md#15-testing-strategy) before relying on it.

## Deployment

GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) type-checks, tests and builds every push and pull request. Pushes to `main` deploy to GitHub Pages; the base path comes from the repository name.
