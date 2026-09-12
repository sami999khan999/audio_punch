# Audio Punch

Volume control for any tab, including boost past 100%. A popup, four keyboard
shortcuts, and nothing else.

Chrome and Edge (Manifest V3). `manifest.config.ts` also emits a Firefox
manifest.

---

## What it does

- **Volume up, volume down, mute.** From the popup or the keyboard.
- **Boost above 100%**, up to 600%. A page's own volume control caps at 100%;
  this routes the audio through a Web Audio gain node, which does not.
- **This site, or all sites.** Per-origin by default, so `youtube.com` stays
  where you left it. Flip to *All sites* and one volume drives every tab —
  flip back and every site returns to exactly what it had.

That is the whole feature set.

---

## Install

```bash
npm install
npm run build          # → dist/chrome
```

**chrome://extensions** → enable **Developer mode** → **Load unpacked** →
choose `dist/chrome`.

---

## Using it

Click the toolbar icon, or use the shortcuts:

| | |
|---|---|
| `Alt+Shift+↑` | Volume up |
| `Alt+Shift+↓` | Volume down |
| `Alt+Shift+M` | Mute / unmute |
| `Alt+Shift+G` | Switch between *This site* and *All sites* |

Four is the limit the browser allows an extension to suggest keys for, so these
are exactly four. Rebind them at `chrome://extensions/shortcuts`.

The shortcuts act on whichever scope the popup is set to: with *This site*
selected they change the current site, with *All sites* they change the global
volume. Turning the volume up while muted unmutes rather than raising a level
nobody can hear.

---

## Limits worth knowing

- **Sites that generate audio entirely through Web Audio are silent to it** —
  browser games, some players. There is no `<audio>` or `<video>` element to
  route.
- **Cross-origin media served without CORS headers routes as silence.** Nothing
  throws; the page just goes quiet. Rare, but it is the one failure mode that
  looks like a bug rather than a limitation.
- **Nothing works on `chrome://` pages, the Web Store, or the PDF viewer** — no
  content script can run there. The popup says so and offers the global control
  instead.
- **Routing an element is irreversible.** `createMediaElementSource` cannot be
  undone for the life of that element, so the extension never tears the graph
  down — it sets the gain back to 1. Tearing it down would silence the page.
- **Settings live in `chrome.storage.local`.** `localStorage` is per-origin and
  could not be shared between tabs.

---

## How it is put together

```
content script (every http/https tab)   one gain node, fed by the page's media elements
        │  messages
service worker                          settings · resolution · shortcuts   ← the source of truth
        │  messages
popup                                   the only interface
```

| Path | What lives there |
|---|---|
| `src/shared/` | Types, defaults and clamping, origin identity, the message protocol |
| `src/background/` | Settings, volume resolution, shortcut handling |
| `src/content/` | The gain node and media-element routing |
| `src/popup/` | The popup |

Two details worth knowing before editing:

- **`src/content/index.ts` declares all of its mutable state at the top**, above
  anything that could call back into it. The observer and the message listener
  both do, and a `let` declared lower would be in its temporal dead zone at that
  moment — which throws, takes the message listener with it, and makes every
  later failure look like "receiving end does not exist".
- **Storage writes are debounced.** Holding the volume shortcut would otherwise
  write on every keypress.

---

## Development

```bash
npm run check          # tsc --noEmit
npm test               # unit tests (node:test)
npm run build          # → dist/chrome
npm run verify         # all three

npm i -D playwright
npm run test:smoke     # loads the built extension in real Chromium
```

`npm test` covers the rules that fail quietly: clamping, nudge behaviour at both
ends and while muted, per-site versus global resolution, that turning global off
leaves per-site values intact, and that settings read from storage are rebuilt
rather than trusted.

`npm run test:smoke` loads the built extension and checks the worker starts, the
content script loads without throwing and routes the page's media element, the
popup renders and drives it, a per-site volume reaches the page and is stored
against the right origin, global overrides it, and turning global off restores
it.

One gap, stated plainly: `chrome.commands` cannot be triggered from headless
Chromium, so the shortcut *dispatch* is not covered end to end. The logic behind
each command — `nudge`, `readScope`, `writeScope` — is the same code the popup
path uses, and that is tested both ways.

Icons are generated, not committed as opaque assets:
`node scripts/make-icons.mjs`.

## Licence

MIT.
