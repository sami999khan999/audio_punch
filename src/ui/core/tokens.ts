/**
 * The visual system, as one stylesheet string.
 *
 * A string rather than a .css file because the overlay renders inside a closed
 * shadow root on arbitrary pages: no external stylesheet can be relied on to
 * load, and nothing here may leak out. The dashboard adopts the same sheet, so
 * both surfaces are guaranteed to match.
 *
 * Design notes, so later edits keep the intent:
 *
 * - The backdrop carries the mood; the interface is glass laid over it. Every
 *   surface is a translucent white wash with a blur behind it, never an opaque
 *   panel — that is what keeps the user's own photo or video present instead of
 *   merely decorative.
 * - Legibility over a photograph is the whole design problem. It is solved
 *   twice over: a tunable scrim darkens the image, and every glass surface adds
 *   its own wash. Text is pure white at varying opacity, never grey, because
 *   grey on a busy image disappears.
 * - Type does the structural work. One family, separated by treatment: a heavy,
 *   tightly-tracked uppercase display for the hero, wide-tracked uppercase
 *   micro-labels for everything a control needs to say, and tabular figures for
 *   every number so readouts do not jitter.
 * - No webfonts. A content script cannot count on a page's CSP allowing a font
 *   request, so all of it comes from system stacks.
 */

