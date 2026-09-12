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

The built extension is committed, so nothing needs building to use it:

```bash
git clone https://github.com/sami999khan999/audio_punch.git
```

**chrome://extensions** → enable **Developer mode** → **Load unpacked** →
choose `audio_punch/dist/chrome`.

To build it yourself after a change:

```bash
npm install
npm run build          # → dist/chrome
```

`dist/` is tracked on purpose. Rebuild and commit it alongside any source
change, or the loaded extension and the source drift apart.

---

## Using it

Click the toolbar icon, or use the shortcuts:

| | |
|---|---|
| `Alt+Shift+↑` | Volume up |
| `Alt+Shift+↓` | Volume down |
| `Alt+Shift+M` | Mute / unmute |
| `Alt+Shift+G` | Switch between *This site* and *All sites* |
| *unassigned* | Reset to 100% |

**Reset needs a key of your choosing.** The browser allows an extension to
suggest a key for only four commands — and declaring a fifth is not a soft
failure, it makes Chrome reject the manifest and the extension does not load at
all. So `reset` ships as a real command with no key attached.

Assign one at `chrome://extensions/shortcuts`, or click the row in the popup,
which opens that page. Once assigned it behaves exactly like the others,
fullscreen included.

The popup lists your actual bindings rather than these defaults, so a rebound
shortcut shows up there correctly.

The shortcuts act on whichever scope the popup is set to: with *This site*
selected they change the current site, with *All sites* they change the global
volume. Turning the volume up while muted unmutes rather than raising a level
nobody can hear.

### Fullscreen

Shortcuts work on fullscreen video, and the new value appears briefly on screen.

That needs explaining, because it does not come for free. The browser restricts
keyboard input while a page is fullscreen, so `chrome.commands` stops firing —
and the toolbar is hidden, so the popup is out of reach as well. The content
script therefore listens for the shortcuts itself, but **only while the document
is fullscreen**: outside it `chrome.commands` works, and handling the keys in
both places would apply every press twice.

It reads the live bindings from `chrome.commands.getAll()` rather than the
manifest defaults, so rebinding a shortcut is respected in fullscreen too — and
so is assigning one to `reset`, which has no default. The
on-screen value is appended to the fullscreen element, because a fullscreen
element is promoted to the browser's top layer where nothing outside it renders
at all — no z-index reaches past it.

---

## How it reaches a page's audio

Two paths, chosen per element, because no single one works everywhere:

**Routed** — the element is fed through a Web Audio gain node. This is the good
path: it does not touch the element's own volume, so it never fights the site's
player controls, and it is the only way past 100%. Used when the media is
demonstrably same-origin, which includes the `blob:` sources that media-source
players (YouTube among them) produce.

**Direct** — the element's own `volume` and `muted` are set instead. Used for
everything else, and capped at 100% because that is the property's ceiling. The
popup says so rather than leaving a 300% setting sounding like 100%.

The split exists because `createMediaElementSource` on media fetched
cross-origin without CORS headers does not throw — it yields **silence**,
permanently, since routing cannot be undone. Driving those elements directly is
worse in one way and far better in another.

On the direct path the site is not fought over: a volume or mute the *site* set
is left alone, and only values this extension wrote are ever undone.

Players are found in the top document, inside iframes, and inside open shadow
roots. The shadow walk is rate-limited rather than run on every scan — it visits
every element on the page.

## Limits worth knowing

- **Boost past 100% needs the routed path.** On cross-origin media the volume
  stops at 100%, and the popup explains why.
- **Sites that generate audio entirely through Web Audio are silent to it** —
  browser games, some players. There is no `<audio>` or `<video>` element at all.
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
| `src/content/` | The gain node, media-element routing, and the fullscreen fallback |
| `src/popup/` | The popup |

Two details worth knowing before editing:

- **`src/content/index.ts` declares all of its mutable state at the top**, above
  anything that could call back into it. The observer and the message listener
  both do, and a `let` declared lower would be in its temporal dead zone at that
  moment — which throws, takes the message listener with it, and makes every
  later failure look like "receiving end does not exist".
- **A press must not wait on the worker.** The browser stops the service worker
  whenever it is idle, so a shortcut routinely arrives while it is starting up.
  The page therefore steps its own audio the moment it catches a key and tells
  the worker afterwards; the worker's push settles the stored value and catches
  up every other tab. That push carries back the press number it answers, so a
  page already a press or two ahead drops it rather than stepping backwards and
  forwards again.
- **A command reads and writes the settings without an `await` in between.**
  Commands that arrived while the worker was down are delivered together, so
  several run in the same turn. Reading before a yield meant they all read the
  stale value and only the last write survived — eight presses moved the volume
  one step. `load()` is memoised for the same reason: without it each of those
  commands started its own storage read and ended up editing a *separate*
  settings object.
- **Nothing audible waits on anything else.** The tab in front is messaged
  first and directly. Walking the tab list, catching up background tabs,
  writing storage and redrawing the popup all happen behind it, coalesced —
  messaging a background tab can take as long as that tab's own main thread
  needs, and doing it per keypress is what made a held-down shortcut feel like
  it had seized up.
- **Applying a value never triggers the shadow-root walk.** That walk visits
  every element on the page and runs on the same main thread that has to handle
  the incoming value. It stays on the debounced scan, which is already looking
  for anything new.
- **Storage writes are debounced.** Holding the volume shortcut would otherwise
  write on every keypress.
- **The popup updates live.** The worker broadcasts after every change, and the
  popup also watches `chrome.storage`, so a shortcut pressed while it is open is
  reflected immediately. A broadcast arriving mid-drag is ignored, or the knob
  would snap back under the pointer.
- **Chrome's shortcut strings are display spellings, not manifest ones.** A
  manifest `"Up"` comes back from `chrome.commands.getAll()` as `"Up Arrow"`.
  The parser strips spaces and maps both.

---

## Development

```bash
npm run check          # tsc --noEmit
npm test               # unit tests (node:test)
npm run build          # → dist/chrome
npm run verify         # all three

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

It runs against a fixture carrying the four shapes real sites use — a top-level
same-origin player, a cross-origin one, one inside a shadow root and one inside
an iframe — and asserts each is reached by the right path. Those three beyond
the first are what made this work on YouTube and nowhere else.

It also drives the real shortcuts against a fullscreen video, which is the one
end-to-end cover the shortcut path has: `chrome.commands` itself cannot be fired
from headless Chromium, but the in-page fullscreen fallback receives ordinary key
events and runs exactly the same worker code that `chrome.commands` does.

Four of its checks are about presses landing smoothly, and each was written
against the failure it guards. A press has to move the page without the worker
having answered — asserted on the count of presses the page acted on itself,
not on a stopwatch, since a machine fast enough to answer within any timeout
chosen here would make a timing check meaningless. Eight commands delivered in
one tick to a worker that has just been stopped — the browser's own behaviour,
reproduced — have to be eight steps; before the fix they were one. The stored
value has to agree with what the page is playing, and the announced value must
never step backwards.

`CHROME_PATH` selects the browser binary if the Playwright-managed one is not
the one installed.

Icons are generated, not committed as opaque assets:
`node scripts/make-icons.mjs`.

## Licence

MIT.
