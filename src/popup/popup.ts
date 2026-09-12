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
import type { PopupRequest, PopupResponse, Scope } from '../shared/messages.ts'
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
  .key { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: rgba(255,255,255,0.45); padding: 2px 0; }
  .key kbd {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 10px; color: rgba(255,255,255,0.72);
  }
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
  track.addEventListener('pointerdown', (event) => {
    dragging = true
    track.setPointerCapture(event.pointerId)
    void setVolume(volumeAt(event.clientX))
  })
  track.addEventListener('pointermove', (event) => {
    if (dragging) void setVolume(volumeAt(event.clientX))
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

  const keys = el('div', { class: 'keys' }, [
    keyRow('Volume up / down', 'Alt+Shift+↑ ↓'),
    keyRow('Mute / unmute', 'Alt+Shift+M'),
    keyRow('This site / all sites', 'Alt+Shift+G'),
  ])

  function keyRow(label: string, accel: string): HTMLElement {
    return el('div', { class: 'key' }, [el('span', {}, [label]), el('kbd', {}, [accel])])
  }

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

  function render(next: PopupState): void {
    state = next
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

    value.textContent = formatVolume(audio.volume)
    value.setAttribute('data-muted', String(audio.muted))
    value.setAttribute('data-boost', String(!audio.muted && audio.volume > 1))

    const position = audio.volume / MAX_VOLUME
    fill.style.width = `${position * 100}%`
    fill.setAttribute('data-boost', String(audio.volume > 1))
    knob.style.left = `${position * 100}%`
    track.setAttribute('aria-valuenow', String(Math.round(audio.volume * 100)))
    track.setAttribute('aria-valuetext', formatVolume(audio.volume))

    muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute'
    muteBtn.setAttribute('data-on', String(audio.muted))

    for (const control of [minus, plus, muteBtn, resetBtn]) control.disabled = blocked
    track.style.opacity = blocked ? '0.35' : '1'
    track.style.pointerEvents = blocked ? 'none' : 'auto'

    note.textContent =
      audio.volume > 1 && !audio.muted
        ? 'Boosting past 100%. Loud sources may distort.'
        : blocked
          ? 'Switch to All sites to set a volume from here.'
          : ''
  }

  void send({ type: 'popup:hello' }).then((response) => {
    if (response.ok) render(response.state)
  })
}

mount()
