# Audio Punch

A mixing desk for your browser. Route any tab's audio through a live Web Audio
chain — EQ, dynamics, space, filters and pitch — from a full-screen panel that
drops over the page, driven almost entirely by the keyboard.

Chrome and Edge (Manifest V3). The core is browser-agnostic behind a platform
adapter; see [Firefox](#firefox-and-safari) below.

---

## What it does

- **Per-site processing.** Every page that plays audio gets its own card: level
  with up to 600% boost, pan, mute and a full module rack. Settings are saved
  per origin (`https://youtube.com`), so a site sounds the way you left it.
- **A global chain.** Turn it on and one chain drives every tab. Turn it off and
  each site returns to exactly what it had. Any site can be pinned to keep its
  own chain while global runs.
- **Your own backdrop.** Point it at an image or a video and the mixer renders
  over it, with dim and blur controls so the interface stays legible.
- **Templates.** Save the modules you have engaged under a name, apply it to
  global or to one site, and remove it to get back precisely what was there
  before. Eight are built in.
- **Metering.** A signal meter on every source card so you can see which tab is
  making noise, and a gain-reduction readout on the compressor and limiter so
  they can be set by eye rather than by guess.
- **Keyboard first.** Four browser-level shortcuts, plus a full rebindable map
  inside the mixer.

### Modules

| Group | Modules |
|---|---|
| Core | Level (0–600%), pan, mute, 10-band graphic EQ, bass/treble shelves |
| Dynamics | Compressor, brick-wall limiter, noise gate |
| Space | Convolution reverb, delay (with ping-pong), mid/side stereo width, mono fold |
| Time | Resonant high-pass / low-pass sweep, phase-vocoder pitch shift, playback speed |

Pitch shifting is a real phase vocoder: ±12 semitones with the tempo left alone.
Speed is separate and does change the tempo.

---

## Install

```bash
npm install
npm run build          # → dist/chrome
```

Then in Chrome: **chrome://extensions** → enable **Developer mode** → **Load
unpacked** → choose `dist/chrome`.

`npm run dev` rebuilds on change; click reload on the extension card to pick
changes up.

---

## Using it

Press **Alt+Shift+A** on a page that is playing something. The mixer drops over
the page; press it again, or Esc, to dismiss it. Nothing needs arming — audio is
routed the moment a player appears.

The cards list the global bus and every page making sound. Each carries its own
level slider, so the common adjustment takes one drag. Click a card to select it
and the module rack below follows, which is how you reach any tab — or global —
from any tab's overlay. Drag the grip at the bottom edge to resize the panel;
double-click it to fill the window again.

### Shortcuts

Four work anywhere, with nothing on screen (rebind at
`chrome://extensions/shortcuts`):

| | |
|---|---|
| `Alt+Shift+A` | Show / hide the mixer |
| `Alt+Shift+G` | Global chain on / off |
| `Alt+Shift+M` | Mute every tab |
| `Alt+Shift+B` | Bypass all processing |

The browser allows an extension only four of those. Everything else is handled
inside the mixer while it has focus — which is also why these never collide with
a site's own shortcuts. Press `?` in the mixer for the full list, or rebind any
of them under **Shortcuts** in the dashboard.

| | |
|---|---|
| `[` `]` | Previous / next source |
| `` ` `` | Jump to global |
| `↑` `↓` | Level (hold `Shift` for fine) |
| `←` `→` | Select EQ band |
| `Alt+↑` `Alt+↓` | Boost / cut that band |
| `m` `b` `i` | Mute · bypass · pin off global |
| `e t f c l g r d w p s` | Toggle each module |
| `Ctrl+1`…`Ctrl+9` | Apply template 1–9 |
| `Ctrl+0` | Remove the applied template |
| `Backspace` · `Esc` | Reset this source · close |

### The dashboard

Reachable from the ⤢ button, or as the extension's options page. Same mixer plus
the things that need room: the template library, the shortcut editor, your saved
sites, and export/import. It also works on pages the overlay cannot reach.

---

## How the audio is captured, and what that costs

Audio Punch routes the page's own `<audio>` and `<video>` elements into Web
Audio with `createMediaElementSource`. It does **not** use `chrome.tabCapture`.

That choice decides most of the limitations, so it is worth being plain about
both sides:

**What this buys**

- No "sharing this tab" indicator. Tab capture shows one permanently, and no
  extension can suppress it.
- DRM playback keeps working. Under tab capture, Netflix and Spotify go silent.
- Nothing to arm. No user gesture, no per-tab permission, no switching tabs.
- No added latency, and fullscreen video is untouched.

**What it costs**

- **Sites that generate audio entirely through Web Audio are silent to it** —
  browser games, some web players and DAWs. There is no media element to route,
  so nothing reaches the graph.
- **Cross-origin media served without CORS headers routes as silence.** Nothing
  throws; the page just goes quiet. The mixer detects this and labels the source
  **No signal** rather than letting it look like a broken extension.

**Other limits, which are the platform's rather than ours**

- **The overlay cannot open** on `chrome://` pages, the Web Store, the PDF
  viewer or a blank new tab. Use the dashboard there.
- **Routing an element is irreversible.** `createMediaElementSource` cannot be
  undone for the life of that element, so "off" flattens the graph to a clean
  pass-through rather than tearing it down — tearing it down would silence the
  page permanently.
- **Speed needs a real media element.** It is applied to the element, not in the
  audio graph. The control disables itself and says why when there is none.
- **Settings live in `chrome.storage.local`, not `localStorage`.**
  `localStorage` is per-origin and could not be shared between tabs.

### Permissions

`storage`, `unlimitedStorage` (backdrop videos), `tabs`, `scripting`,
`downloads`, and host access to run the content script. No `tabCapture`, no
`offscreen`, no `activeTab`.

---

## How it is put together

Three runtime contexts and one typed message protocol (`src/shared/messages.ts`):

```
content script (every http/https tab)   engine · overlay · keymap · playbackRate
        │  port + messages
service worker                          settings · tabs · resolution   ← the only source of truth
        │  port
dashboard (extension page)              full desk · templates · import/export
```

The service worker owns all state and resolves which chain each origin should
hear; the content scripts run the audio and report levels back. Both UI surfaces
send intents and render the snapshot they get back, which is what keeps them —
and the global card inside each — consistent without a second implementation.

| Path | What lives there |
|---|---|
| `src/shared/` | Types, parameter ranges, defaults, migration, presets |
| `src/platform/` | The only browser-API-aware layer |
| `src/background/` | Settings store, tab registry, chain resolution, commands |
| `src/engine/` | The audio graph, DSP modules and AudioWorklets |
| `src/content/` | Engine host, shadow-DOM overlay, keyboard map, media control |
| `src/ui/` | Store, controls and views, shared by both surfaces |
| `src/dashboard/` | The full desk page |

Details worth knowing before editing:

- **Modules are unlinked, not neutralised.** An unengaged reverb is disconnected
  from the graph entirely, so it costs nothing. `PageGraph.apply` relinks only
  when the *set* of active modules changes; moving a slider never touches the
  topology.
- **The rack is built once per source and updated in place.** Rebuilding it on
  every broadcast would tear a slider out from under the pointer mid-drag.
- **The CSS reset is wrapped in `:where()` on purpose.** Written plainly,
  `.ap-root button` scores (0,1,1) and silently beats every single-class button
  component in the sheet.
- **The backdrop is stored under its own key**, never inside `Settings`, which is
  broadcast to every surface on each slider movement.
- **The hot paths are deliberately quiet.** Metering is a one-way
  `content:level` message at ~24Hz that triggers no chain resolve, no reply and
  no state broadcast; media-element lookups read a cache refreshed by a
  debounced observer rather than walking the DOM; the worker coalesces the
  fan-out a mutation causes; and identical chains are never re-sent or
  re-applied. Undoing any of these turns a slider drag into a per-frame storm.
- **Reverb impulses are rebuilt on a settle timer.** Generating one fills up to
  six seconds of stereo noise, which is not something to do per animation frame
  while the size slider moves.

---

## Development

```bash
npm run check          # tsc --noEmit across all three contexts
npm test               # unit tests (node:test)
npm run build          # → dist/chrome
npm run verify         # all three

npm i -D playwright
npm run test:smoke     # loads the built extension in real Chromium
npm run test:regression # fullscreen and click-through regressions
```

`npm test` covers the parts that fail silently rather than loudly: global versus
per-site resolution, source selection across state broadcasts, template
apply/remove snapshots, import validation and migration, the keymap, silence
detection, the FFT, and the phase vocoder's pitch accuracy and unity-gain
normalisation.

`npm run test:smoke` launches headless Chromium with the built extension and
checks the worker starts, the content script loads without throwing, the
dashboard connects, a media element is routed, the overlay mounts with a closed
shadow root, a setting reaches storage, and the worklets are fetchable.

That "loads without throwing" check earns its place: a throw during
content-script setup takes the message listener with it, and everything after
then fails as an unhelpful *receiving end does not exist*. It has caught two
temporal-dead-zone bugs where a callback fired during construction read a `let`
declared further down. `src/content/index.ts` now declares all of its mutable
state above the constructors for that reason.

`npm run test:regression` pins two defects that only show up in a real browser
and made the extension unusable with video:

1. A closed overlay must not hit-test. It used to leave an invisible fixed
   element over the page, swallowing clicks on everything beneath — including
   players' fullscreen buttons.
2. Fullscreen puts one element in the top layer, above anything a z-index can
   reach, so an overlay parented to `<html>` vanishes. The host follows the
   fullscreen element instead.

Icons are generated, not committed as opaque assets:
`node scripts/make-icons.mjs`.

### Manual check after a change to the engine

1. Load `dist/chrome`, open something on YouTube, press `Alt+Shift+A`.
2. Confirm audio still plays — that proves the graph reaches the destination.
3. Sweep level, EQ and the filter; engage the compressor.
4. Set pitch to +5 st: the pitch should move and the tempo should not.
5. Give YouTube and SoundCloud different chains, reload both — each persists.
6. `Alt+Shift+G`: both follow global. Pin one — it keeps its own.
7. Apply a template to global, then remove it — global returns exactly.
8. Export, clear the extension's storage, import — everything comes back.
9. Play a video fullscreen with the mixer open — it should still be there.

### Firefox and Safari

Everything above `src/platform/` is written against an adapter interface, and
`manifest.config.ts` already emits a Firefox manifest. Because the engine is now
plain Web Audio in a content script rather than `tabCapture`, a Firefox build is
mostly a matter of that adapter plus testing. Safari additionally needs an Xcode
wrapper and a paid Apple developer account; it has not been attempted.

## Licence

MIT.