export const STYLESHEET = `
.ap-root {
  --ap-ink: #ffffff;
  --ap-ink-2: rgba(255, 255, 255, 0.72);
  --ap-ink-3: rgba(255, 255, 255, 0.46);
  --ap-ink-4: rgba(255, 255, 255, 0.26);

  --ap-glass: rgba(255, 255, 255, 0.09);
  --ap-glass-hi: rgba(255, 255, 255, 0.15);
  --ap-glass-lo: rgba(255, 255, 255, 0.055);
  --ap-edge: rgba(255, 255, 255, 0.18);
  --ap-edge-soft: rgba(255, 255, 255, 0.10);
  --ap-shadow: 0 10px 34px rgba(0, 0, 0, 0.3);

  --ap-accent: #7fd4c1;
  --ap-hot: #ff6b5a;
  --ap-void: #0d1412;

  --ap-r-card: 16px;
  --ap-r-tile: 12px;
  --ap-r-pill: 999px;
  --ap-blur: blur(22px) saturate(150%);

  --ap-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ap-font-num: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;

  color: var(--ap-ink);
  font-family: var(--ap-font);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}
.ap-root *, .ap-root *::before, .ap-root *::after { box-sizing: inherit; }
.ap-root [hidden] { display: none !important; }
/*
 * Wrapped in :where() so the reset carries zero specificity.
 * Written plainly as '.ap-root button' it scores (0,1,1) and silently beats
 * every single-class component below it — .ap-pill, .ap-icon-btn, .ap-tab and
 * the rest all lost their background and border to it, and only their
 * [data-on] states survived. Do not unwrap this.
 */
:where(.ap-root button) {
  font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer;
}
:where(.ap-root input, .ap-root select, .ap-root textarea) { font: inherit; color: inherit; }
.ap-root :focus-visible {
  outline: 2px solid var(--ap-accent);
  outline-offset: 3px;
  border-radius: 6px;
}

/* ── type roles ──────────────────────────────────────────────────────── */
.ap-display {
  font-size: clamp(26px, 3.4vw, 44px);
  font-weight: 800;
  line-height: 0.98;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  font-stretch: condensed;
  text-wrap: balance;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.35);
}
.ap-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--ap-ink-3);
  white-space: nowrap;
}
.ap-num {
  font-family: var(--ap-font-num);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

/* ── custom scrollbar ────────────────────────────────────────────────── */
.ap-root ::-webkit-scrollbar { width: 10px; height: 10px; }
.ap-root ::-webkit-scrollbar-track { background: transparent; }
.ap-root ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: var(--ap-r-pill);
  border: 3px solid transparent;
  background-clip: content-box;
}
.ap-root ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.34); background-clip: content-box; }
.ap-root ::-webkit-scrollbar-corner { background: transparent; }
.ap-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.25) transparent; }

/* ── overlay shell ───────────────────────────────────────────────────── */
.ap-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  opacity: 0;
  visibility: hidden;
  transition: opacity 220ms ease, visibility 0s linear 220ms;
  /* Critical: a closed overlay must not hit-test. Leaving it clickable put an
     invisible sheet over the page and made video controls unreachable. */
  pointer-events: none;
}
.ap-overlay[data-open="true"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition: opacity 220ms ease, visibility 0s;
}

/* The backdrop is the user's image or video, plus a scrim for legibility. */
.ap-backdrop { position: absolute; inset: 0; overflow: hidden; background: var(--ap-void); }
.ap-backdrop-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(var(--ap-bg-blur, 0px));
  transform: scale(1.06);
}
.ap-backdrop-scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.06) 45%, rgba(0,0,0,0.26) 100%),
    rgba(0, 0, 0, var(--ap-bg-dim, 0.45));
}

.ap-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  transform: translateY(-14px);
  transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.ap-overlay[data-open="true"] .ap-panel { transform: translateY(0); }
/* When the grip has set an explicit height the panel stops filling the view
   and the rest of the backdrop shows through. */
.ap-overlay[data-sized="true"] .ap-panel { flex: 0 0 auto; }

/* ── layout ──────────────────────────────────────────────────────────── */
.ap-body {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) 268px;
  gap: 18px;
  padding: 18px 22px 8px;
  min-height: 0;
}
.ap-col { display: flex; flex-direction: column; gap: 14px; min-height: 0; min-width: 0; }
.ap-col-main { overflow: hidden; }
.ap-col-side { overflow-y: auto; overflow-x: hidden; padding-right: 4px; }

/* ── top bar ─────────────────────────────────────────────────────────── */
.ap-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px 0;
  flex: 0 0 auto;
}
.ap-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.ap-brand b { font-weight: 800; }
.ap-brand span { color: var(--ap-ink-3); font-weight: 600; }
.ap-spacer { flex: 1 1 auto; }

/* ── glass primitives ────────────────────────────────────────────────── */
.ap-glass {
  background: var(--ap-glass);
  border: 1px solid var(--ap-edge-soft);
  border-radius: var(--ap-r-card);
  backdrop-filter: var(--ap-blur);
  -webkit-backdrop-filter: var(--ap-blur);
  box-shadow: var(--ap-shadow);
}
.ap-card { padding: 13px 14px; }

.ap-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--ap-r-pill);
  background: var(--ap-glass);
  border: 1px solid var(--ap-edge-soft);
  backdrop-filter: var(--ap-blur);
  -webkit-backdrop-filter: var(--ap-blur);
  color: var(--ap-ink-2);
  font-size: 13px;
  transition: background 140ms, color 140ms, transform 140ms;
}
.ap-icon-btn:hover { background: var(--ap-glass-hi); color: var(--ap-ink); }
.ap-icon-btn:active { transform: scale(0.94); }
.ap-icon-btn[data-on="true"] { background: var(--ap-accent); color: #06201a; border-color: transparent; }

.ap-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding: 0 12px;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ap-ink-2);
  transition: background 140ms, color 140ms, border-color 140ms;
}
.ap-pill:hover { background: rgba(255, 255, 255, 0.24); color: var(--ap-ink); }
.ap-pill[data-on="true"] {
  background: var(--ap-accent);
  border-color: transparent;
  color: #06201a;
}
.ap-pill[data-tone="hot"][data-on="true"] { background: var(--ap-hot); color: #fff; }
.ap-pill[disabled] { opacity: 0.4; cursor: not-allowed; }

/* ── hero ────────────────────────────────────────────────────────────── */
.ap-hero { display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto; }
.ap-hero-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ap-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.12);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ap-ink-2);
}
.ap-chip[data-tone="accent"] { background: rgba(127, 212, 193, 0.22); color: var(--ap-accent); }
.ap-chip[data-tone="hot"] { background: rgba(255, 107, 90, 0.22); color: var(--ap-hot); }

/* ── master rail (left) ──────────────────────────────────────────────── */
.ap-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
  flex: 0 0 auto;
}
.ap-vslider {
  position: relative;
  width: 26px;
  flex: 1 1 auto;
  min-height: 120px;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--ap-edge-soft);
  backdrop-filter: var(--ap-blur);
  -webkit-backdrop-filter: var(--ap-blur);
  overflow: hidden;
  cursor: ns-resize;
  touch-action: none;
}
.ap-vslider-fill {
  position: absolute;
  left: 3px; right: 3px; bottom: 3px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.34));
  border-radius: var(--ap-r-pill);
}
/* The cap marks the exact value; the fill below is just travel. */
.ap-vslider-fill::before {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 3px;
  border-radius: var(--ap-r-pill);
  background: #fff;
}
.ap-vslider-meter {
  position: absolute;
  left: 50%; bottom: 4px;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: var(--ap-accent);
  opacity: 0.9;
  pointer-events: none;
}

/* ── horizontal slider inside a card ─────────────────────────────────── */
.ap-slider {
  position: relative;
  height: 6px;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.16);
  cursor: ew-resize;
  touch-action: none;
}
.ap-slider-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.92);
}
.ap-slider-knob {
  position: absolute;
  top: 50%;
  width: 13px; height: 13px;
  margin: -6.5px 0 0 -6.5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: transform 120ms;
}
.ap-slider:hover .ap-slider-knob, .ap-slider[data-active="true"] .ap-slider-knob { transform: scale(1.18); }
.ap-slider[data-tone="accent"] .ap-slider-fill { background: var(--ap-accent); }

/* ── tab / source cards ──────────────────────────────────────────────── */
.ap-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 12px;
  align-content: start;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  min-height: 0;
  /* Fade the cut edge so a clipped card reads as "more below" rather than as
     a rendering fault. */
  -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 26px), transparent 100%);
  mask-image: linear-gradient(180deg, #000 calc(100% - 26px), transparent 100%);
}
.ap-tile {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 13px 14px 14px;
  border-radius: var(--ap-r-card);
  background: var(--ap-glass-lo);
  border: 1px solid var(--ap-edge-soft);
  backdrop-filter: var(--ap-blur);
  -webkit-backdrop-filter: var(--ap-blur);
  text-align: left;
  width: 100%;
  transition: background 160ms, border-color 160ms, transform 160ms;
}
.ap-tile:hover { background: var(--ap-glass); transform: translateY(-1px); }
.ap-tile[data-selected="true"] { background: var(--ap-glass-hi); border-color: var(--ap-edge); }
.ap-tile[data-bus="true"][data-selected="true"] { border-color: rgba(127, 212, 193, 0.55); }
.ap-tile-head { display: flex; align-items: flex-start; gap: 9px; }
.ap-tile-icon {
  width: 26px; height: 26px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  overflow: hidden;
}
.ap-tile-icon img { width: 15px; height: 15px; border-radius: 3px; }
.ap-tile-text { min-width: 0; flex: 1 1 auto; }
.ap-tile-name {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-tile-sub {
  font-size: 10.5px;
  color: var(--ap-ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-tile-foot { display: flex; align-items: center; gap: 9px; }
.ap-tile-foot .ap-slider { flex: 1 1 auto; }
.ap-tile-val { color: var(--ap-ink-2); min-width: 38px; text-align: right; }

/* ── group tabs ──────────────────────────────────────────────────────── */
.ap-tabs {
  display: flex;
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid var(--ap-edge-soft);
  padding-bottom: 8px;
  flex: 0 0 auto;
  overflow-x: auto;
}
.ap-tab {
  position: relative;
  padding-bottom: 8px;
  margin-bottom: -9px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ap-ink-3);
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 140ms, border-color 140ms;
}
.ap-tab sup { font-size: 8px; margin-left: 2px; color: var(--ap-ink-4); }
.ap-tab:hover { color: var(--ap-ink-2); }
.ap-tab[data-on="true"] { color: var(--ap-ink); border-bottom-color: var(--ap-ink); }

/* ── module cards ────────────────────────────────────────────────────── */
.ap-modules {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(224px, 1fr));
  gap: 12px;
  align-content: start;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 4px 12px 0;
  min-height: 0;
}
.ap-module {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 14px 15px;
  border-radius: var(--ap-r-card);
  background: var(--ap-glass-lo);
  border: 1px solid var(--ap-edge-soft);
  backdrop-filter: var(--ap-blur);
  -webkit-backdrop-filter: var(--ap-blur);
  transition: background 160ms;
}
.ap-module[data-on="true"] { background: var(--ap-glass); }
.ap-module[data-on="false"] .ap-module-body { opacity: 0.42; }
.ap-module-head { display: flex; align-items: center; gap: 9px; }
.ap-module-head .ap-label { flex: 1 1 auto; color: var(--ap-ink-2); }
.ap-module-body { display: flex; flex-direction: column; gap: 11px; transition: opacity 160ms; }
.ap-module[data-span="wide"] { grid-column: 1 / -1; }

.ap-param { display: flex; flex-direction: column; gap: 5px; }
.ap-param-head { display: flex; align-items: baseline; gap: 8px; }
.ap-param-head .ap-label { flex: 1 1 auto; }
.ap-note { font-size: 10.5px; color: var(--ap-ink-3); }

/* ── switch ──────────────────────────────────────────────────────────── */
.ap-switch {
  position: relative;
  width: 34px; height: 19px;
  flex: 0 0 auto;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.26);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: background 160ms;
}
.ap-switch::after {
  content: "";
  position: absolute;
  top: 2px; left: 2px;
  width: 13px; height: 13px;
  border-radius: 50%;
  background: #fff;
  transition: transform 160ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.ap-switch[data-on="true"] { background: var(--ap-accent); border-color: transparent; }
.ap-switch[data-on="true"]::after { transform: translateX(15px); }

/* ── EQ ──────────────────────────────────────────────────────────────── */
.ap-eq { display: flex; flex-direction: column; gap: 4px; }
.ap-eq-curve { display: block; width: 100%; height: 84px; }
.ap-eq-grid { stroke: rgba(255, 255, 255, 0.1); stroke-width: 1; }
.ap-eq-zero { stroke: rgba(255, 255, 255, 0.2); stroke-width: 1; stroke-dasharray: 2 4; }
.ap-eq-fill { fill: rgba(127, 212, 193, 0.18); }
.ap-eq-line { fill: none; stroke: var(--ap-accent); stroke-width: 2; stroke-linejoin: round; }
.ap-eq-bands { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.ap-eq-band {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  cursor: ns-resize; touch-action: none;
}
.ap-eq-band-track {
  position: relative;
  width: 22px;
  max-width: 100%;
  height: 58px;
  margin: 0 auto;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
/* The centre line the fills grow out from. */
.ap-eq-band-track::before {
  content: "";
  position: absolute;
  left: 3px; right: 3px; top: 50%;
  height: 1px;
  margin-top: -0.5px;
  background: rgba(255, 255, 255, 0.3);
}
.ap-eq-band[data-focused="true"] .ap-eq-band-track { box-shadow: inset 0 0 0 1px var(--ap-accent); }
.ap-eq-band-fill {
  position: absolute; left: 0; right: 0;
  background: rgba(255, 255, 255, 0.9);
  border-radius: var(--ap-r-pill);
}
.ap-eq-hz { font-family: var(--ap-font-num); font-size: 8px; color: var(--ap-ink-4); }

/* ── background picker ───────────────────────────────────────────────── */
.ap-bg-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.ap-bg-swatch {
  aspect-ratio: 1;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid var(--ap-edge-soft);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  color: var(--ap-ink-3);
  transition: border-color 140ms, transform 140ms;
}
.ap-bg-swatch:hover { transform: translateY(-1px); border-color: var(--ap-edge); }
.ap-bg-swatch[data-on="true"] { border-color: var(--ap-accent); }
.ap-bg-swatch img, .ap-bg-swatch video { width: 100%; height: 100%; object-fit: cover; }

/* ── resize grip ─────────────────────────────────────────────────────── */
.ap-grip {
  flex: 0 0 auto;
  height: 18px;
  display: flex; align-items: center; justify-content: center;
  cursor: ns-resize;
  touch-action: none;
}
.ap-grip-bar {
  width: 54px; height: 4px;
  border-radius: var(--ap-r-pill);
  background: rgba(255, 255, 255, 0.24);
  transition: background 140ms, width 140ms;
}
.ap-grip:hover .ap-grip-bar { background: rgba(255, 255, 255, 0.55); width: 74px; }

/* ── toasts, help, empty ─────────────────────────────────────────────── */
.ap-toasts {
  position: absolute;
  right: 22px; bottom: 26px;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
  pointer-events: none;
  max-width: 62%;
  z-index: 5;
}
.ap-toast {
  pointer-events: auto;
  padding: 9px 14px;
  border-radius: var(--ap-r-pill);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--ap-edge-soft);
  backdrop-filter: var(--ap-blur);
  -webkit-backdrop-filter: var(--ap-blur);
  font-size: 11.5px;
  cursor: pointer;
}
.ap-toast[data-kind="warn"] { border-color: rgba(255, 199, 0, 0.45); }
.ap-toast[data-kind="error"] { border-color: rgba(255, 107, 90, 0.55); }

.ap-empty {
  display: flex; flex-direction: column; gap: 8px;
  padding: 34px 4px;
  color: var(--ap-ink-3);
  max-width: 48ch;
}
.ap-empty strong { color: var(--ap-ink); font-weight: 700; font-size: 14px; }

.ap-help {
  position: absolute;
  inset: 0;
  z-index: 6;
  background: rgba(6, 14, 12, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 26px 30px;
  overflow-y: auto;
  columns: 250px;
  column-gap: 30px;
}
.ap-help-group { break-inside: avoid; margin-bottom: 16px; }
.ap-help-group > .ap-label { display: block; margin-bottom: 7px; color: var(--ap-accent); }
.ap-help-row {
  display: flex; justify-content: space-between; gap: 14px;
  padding: 3px 0;
  break-inside: avoid;
  font-size: 11.5px;
  color: var(--ap-ink-2);
}
.ap-kbd {
  font-family: var(--ap-font-num);
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  color: var(--ap-ink);
  white-space: nowrap;
}

/* ── forms ───────────────────────────────────────────────────────────── */
.ap-input {
  height: 30px;
  padding: 0 11px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--ap-edge-soft);
  color: var(--ap-ink);
  font-size: 12px;
  width: 100%;
}
.ap-input::placeholder { color: var(--ap-ink-4); }
.ap-input:focus { outline: none; border-color: var(--ap-accent); }
textarea.ap-input { height: auto; padding: 8px 11px; resize: vertical; min-height: 62px; }
.ap-input option { background: #16201d; color: #fff; }
.ap-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 13px; }
.ap-row { display: flex; align-items: center; gap: 9px; }
.ap-wrap { display: flex; flex-wrap: wrap; gap: 7px; }

@media (prefers-reduced-motion: reduce) {
  .ap-root *, .ap-overlay, .ap-panel { transition-duration: 1ms !important; }
}
.ap-root[data-reduce-motion="true"] *, .ap-overlay[data-reduce-motion="true"] * {
  transition-duration: 1ms !important;
}

/* ── dashboard ───────────────────────────────────────────────────────── */
.ap-page { position: relative; min-height: 100vh; display: flex; flex-direction: column; }
.ap-page > .ap-backdrop { position: fixed; }
.ap-page-inner {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 20px 26px 50px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ap-page-head {
  display: flex; align-items: center; gap: 22px;
  padding-bottom: 14px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--ap-edge-soft);
  flex-wrap: wrap;
}
.ap-section { display: grid; grid-template-columns: 292px minmax(0, 1fr); gap: 20px; align-items: start; }
.ap-list { display: flex; flex-direction: column; gap: 8px; }
.ap-listrow {
  display: flex; align-items: center; gap: 11px;
  padding: 11px 13px;
  border-radius: var(--ap-r-tile);
  background: var(--ap-glass-lo);
  border: 1px solid transparent;
  transition: background 140ms, border-color 140ms;
}
.ap-listrow:hover { background: var(--ap-glass); }
.ap-listrow[data-selected="true"] { background: var(--ap-glass); border-color: var(--ap-edge); }
.ap-listrow-main { flex: 1 1 auto; min-width: 0; }
.ap-listrow-title { font-size: 12.5px; font-weight: 600; }
.ap-listrow-sub { font-size: 11px; color: var(--ap-ink-3); }
.ap-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }
.ap-check { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--ap-ink-2); cursor: pointer; }
.ap-check input { accent-color: var(--ap-accent); }

@media (max-width: 900px) {
  .ap-body { grid-template-columns: 46px minmax(0, 1fr); }
  .ap-col-side { display: none; }
  .ap-section { grid-template-columns: 1fr; }
}
`
