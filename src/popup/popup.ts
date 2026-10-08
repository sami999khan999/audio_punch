/**
 * The popup: the whole interface.
 *
 * Design notes, so later edits keep the intent:
 *
 * - The number is the interface. Volume is the one thing this extension does,
 *   so the percentage is set large and in tabular figures, and everything else
 *   arranges itself around it.
 * - The scope switch sits above the number rather than beside the controls,
 *   because it changes what the number *means* — reading a value without
 *   knowing whether it is this site or every site is worse than no value.
 * - A detent is marked at 100% on the track. Above it is a real boost, which
 *   the page's own volume control cannot do, and that line is worth seeing.
 */
import { formatVolume } from '../shared/defaults.ts'
import { prettyOrigin } from '../shared/origin.ts'
import { prettyShortcut, shortcutFromEvent } from '../shared/keys.ts'
import type { CommandName, PopupBroadcast, PopupRequest, PopupResponse, Scope } from '../shared/messages.ts'
import { MAX_VOLUME, type AudioState, type PopupState } from '../shared/types.ts'

const STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: 288px;
    font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #fff;
    background: #12161a;
    -webkit-font-smoothing: antialiased;
  }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
  :focus-visible { outline: 2px solid #7fd4c1; outline-offset: 2px; border-radius: 6px; }

  .wrap { padding: 14px 16px 16px; }
  .brand {
    display: flex; align-items: baseline; gap: 6px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase;
    margin-bottom: 13px;
  }
  .brand span { color: rgba(255,255,255,0.4); font-weight: 600; }

  .scope { display: flex; gap: 3px; padding: 3px; border-radius: 999px; background: rgba(255,255,255,0.07); }
  .scope button {
    flex: 1; height: 26px; border-radius: 999px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(255,255,255,0.55); transition: background 140ms, color 140ms;
  }
  .scope button[data-on="true"] { background: #7fd4c1; color: #06201a; }

  .site {
    margin: 9px 0 2px; font-size: 11px; color: rgba(255,255,255,0.5);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
  }

  .readout {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    margin: 6px 0 10px;
  }
  .value {
    min-width: 104px; text-align: center;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 34px; font-weight: 600; font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .value[data-muted="true"] { color: rgba(255,255,255,0.3); text-decoration: line-through; }
  .value[data-boost="true"] { color: #7fd4c1; }

  .step {
    width: 38px; height: 38px; border-radius: 50%; flex: 0 0 auto;
    background: rgba(255,255,255,0.08); font-size: 19px; line-height: 1;
    transition: background 140ms, transform 120ms;
  }
  .step:hover { background: rgba(255,255,255,0.16); }
  .step:active { transform: scale(0.93); }
  .step:disabled { opacity: 0.3; cursor: not-allowed; }

  .track {
    position: relative; height: 6px; border-radius: 999px;
    background: rgba(255,255,255,0.12); cursor: ew-resize; touch-action: none;
  }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: #fff; }
  .fill[data-boost="true"] { background: #7fd4c1; }
  .knob {
    position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
    border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  /* The line past which volume is a real boost. */
  .detent { position: absolute; top: -3px; bottom: -3px; width: 1px; background: rgba(255,255,255,0.35); }
  .scale {
    display: flex; justify-content: space-between;
    margin-top: 6px; font-size: 9px; letter-spacing: 0.08em;
    color: rgba(255,255,255,0.3);
  }

  .actions { display: flex; gap: 7px; margin-top: 13px; }
  .actions button {
    flex: 1; height: 32px; border-radius: 9px;
    background: rgba(255,255,255,0.08);
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(255,255,255,0.8); transition: background 140ms, color 140ms;
  }
  .actions button:hover { background: rgba(255,255,255,0.15); color: #fff; }
  .actions button[data-on="true"] { background: #ff6b5a; color: #fff; }

  .keys { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); }
  .key-row { display: flex; align-items: center; gap: 4px; }
  .key {
    flex: 1;
    display: flex; justify-content: space-between; align-items: center; gap: 10px;
    width: 100%; text-align: left;
    font-size: 11px; color: rgba(255,255,255,0.45); padding: 3px 0;
  }
  .key:hover { color: rgba(255,255,255,0.72); }
  .key kbd {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 10px; color: rgba(255,255,255,0.72); white-space: nowrap;
  }
  /* An unassigned command reads as something to act on, not as a dead row. */
  .key kbd[data-unset="true"] {
    color: #7fd4c1; border: 1px dashed rgba(127,212,193,0.5);
    border-radius: 5px; padding: 1px 6px;
  }
  .key kbd[data-listening="true"] {
    color: #06201a; background: #7fd4c1; border-radius: 5px; padding: 1px 6px;
  }
  .clear {
    width: 18px; height: 18px; border-radius: 5px; flex: 0 0 auto;
    font-size: 13px; line-height: 1; color: rgba(255,255,255,0.3);
  }
  .clear:hover { color: #fff; background: rgba(255,255,255,0.1); }
  .clear:disabled { visibility: hidden; }
  .restore {
    margin-top: 6px; font-size: 10px; letter-spacing: 0.06em;
    color: rgba(127,212,193,0.8); padding: 2px 0;
  }
  .restore:hover { color: #7fd4c1; }
  .note { margin-top: 10px; font-size: 11px; color: rgba(255,255,255,0.4); }
`

function send(request: PopupRequest): Promise<PopupResponse> {
  return chrome.runtime.sendMessage(request)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  node.append(...children)
  return node
}

function mount(): void {
  const style = document.createElement('style')
  style.textContent = STYLES
  document.head.append(style)

  let state: PopupState | null = null

  // ── scope ────────────────────────────────────────────────────────────────
  const siteBtn = el('button', { type: 'button' }, ['This site'])
  const allBtn = el('button', { type: 'button' }, ['All sites'])
  siteBtn.addEventListener('click', () => void request({ type: 'popup:set-global-on', on: false }))
  allBtn.addEventListener('click', () => void request({ type: 'popup:set-global-on', on: true }))
  const scopeRow = el('div', { class: 'scope' }, [siteBtn, allBtn])

  const siteLabel = el('div', { class: 'site' })

  // ── readout ──────────────────────────────────────────────────────────────
  const value = el('div', { class: 'value' })
  const minus = el('button', { class: 'step', type: 'button', 'aria-label': 'Volume down' }, ['−'])
  const plus = el('button', { class: 'step', type: 'button', 'aria-label': 'Volume up' }, ['+'])
  minus.addEventListener('click', () => void nudge(-1))
  plus.addEventListener('click', () => void nudge(1))
  const readout = el('div', { class: 'readout' }, [minus, value, plus])

  // ── slider ───────────────────────────────────────────────────────────────
  const fill = el('div', { class: 'fill' })
  const knob = el('div', { class: 'knob' })
  const detent = el('div', { class: 'detent' })
  detent.style.left = `${(1 / MAX_VOLUME) * 100}%`
  const track = el('div', {
    class: 'track',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Volume',
    'aria-valuemin': '0',
    'aria-valuemax': String(MAX_VOLUME * 100),
  })
  track.append(fill, detent, knob)

  const scale = el('div', { class: 'scale' }, [
    el('span', {}, ['0%']),
    el('span', {}, ['100%']),
    el('span', {}, [`${MAX_VOLUME * 100}%`]),
  ])

  function volumeAt(clientX: number): number {
    const rect = track.getBoundingClientRect()
    const position = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(position * MAX_VOLUME * 100) / 100
  }

  let dragging = false
  /** The latest pointer position, sent at most once a frame. A pointer fires
   *  far more often than the screen redraws, and each extra message is one
   *  more round trip for the worker and one more gain change for the page. */
  let pendingVolume: number | null = null
  let frame = 0
  function dragTo(clientX: number): void {
    pendingVolume = volumeAt(clientX)
    showVolume(pendingVolume)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (pendingVolume === null) return
      const volume = pendingVolume
      pendingVolume = null
      void setVolume(volume)
    })
  }
  track.addEventListener('pointerdown', (event) => {
    dragging = true
    track.setPointerCapture(event.pointerId)
    dragTo(event.clientX)
  })
  track.addEventListener('pointermove', (event) => {
    if (dragging) dragTo(event.clientX)
  })
  const endDrag = () => {
    dragging = false
  }
  track.addEventListener('pointerup', endDrag)
  track.addEventListener('pointercancel', endDrag)
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') void nudge(1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') void nudge(-1)
    else return
    event.preventDefault()
  })

  // ── actions ──────────────────────────────────────────────────────────────
  const muteBtn = el('button', { type: 'button' }, ['Mute'])
  const resetBtn = el('button', { type: 'button' }, ['Reset'])
  muteBtn.addEventListener('click', () => {
    if (!state) return
    void request({ type: 'popup:set-muted', scope: scope(), muted: !current().muted })
  })
  resetBtn.addEventListener('click', () => void request({ type: 'popup:reset', scope: scope() }))
  const actions = el('div', { class: 'actions' }, [muteBtn, resetBtn])

  const note = el('div', { class: 'note' })

  const keys = el('div', { class: 'keys' })

  const COMMAND_LABELS: Record<CommandName, string> = {
    'volume-up': 'Volume up',
    'volume-down': 'Volume down',
    'toggle-mute': 'Mute / unmute',
    reset: 'Reset to 100%',
    'toggle-global': 'This site / all sites',
  }

  /** The command waiting for its new key, if any. */
  let recording: CommandName | null = null
  /** What the list was last built from, so a volume change does not rebuild it. */
  let keysDrawn = ''

  /**
   * Every key is set here. Click a key, press the new combination; Escape
   * cancels. Chrome cannot be told to rebind its own shortcuts, so these are
   * stored by the extension and heard by the page — see the content script.
   */
  function renderKeys(): void {
    if (!state) return
    const drawn = JSON.stringify([recording, state.bindings])
    if (drawn === keysDrawn) return
    keysDrawn = drawn
    const rows = state.bindings.map((row) => {
      const listening = recording === row.command
      const kbd = el('kbd', row.shortcut || listening ? {} : { 'data-unset': 'true' }, [
        listening ? 'Press keys…' : row.shortcut ? prettyShortcut(row.shortcut) : 'Set a key',
      ])
      if (listening) kbd.setAttribute('data-listening', 'true')
      const set = el(
        'button',
        {
          class: 'key',
          type: 'button',
          title: listening ? 'Press the new keys, or Escape to cancel' : 'Click, then press the new keys',
        },
        [el('span', {}, [COMMAND_LABELS[row.command]]), kbd],
      )
      set.addEventListener('click', () => {
        recording = listening ? null : row.command
        renderKeys()
      })
      const clear = el(
        'button',
        { class: 'clear', type: 'button', title: 'Remove this shortcut', 'aria-label': 'Remove shortcut' },
        ['×'],
      )
      clear.disabled = !row.shortcut
      clear.addEventListener('click', () => {
        recording = null
        void request({ type: 'popup:set-binding', command: row.command, shortcut: '' })
      })
      return el('div', { class: 'key-row' }, [set, clear])
    })

    const restore = el('button', { class: 'restore', type: 'button' }, ['Restore default keys'])
    restore.hidden = !state.bindings.some((row) => row.custom)
    restore.addEventListener('click', () => {
      recording = null
      void request({ type: 'popup:reset-bindings' })
    })
    keys.replaceChildren(...rows, restore)
  }

  // Captured on the window so the slider and buttons never see a key meant
  // for the recorder.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!recording) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        recording = null
        renderKeys()
        return
      }
      const shortcut = shortcutFromEvent(event)
      if (!shortcut) return // a modifier on its own; wait for the rest
      const command = recording
      recording = null
      void request({ type: 'popup:set-binding', command, shortcut })
    },
    true,
  )

  document.body.replaceChildren(
    el('div', { class: 'wrap' }, [
      el('div', { class: 'brand' }, [el('b', {}, ['Audio']), el('span', {}, ['Punch'])]),
      scopeRow,
      siteLabel,
      readout,
      track,
      scale,
      actions,
      note,
      keys,
    ]),
  )

  // ── state ────────────────────────────────────────────────────────────────

  function scope(): Scope {
    return state?.settings.globalOn ? 'global' : 'site'
  }

  function current(): AudioState {
    if (!state) return { volume: 1, muted: false }
    if (state.settings.globalOn) return state.settings.global
    const site = state.settings.sites[state.origin]
    return site ? { volume: site.volume, muted: site.muted } : { volume: 1, muted: false }
  }

  async function request(message: PopupRequest): Promise<void> {
    const response = await send(message)
    if (response.ok) render(response.state)
  }

  async function nudge(steps: number): Promise<void> {
    await request({ type: 'popup:nudge-volume', scope: scope(), steps })
  }

  async function setVolume(volume: number): Promise<void> {
    await request({ type: 'popup:set-volume', scope: scope(), volume })
  }

  /** Draws a volume straight away — mid-drag, ahead of the worker's answer. */
  function showVolume(volume: number, muted = current().muted): void {
    value.textContent = formatVolume(volume)
    value.setAttribute('data-muted', String(muted))
    value.setAttribute('data-boost', String(!muted && volume > 1))

    const position = volume / MAX_VOLUME
    fill.style.width = `${position * 100}%`
    fill.setAttribute('data-boost', String(volume > 1))
    knob.style.left = `${position * 100}%`
    track.setAttribute('aria-valuenow', String(Math.round(volume * 100)))
    track.setAttribute('aria-valuetext', formatVolume(volume))
  }

  function render(next: PopupState): void {
    state = next
    // Mid-drag the pointer is authoritative; a broadcast would snap the knob
    // back to the last value the worker happened to have written.
    if (dragging) return
    const global = next.settings.globalOn
    const audio = current()
    // The site controls are unusable on a page no content script can reach,
    // but the global ones still are.
    const blocked = !global && !next.supported

    siteBtn.setAttribute('data-on', String(!global))
    allBtn.setAttribute('data-on', String(global))
    siteLabel.textContent = global
      ? 'Applies to every tab'
      : next.supported
        ? prettyOrigin(next.origin)
        : 'Not available on this page'

    showVolume(audio.volume, audio.muted)

    muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute'
    muteBtn.setAttribute('data-on', String(audio.muted))

    for (const control of [minus, plus, muteBtn, resetBtn]) control.disabled = blocked
    track.style.opacity = blocked ? '0.35' : '1'
    track.style.pointerEvents = blocked ? 'none' : 'auto'

    renderKeys()

    note.textContent = blocked
      ? 'Switch to All sites to set a volume from here.'
      : next.boostCapped && audio.volume > 1
        ? "This page's audio is served from another site without CORS, so it cannot go past 100%."
        : audio.volume > 1 && !audio.muted
          ? 'Boosting past 100%. Loud sources may distort.'
          : ''
  }

  // A shortcut, or another window, can change the value while this popup is
  // open. Without this it would sit on whatever it read when it opened.
  chrome.runtime.onMessage.addListener((message: PopupBroadcast) => {
    if (message?.type === 'popup:changed') render(message.state)
  })

  // Belt and braces: the broadcast can be missed if the popup opens mid-flight,
  // and storage is the thing that is actually authoritative.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['audio-punch:settings']) return
    void send({ type: 'popup:hello' }).then((response) => {
      if (response.ok) render(response.state)
    })
  })

  void send({ type: 'popup:hello' }).then((response) => {
    if (response.ok) render(response.state)
  })
}

mount()
