/**
 * The whole visual system, as one stylesheet string.
 *
 * It is a string rather than a .css file because the overlay renders inside a
 * closed shadow root on arbitrary pages: no external stylesheet can be relied
 * on to load, and nothing here may leak out. The dashboard adopts the same
 * sheet, so both surfaces are guaranteed to look identical.
 *
 * Design notes, so later edits keep the intent:
 *
 * - The ground is graphite, and panels sit *above* it. Most dark UIs recess
 *   cards into a black page; physical mixers do the opposite, and the raised
 *   panel with a 1px top highlight is what makes this read as hardware.
 * - Colour is functional, not decorative, and borrowed from metering
 *   convention: tungsten means running, teal means the global bus, red means
 *   clipping and nothing else. There is no brand accent to spend on mood.
 * - No webfonts. A content script cannot count on a page's CSP allowing a font
 *   request, so all three type roles come from system stacks and are told
 *   apart by treatment — silkscreen legends are condensed, uppercase and
 *   widely tracked; readouts are tabular monospace so digits do not jitter.
 * - No glows. Panels get a bevel, LEDs get colour. That is the whole
 *   decorative budget.
 */

export const STYLESHEET = `
.ap-root {
  /* Surfaces, darkest recess to highest panel. */
  --ap-void: #0f1115;
  --ap-chassis: #1a1d23;
  --ap-panel: #23272f;
  --ap-panel-raised: #2a2f38;
  --ap-groove: #101317;
  --ap-bevel: rgba(255, 255, 255, 0.055);
  --ap-shadow: rgba(0, 0, 0, 0.45);
  --ap-line: rgba(255, 255, 255, 0.08);

  /* Screen-printed legends. */
  --ap-ink: #d9d5cb;
  --ap-ink-dim: #838a95;
  --ap-ink-faint: #5b626c;

  /* Signal state. */
  --ap-lit: #e8b84b;
  --ap-bus: #56c8c0;
  --ap-hot: #d7452f;
  --ap-cool: #414852;

  --ap-legend: 600 9px/1 var(--ap-font-legend);
  --ap-font-legend: "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif;
  --ap-font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ap-font-num: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;

  --ap-radius: 4px;
  --ap-gap: 10px;
  --ap-ease: cubic-bezier(0.22, 0.61, 0.36, 1);

  color: var(--ap-ink);
  font-family: var(--ap-font-ui);
  font-size: 12px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}
.ap-root *,
.ap-root *::before,
.ap-root *::after { box-sizing: inherit; }

.ap-root [hidden] { display: none !important; }

.ap-root button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.ap-root input, .ap-root select, .ap-root textarea { font: inherit; color: inherit; }
.ap-root :focus-visible {
  outline: 2px solid var(--ap-lit);
  outline-offset: 2px;
  border-radius: 2px;
}

/* ── silkscreen legend ───────────────────────────────────────────────── */
.ap-legend {
  font: var(--ap-legend);
  font-family: var(--ap-font-legend);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ap-ink-dim);
  white-space: nowrap;
}
.ap-readout {
  font-family: var(--ap-font-num);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--ap-ink);
}

/* ── the overlay shell ───────────────────────────────────────────────── */
.ap-shell {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1e222a 0%, var(--ap-chassis) 46%, #16191e 100%);
  border-bottom-left-radius: 22px;
  border-bottom-right-radius: 22px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.8);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  transform: translateY(-101%);
  transition: transform 260ms var(--ap-ease);
  overflow: hidden;
  contain: layout paint;
}
.ap-shell::before {
  /* The chassis edge highlight — the one bevel that sells the metal. */
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: var(--ap-bevel);
  pointer-events: none;
}
.ap-shell[data-open="true"] { transform: translateY(0); }

/* ── top rail ────────────────────────────────────────────────────────── */
.ap-rail {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 42px;
  padding: 0 14px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--ap-line);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
}
.ap-wordmark {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-family: var(--ap-font-legend);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ap-ink);
}
.ap-wordmark span { color: var(--ap-ink-faint); letter-spacing: 0.16em; font-weight: 600; }
.ap-rail-spacer { flex: 1; }

/* ── buttons ─────────────────────────────────────────────────────────── */
.ap-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--ap-radius);
  background: var(--ap-panel);
  border: 1px solid var(--ap-line);
  box-shadow: inset 0 1px 0 var(--ap-bevel), 0 1px 2px var(--ap-shadow);
  font-family: var(--ap-font-legend);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ap-ink-dim);
  transition: color 120ms, background 120ms;
}
.ap-btn:hover { color: var(--ap-ink); background: var(--ap-panel-raised); }
.ap-btn[data-on="true"] { color: var(--ap-lit); border-color: rgba(232, 184, 75, 0.45); }
.ap-btn[data-tone="bus"][data-on="true"] { color: var(--ap-bus); border-color: rgba(86, 200, 192, 0.45); }
.ap-btn[data-tone="hot"]:hover { color: var(--ap-hot); }
.ap-btn[disabled] { opacity: 0.38; cursor: not-allowed; }
.ap-btn-icon { width: 24px; padding: 0; justify-content: center; font-size: 12px; letter-spacing: 0; }

/* A latched toggle reads as a backlit cap: lit when engaged, dark when not. */
.ap-cap {
  position: relative;
  height: 20px;
  min-width: 34px;
  padding: 0 8px;
  border-radius: 3px;
  background: var(--ap-groove);
  /* A light rim so an unlit cap still reads as something you can press. */
  border: 1px solid var(--ap-line);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
  font-family: var(--ap-font-legend);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ap-ink-faint);
  transition: color 120ms, background 120ms, box-shadow 120ms;
}
.ap-cap:hover { color: var(--ap-ink-dim); border-color: rgba(255, 255, 255, 0.18); }
.ap-cap[data-on="true"] {
  color: #17191d;
  background: var(--ap-lit);
  box-shadow: inset 0 -1px 0 rgba(0,0,0,0.35), 0 0 0 1px rgba(232,184,75,0.35);
}
.ap-cap[data-tone="bus"][data-on="true"] { background: var(--ap-bus); box-shadow: inset 0 -1px 0 rgba(0,0,0,0.35), 0 0 0 1px rgba(86,200,192,0.35); }
.ap-cap[data-tone="hot"][data-on="true"] { background: var(--ap-hot); color: #fff; }

/* ── body: channel rail + desk ───────────────────────────────────────── */
.ap-body {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 244px 1fr;
  min-height: 0;
}
.ap-channels {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px;
  overflow-y: auto;
  background: var(--ap-void);
  border-right: 1px solid rgba(0, 0, 0, 0.6);
}
.ap-desk {
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: var(--ap-gap);
  min-width: 0;
}

/* ── channel strip ───────────────────────────────────────────────────── */
.ap-strip {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: var(--ap-radius);
  background: var(--ap-chassis);
  border: 1px solid transparent;
  text-align: left;
  width: 100%;
  transition: background 120ms;
}
.ap-strip:hover { background: var(--ap-panel); }
.ap-strip[data-selected="true"] {
  background: var(--ap-panel);
  border-color: rgba(232, 184, 75, 0.4);
}
.ap-strip[data-bus="true"][data-selected="true"] { border-color: rgba(86, 200, 192, 0.45); }
.ap-strip[data-bus="true"] { margin-bottom: 7px; }

/* The left edge is the state indicator: unlit, tungsten when armed, teal for
   the global bus. It replaces a badge, a dot and a label all at once. */
.ap-strip-edge {
  width: 3px;
  height: 30px;
  border-radius: 2px;
  background: var(--ap-cool);
  justify-self: start;
  margin-left: 2px;
}
.ap-strip[data-armed="true"] .ap-strip-edge { background: var(--ap-lit); }
.ap-strip[data-bus="true"] .ap-strip-edge { background: var(--ap-cool); }
.ap-strip[data-bus="true"][data-armed="true"] .ap-strip-edge { background: var(--ap-bus); }

.ap-strip-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ap-strip-name {
  font-size: 11px;
  color: var(--ap-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-strip[data-bus="true"] .ap-strip-name {
  font-family: var(--ap-font-legend);
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-size: 10px;
}
.ap-strip-sub {
  font-family: var(--ap-font-legend);
  font-size: 8px;
  line-height: 1.5;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ap-ink-faint);
  /* Two lines, so the site and its state both survive a narrow rail. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ap-strip-sub[data-tone="warn"] { color: var(--ap-hot); }
.ap-strip-tags { display: flex; gap: 4px; align-items: center; }
.ap-tag {
  font-family: var(--ap-font-legend);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--ap-ink-faint);
  border: 1px solid var(--ap-line);
}
.ap-tag[data-tone="lit"] { color: var(--ap-lit); border-color: rgba(232,184,75,0.4); }
.ap-tag[data-tone="bus"] { color: var(--ap-bus); border-color: rgba(86,200,192,0.4); }

/* ── LED ladder meter ────────────────────────────────────────────────── */
.ap-meter {
  display: flex;
  flex-direction: column-reverse;
  gap: 2px;
  width: 7px;
  height: 34px;
}
.ap-meter-seg {
  flex: 1;
  min-height: 2px;
  border-radius: 1px;
  background: var(--ap-cool);
  opacity: 0.45;
}
.ap-meter-seg[data-lit="true"] { background: var(--ap-lit); opacity: 1; }
.ap-meter-seg[data-lit="true"][data-zone="hot"] { background: var(--ap-hot); }
.ap-meter[data-wide="true"] { width: 9px; height: 44px; }

/* ── module panel ────────────────────────────────────────────────────── */
.ap-modules {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(198px, 1fr));
  gap: var(--ap-gap);
  align-items: start;
}
.ap-module {
  background: linear-gradient(180deg, var(--ap-panel-raised), var(--ap-panel));
  border: 1px solid rgba(0, 0, 0, 0.55);
  border-radius: 6px;
  box-shadow: inset 0 1px 0 var(--ap-bevel), 0 2px 5px var(--ap-shadow);
  padding: 9px 11px 12px;
}
.ap-module[data-span="wide"] { grid-column: 1 / -1; }
.ap-module[data-span="double"] { grid-column: span 2; }
.ap-module[data-on="false"] .ap-module-body { opacity: 0.4; }
.ap-module-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.ap-module-title { flex: 1; }
.ap-module-body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; transition: opacity 140ms; }

/* ── rotary control ──────────────────────────────────────────────────── */
/* Drawn as a hardware pot: an arc of discrete ticks that light up to the
   current position, plus an indicator line. Not a glowing progress ring. */
.ap-knob {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 52px;
  touch-action: none;
  cursor: ns-resize;
}
.ap-knob-dial { display: block; }
.ap-knob-tick { stroke: var(--ap-cool); stroke-width: 2; stroke-linecap: round; }
.ap-knob-tick[data-lit="true"] { stroke: var(--ap-lit); }
.ap-knob[data-tone="bus"] .ap-knob-tick[data-lit="true"] { stroke: var(--ap-bus); }
.ap-knob-body { fill: #333a44; stroke: rgba(0, 0, 0, 0.65); stroke-width: 1; }
.ap-knob-cap { fill: rgba(255, 255, 255, 0.05); }
.ap-knob-pointer { stroke: var(--ap-ink); stroke-width: 2; stroke-linecap: round; }
.ap-knob-value { min-height: 12px; }
.ap-knob:hover .ap-knob-pointer, .ap-knob[data-active="true"] .ap-knob-pointer { stroke: #fff; }

/* ── fader ───────────────────────────────────────────────────────────── */
.ap-fader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  touch-action: none;
}
.ap-fader-track {
  position: relative;
  width: 26px;
  height: 96px;
  border-radius: 3px;
  background: var(--ap-groove);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7);
  cursor: ns-resize;
}
.ap-fader-slot {
  position: absolute;
  left: 50%;
  top: 8px;
  bottom: 8px;
  width: 2px;
  margin-left: -1px;
  background: #000;
  border-radius: 1px;
}
.ap-fader-fill {
  position: absolute;
  left: 50%;
  width: 2px;
  margin-left: -1px;
  bottom: 8px;
  background: var(--ap-lit);
  border-radius: 1px;
}
.ap-fader-cap {
  position: absolute;
  left: 1px;
  right: 1px;
  height: 18px;
  border-radius: 3px;
  background: linear-gradient(180deg, #5b636f, #2b3038);
  border: 1px solid rgba(0, 0, 0, 0.7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 3px rgba(0, 0, 0, 0.5);
}
.ap-fader-cap::after {
  content: "";
  position: absolute;
  left: 3px;
  right: 3px;
  top: 50%;
  height: 1px;
  background: var(--ap-lit);
  opacity: 0.9;
}

/* ── EQ: curve and bands share one x-axis ────────────────────────────── */
.ap-eq { width: 100%; display: flex; flex-direction: column; gap: 0; }
.ap-eq-curve { display: block; width: 100%; height: 108px; }
.ap-eq-grid { stroke: var(--ap-line); stroke-width: 1; }
.ap-eq-zero { stroke: rgba(255,255,255,0.18); stroke-width: 1; stroke-dasharray: 2 3; }
.ap-eq-fill { fill: rgba(232, 184, 75, 0.12); }
.ap-eq-line { fill: none; stroke: var(--ap-lit); stroke-width: 1.5; stroke-linejoin: round; }
.ap-eq-bands {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 3px;
  padding-top: 8px;
}
.ap-eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  touch-action: none;
  cursor: ns-resize;
}
.ap-eq-band-track {
  position: relative;
  /* Narrow and centred: a band slider is a slot, not a field. */
  width: 20px;
  max-width: 100%;
  height: 62px;
  margin: 0 auto;
  border-radius: 3px;
  background: var(--ap-groove);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
}
.ap-eq-band-track::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 5px;
  bottom: 5px;
  width: 2px;
  margin-left: -1px;
  background: #000;
  border-radius: 1px;
}
.ap-eq-band[data-focused="true"] .ap-eq-band-track { box-shadow: inset 0 0 0 1px var(--ap-lit); }
.ap-eq-band-cap {
  position: absolute;
  left: 1px;
  right: 1px;
  height: 11px;
  border-radius: 2px;
  background: linear-gradient(180deg, #545c68, #2b3038);
  border: 1px solid rgba(0, 0, 0, 0.7);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
.ap-eq-band-cap::after {
  content: "";
  position: absolute;
  left: 2px;
  right: 2px;
  top: 50%;
  height: 1px;
  background: var(--ap-lit);
}
.ap-eq-hz {
  font-family: var(--ap-font-num);
  font-size: 8px;
  color: var(--ap-ink-faint);
  letter-spacing: -0.02em;
}

/* ── switch row ──────────────────────────────────────────────────────── */
/* Switch caps sit level with the knob dials, not with their labels. */
.ap-switches { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 44px; }

/* ── resize grip ─────────────────────────────────────────────────────── */
.ap-grip {
  flex: 0 0 auto;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  background: var(--ap-void);
  border-top: 1px solid rgba(0, 0, 0, 0.6);
  touch-action: none;
}
.ap-grip-bar {
  width: 46px;
  height: 3px;
  border-radius: 2px;
  background: var(--ap-cool);
  transition: background 120ms;
}
.ap-grip:hover .ap-grip-bar { background: var(--ap-ink-dim); }

/* ── toasts ──────────────────────────────────────────────────────────── */
.ap-toasts {
  position: absolute;
  right: 14px;
  bottom: 22px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  pointer-events: none;
  max-width: 60%;
}
.ap-toast {
  pointer-events: auto;
  padding: 7px 11px;
  border-radius: var(--ap-radius);
  background: var(--ap-panel-raised);
  border: 1px solid var(--ap-line);
  border-left: 2px solid var(--ap-ink-dim);
  box-shadow: 0 4px 14px var(--ap-shadow);
  font-size: 11px;
  color: var(--ap-ink);
  cursor: pointer;
}
.ap-toast[data-kind="warn"] { border-left-color: var(--ap-lit); }
.ap-toast[data-kind="error"] { border-left-color: var(--ap-hot); }

/* ── empty + help ────────────────────────────────────────────────────── */
.ap-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 26px 18px;
  color: var(--ap-ink-dim);
  font-size: 12px;
  max-width: 46ch;
}
.ap-empty strong { color: var(--ap-ink); font-weight: 600; }
.ap-kbd {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--ap-groove);
  border: 1px solid var(--ap-line);
  border-bottom-width: 2px;
  font-family: var(--ap-font-num);
  font-size: 10px;
  color: var(--ap-ink);
}
.ap-help {
  position: absolute;
  inset: 42px 0 0 0;
  background: rgba(15, 17, 21, 0.97);
  padding: 16px 18px;
  overflow-y: auto;
  columns: 240px;
  column-gap: 26px;
}
.ap-help-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  break-inside: avoid;
  font-size: 11px;
  color: var(--ap-ink-dim);
}
.ap-help-group {
  break-inside: avoid;
  margin-bottom: 12px;
}
.ap-help-group > .ap-legend { display: block; margin-bottom: 5px; color: var(--ap-lit); }

@media (prefers-reduced-motion: reduce) {
  .ap-root *, .ap-shell { transition-duration: 1ms !important; }
}
.ap-root[data-reduce-motion="true"] *, .ap-shell[data-reduce-motion="true"] { transition-duration: 1ms !important; }

/* ── dashboard-only ──────────────────────────────────────────────────── */
.ap-page {
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 50% 0%, #22262e 0%, var(--ap-void) 62%);
  padding: 0;
}
.ap-page-inner { max-width: 1180px; margin: 0 auto; padding: 22px 20px 64px; }
.ap-page-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--ap-line);
  flex-wrap: wrap;
}
.ap-tabs { display: flex; gap: 10px; }
.ap-tab {
  padding: 6px 4px;
  border-radius: var(--ap-radius) var(--ap-radius) 0 0;
  font-family: var(--ap-font-legend);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ap-ink-faint);
  border-bottom: 2px solid transparent;
}
.ap-tab[data-on="true"] { color: var(--ap-ink); border-bottom-color: var(--ap-lit); }
.ap-section { display: grid; grid-template-columns: 260px 1fr; gap: 18px; align-items: start; }
.ap-card {
  background: var(--ap-panel);
  border: 1px solid rgba(0,0,0,0.5);
  border-radius: 6px;
  box-shadow: inset 0 1px 0 var(--ap-bevel);
  padding: 14px;
}
.ap-list { display: flex; flex-direction: column; gap: 6px; }
.ap-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: var(--ap-radius);
  background: var(--ap-chassis);
  border: 1px solid transparent;
}
.ap-row[data-selected="true"] { border-color: rgba(232,184,75,0.35); }
.ap-row-main { flex: 1; min-width: 0; }
.ap-row-title { font-size: 12px; color: var(--ap-ink); }
.ap-row-sub { font-size: 11px; color: var(--ap-ink-faint); }
.ap-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 11px; }
.ap-input {
  height: 28px;
  padding: 0 9px;
  border-radius: var(--ap-radius);
  background: var(--ap-groove);
  border: 1px solid var(--ap-line);
  color: var(--ap-ink);
  font-size: 12px;
  width: 100%;
}
.ap-input:focus { outline: none; border-color: var(--ap-lit); }
textarea.ap-input { height: auto; padding: 7px 9px; resize: vertical; min-height: 56px; }
.ap-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 5px; }
.ap-check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ap-ink-dim); cursor: pointer; }
.ap-check input { accent-color: var(--ap-lit); }

@media (max-width: 760px) {
  .ap-section { grid-template-columns: 1fr; }
  .ap-body { grid-template-columns: 1fr; }
  .ap-channels { flex-direction: row; overflow-x: auto; border-right: none; border-bottom: 1px solid rgba(0,0,0,0.6); }
  .ap-strip { min-width: 168px; }
}
`
