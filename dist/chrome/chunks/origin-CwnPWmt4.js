const MIN_VOLUME = 0;
const MAX_VOLUME = 6;
const VOLUME_STEP = 0.1;
const SCHEMA_VERSION = 1;
const COMMANDS = [
  "volume-up",
  "volume-down",
  "toggle-mute",
  "reset",
  "toggle-global"
];
function codeFor(name) {
  const compact = name.replace(/\s+/g, "");
  const named = {
    Up: "ArrowUp",
    UpArrow: "ArrowUp",
    Down: "ArrowDown",
    DownArrow: "ArrowDown",
    Left: "ArrowLeft",
    LeftArrow: "ArrowLeft",
    Right: "ArrowRight",
    RightArrow: "ArrowRight",
    Comma: "Comma",
    Period: "Period"
  };
  if (named[compact]) return named[compact];
  if (/^[A-Za-z]$/.test(compact)) return `Key${compact.toUpperCase()}`;
  if (/^[0-9]$/.test(compact)) return `Digit${compact}`;
  return compact;
}
function parseShortcut(shortcut) {
  const parts = shortcut.split("+").map((p) => p.trim());
  const key = parts.pop();
  if (!key) return null;
  const lower = parts.map((p) => p.toLowerCase());
  return {
    code: codeFor(key),
    ctrl: lower.includes("ctrl") || lower.includes("macctrl"),
    alt: lower.includes("alt") || lower.includes("option"),
    shift: lower.includes("shift"),
    meta: lower.includes("command") || lower.includes("meta")
  };
}
function sameShortcut(a, b) {
  const x = parseShortcut(a);
  const y = parseShortcut(b);
  if (!x || !y) return false;
  return x.code === y.code && x.ctrl === y.ctrl && x.alt === y.alt && x.shift === y.shift && x.meta === y.meta;
}
const MODIFIER_CODES = /* @__PURE__ */ new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight"
]);
function shortcutFromEvent(event) {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Command");
  parts.push(event.code);
  return parts.join("+");
}
function prettyShortcut(shortcut) {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return shortcut;
  const glyphs = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Backquote: "`"
  };
  const key = glyphs[parsed.code] ?? parsed.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  const parts = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Cmd");
  parts.push(key);
  return parts.join("+");
}
function clampVolume(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const clamped = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, value));
  return Math.round(clamped * 100) / 100;
}
function defaultAudio() {
  return { volume: 1, muted: false };
}
function defaultSettings() {
  return {
    schema: SCHEMA_VERSION,
    globalOn: false,
    global: defaultAudio(),
    sites: {},
    bindings: {}
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readAudio(raw) {
  if (!isRecord(raw)) return defaultAudio();
  return { volume: clampVolume(raw.volume), muted: raw.muted === true };
}
function readSettings(raw) {
  const settings = defaultSettings();
  if (!isRecord(raw)) return settings;
  settings.globalOn = raw.globalOn === true;
  settings.global = readAudio(raw.global);
  if (isRecord(raw.sites)) {
    for (const [origin, value] of Object.entries(raw.sites)) {
      if (!origin.startsWith("http")) continue;
      const audio = readAudio(value);
      settings.sites[origin] = {
        origin,
        volume: audio.volume,
        muted: audio.muted,
        updatedAt: isRecord(value) && typeof value.updatedAt === "number" ? value.updatedAt : 0
      };
    }
  }
  if (isRecord(raw.bindings)) {
    for (const [command, shortcut] of Object.entries(raw.bindings)) {
      if (!COMMANDS.includes(command) || typeof shortcut !== "string") continue;
      if (shortcut !== "" && !parseShortcut(shortcut)) continue;
      settings.bindings[command] = shortcut;
    }
  }
  return settings;
}
function formatVolume(volume) {
  return `${Math.round(volume * 100)}%`;
}
const UNSUPPORTED_HOSTS = [
  "chromewebstore.google.com",
  "chrome.google.com",
  "addons.mozilla.org"
];
function originOf(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (UNSUPPORTED_HOSTS.includes(parsed.host)) return "";
    if (parsed.pathname.endsWith(".pdf")) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}
function prettyOrigin(origin) {
  if (!origin) return "This page";
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return origin;
  }
}
export {
  COMMANDS as C,
  MAX_VOLUME as M,
  VOLUME_STEP as V,
  prettyShortcut as a,
  sameShortcut as b,
  clampVolume as c,
  defaultAudio as d,
  formatVolume as f,
  originOf as o,
  prettyOrigin as p,
  readSettings as r,
  shortcutFromEvent as s
};
