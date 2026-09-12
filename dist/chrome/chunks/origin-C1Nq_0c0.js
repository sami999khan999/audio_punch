const MIN_VOLUME = 0;
const MAX_VOLUME = 6;
const VOLUME_STEP = 0.1;
const SCHEMA_VERSION = 1;
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
    sites: {}
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
  MAX_VOLUME as M,
  VOLUME_STEP as V,
  clampVolume as c,
  defaultAudio as d,
  formatVolume as f,
  originOf as o,
  prettyOrigin as p,
  readSettings as r
};
