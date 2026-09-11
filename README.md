# Audio Punch

A DJ-style mixing desk for your browser. Route any tab's audio through a live
Web Audio chain — EQ, dynamics, space, filters and pitch — from a panel that
slides down over the page, driven almost entirely by the keyboard.

Chrome and Edge (Manifest V3). The core is browser-agnostic behind a platform
adapter; see [Firefox](#firefox-and-safari) below.

---

## What it does

- **Per-tab processing.** Every tab that makes noise gets its own strip: level
  with up to 600% boost, pan, mute and a full module rack.
- **A global chain.** Turn it on and one chain drives every tab. Turn it off and
  each tab returns to exactly what it had. Any site can be pinned to keep its
  own chain while global is running.
- **Settings that stick.** Chains are saved per origin (`https://youtube.com`),
  so a site sounds the way you left it next time. Export and import the lot as
  JSON.
- **Templates.** Save the modules you have engaged under a name, apply it to
  global or to one site, and remove it to get back precisely what was there
  before. Eight are built in.
- **Keyboard first.** Four browser-level shortcuts, plus a full rebindable map
  inside the mixer.

### Modules

| Group | Modules |
|---|---|
| Core | Level (0–600%), pan, mute, 10-band graphic EQ, bass/treble shelves |
| Dynamics | Compressor, brick-wall limiter, noise gate |
| Space | Convolution reverb, delay (with ping-pong), mid/side stereo width, mono fold |
| Time | Resonant high-pass / low-pass sweep, phase-vocoder pitch shift, playback speed |

Pitch shifting is a real phase vocoder: ±12 semitones with the tempo untouched.
Speed is separate and does change the tempo.

---

## Install

```bash
npm install
npm run build          # → dist/chrome
```

Then in Chrome: **chrome://extensions** → enable **Developer mode** → **Load
unpacked** → choose `dist/chrome`.

`npm run dev` rebuilds on change; hit the reload button on the extension card to
pick changes up.

---

## Using it

Press **Alt+Shift+A** on a tab that is playing something. The mixer slides down,
and that tab is armed in the same motion — the shortcut is the user gesture the
browser requires before it will hand over a tab's audio.

The left rail lists the global bus and every audible tab. Click a strip to edit
it; the rack on the right follows your selection, so you can adjust any tab, or
global, from any tab's overlay. Drag the grip at the bottom edge to resize.

### Shortcuts

Four work anywhere, with nothing on screen (rebind at
`chrome://extensions/shortcuts`):

| | |
|---|---|
| `Alt+Shift+A` | Show / hide the mixer |
| `Alt+Shift+G` | Global chain on / off |
| `Alt+Shift+M` | Mute every captured tab |
| `Alt+Shift+B` | Bypass all processing |

The browser allows an extension only four of those. Everything else is handled
inside the mixer while it has focus — which is also why these never collide with
a site's own shortcuts. Press `?` in the mixer for the full list, or rebind any
of them under **Shortcuts** in the dashboard.

| | |
|---|---|
| `[` `]` | Previous / next strip |
| `` ` `` | Jump to global |
| `↑` `↓` | Level (hold `Shift` for fine) |
| `←` `→` | Select EQ band |
| `Alt+↑` `Alt+↓` | Boost / cut that band |
| `m` `b` `i` | Mute · bypass · pin off global |
| `e t f c l g r d w p s` | Toggle each module |
| `Ctrl+1`…`Ctrl+9` | Apply template 1–9 |
| `Ctrl+0` | Remove the applied template |
| `Enter` · `Backspace` · `Esc` | Arm/release · reset strip · close |

### The dashboard

`chrome-extension://…/dashboard.html` — reachable from the ⤢ button, or as the
extension's options page. It carries the same mixer plus the things that need
room: the template library, the shortcut editor, your saved sites, and
export/import. It also works on pages the overlay cannot reach.

---

## Things the browser will not let it do

These are properties of the platform, not missing features, and the UI says so
rather than appearing broken:

- **Protected (DRM) playback cannot be captured.** Netflix, Spotify, Disney+ and
  similar will go *silent* if armed, not merely unprocessed. Audio Punch warns
  before arming a known one; arm again to override, and release to get the audio
  back immediately.
- **A tab must be armed from that tab.** The browser only hands over audio for a
  tab the extension has been invoked on. Arming a different tab's strip switches
  to it briefly and switches back.
- **Capturing a tab moves its audio through the extension.** If the engine is
  not reaching your speakers, the tab is silent — hence the output-path check on
  every graph change.
- **The overlay cannot open** on `chrome://` pages, the Web Store, the PDF
  viewer or a blank new tab. Use the dashboard there.
- **Speed needs a real media element.** It is applied to the page's
  `<audio>`/`<video>`, not in the audio graph, so it is unavailable on sites that
  synthesise audio entirely through Web Audio. The control disables itself and
  says why.
- **Settings live in `chrome.storage.local`, not `localStorage`.**
  `localStorage` is per-origin and could not be shared between tabs.

---

## How it is put together

Four runtime contexts and one typed message protocol (`src/shared/messages.ts`):

```
content script (every http/https tab)     overlay · keymap · playbackRate
        │  port
service worker                            settings · tabs · resolution   ← the only source of truth
        │  port
offscreen document                        one AudioContext · per-tab graphs · worklets
        │  port
dashboard (extension page)                full desk · templates · import/export
```

The service worker owns all state. Both UI surfaces send intents and render the
snapshot they get back, which is what keeps them — and the global strip inside
each — consistent without a second implementation.

| Path | What lives there |
|---|---|
| `src/shared/` | Types, parameter ranges, defaults, migration, presets |
| `src/platform/` | The only browser-API-aware layer |
| `src/background/` | Settings store, tab registry, chain resolution, commands |
| `src/offscreen/` | The audio graph, DSP modules and AudioWorklets |
| `src/ui/` | Store, controls and views, shared by both surfaces |
| `src/content/` | Shadow-DOM overlay, keyboard map, media control |
| `src/dashboard/` | The full desk page |

Two details worth knowing before editing:

- **Modules are unlinked, not neutralised.** An unengaged reverb is disconnected
  from the graph entirely, so it costs nothing. `TabGraph.apply` relinks only
  when the *set* of active modules changes; turning a knob never touches the
  topology.
- **The rack is built once per target and updated in place.** Rebuilding it on
  every broadcast would tear a knob out from under the pointer mid-drag.

---

## Development

```bash
npm run check      # tsc --noEmit across all four contexts
npm test           # unit tests (node:test)
npm run build      # → dist/chrome
npm run verify     # all three

npm i -D playwright && npm run test:smoke   # loads the built extension in real Chromium
```

`npm test` covers the parts that fail silently rather than loudly: global versus
per-site resolution, template apply/remove snapshots, import validation and
migration, the keymap, the FFT, and the phase vocoder's pitch accuracy and
unity-gain normalisation.

`npm run test:smoke` launches headless Chromium with the built extension and
checks the service worker starts, the dashboard connects to it, the content
script answers, the overlay mounts with a closed shadow root, a setting reaches
storage, and the audio engine document is created.

Icons are generated, not committed as opaque assets:
`node scripts/make-icons.mjs`.

### Manual check after a change to the engine

1. Load `dist/chrome`, open something on YouTube, press `Alt+Shift+A`, arm it.
2. Confirm audio still plays — that proves capture is reaching the destination.
3. Sweep level, EQ and the filter; engage the compressor.
4. Set pitch to +5 st: the pitch should move and the tempo should not.
5. Give YouTube and SoundCloud different chains, reload both — each persists.
6. `Alt+Shift+G`: both follow global. Pin one — it keeps its own.
7. Apply a template to global, then remove it — global returns exactly.
8. Export, clear the extension's storage, import — everything comes back.

### Firefox and Safari

Firefox has neither `tabCapture` nor offscreen documents, so it cannot run this
engine. Everything above `src/platform/` is written against an adapter
interface, and `manifest.config.ts` already emits a Firefox manifest, so the
remaining work is a Firefox adapter plus a media-element capture source — with
the reduced coverage that implies (no WebAudio-only sites). Safari additionally
needs an Xcode wrapper and a paid Apple developer account; it has not been
attempted.

## Licence

MIT.
