import { d as defaultAudio, c as clampVolume, V as VOLUME_STEP, r as readSettings, o as originOf } from "./chunks/origin-C1Nq_0c0.js";
function resolveAudio(settings2, origin) {
  if (settings2.globalOn) return { ...settings2.global };
  const site = settings2.sites[origin];
  return site ? { volume: site.volume, muted: site.muted } : defaultAudio();
}
function scopeFor(settings2) {
  return settings2.globalOn ? "global" : "site";
}
function readScope(settings2, scope, origin) {
  if (scope === "global") return { ...settings2.global };
  const site = settings2.sites[origin];
  return site ? { volume: site.volume, muted: site.muted } : defaultAudio();
}
function writeScope(settings2, scope, origin, patch) {
  if (scope === "global") {
    settings2.global = {
      volume: clampVolume(patch.volume ?? settings2.global.volume),
      muted: patch.muted ?? settings2.global.muted
    };
    return { ...settings2.global };
  }
  const current = settings2.sites[origin];
  const next = {
    origin,
    volume: clampVolume(patch.volume ?? current?.volume ?? 1),
    muted: patch.muted ?? current?.muted ?? false,
    updatedAt: Date.now()
  };
  settings2.sites[origin] = next;
  return { volume: next.volume, muted: next.muted };
}
function nudge(current, steps) {
  const volume = clampVolume(current.volume + steps * VOLUME_STEP);
  if (steps > 0 && current.muted) return { volume, muted: false };
  return { volume, muted: current.muted };
}
const STORAGE_KEY = "audio-punch:settings";
const WRITE_DEBOUNCE_MS = 250;
const ACTIVE_TTL_MS = 700;
const FANOUT_MS = 30;
const SEND_TIMEOUT_MS = 2e3;
let settings = null;
let loading = null;
let writeTimer = null;
const cappedTabs = /* @__PURE__ */ new Set();
function load() {
  if (settings) return Promise.resolve(settings);
  loading ??= chrome.storage.local.get(STORAGE_KEY).then((bag) => {
    settings ??= readSettings(bag[STORAGE_KEY]);
    loading = null;
    return settings;
  });
  return loading;
}
function persist() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }, WRITE_DEBOUNCE_MS);
}
function send(tabId, command) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, command),
    new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS))
  ]).then(
    () => void 0,
    // No content script there (an unsupported page, or one still loading).
    () => void 0
  );
}
function pushTab(tabId, url, announce = false, seq) {
  const origin = originOf(url);
  if (!origin || !settings) return Promise.resolve();
  return send(tabId, {
    type: "content:apply",
    audio: resolveAudio(settings, origin),
    announce,
    global: settings.globalOn,
    seq
  });
}
let fanTimer = null;
let fanScope = "site";
let fanOrigin = "";
let fanSkip;
function scheduleFanOut(scope, origin, skipTabId) {
  fanScope = scope;
  fanOrigin = origin;
  fanSkip = skipTabId;
  if (fanTimer) return;
  fanTimer = setTimeout(() => {
    fanTimer = null;
    void fanOut(fanScope, fanOrigin, fanSkip);
  }, FANOUT_MS);
}
async function fanOut(scope, origin, skipTabId) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === void 0 || tab.id === skipTabId) continue;
    if (scope === "site" && originOf(tab.url) !== origin) continue;
    void pushTab(tab.id, tab.url);
  }
}
let activeCache = null;
function forgetActive() {
  activeCache = null;
}
async function activeTab() {
  if (activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) return activeCache.tab;
  const [inCurrent] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = inCurrent ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null;
  activeCache = { tab, at: Date.now() };
  return tab;
}
let notifyTimer = null;
function scheduleNotify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void notifyPopup();
  }, FANOUT_MS);
}
async function notifyPopup() {
  try {
    await chrome.runtime.sendMessage({
      type: "popup:changed",
      state: await popupState()
    });
  } catch {
  }
}
async function popupState() {
  const current = await load();
  const tab = await activeTab();
  const origin = originOf(tab?.url);
  return {
    settings: current,
    origin,
    title: tab?.title ?? "",
    supported: origin !== "",
    boostCapped: tab?.id !== void 0 && cappedTabs.has(tab.id)
  };
}
function commit(current, scope, origin, patch, front, announce = false, echo) {
  writeScope(current, scope, origin, patch);
  persist();
  if (front?.id !== void 0 && originOf(front.url) !== "") {
    void pushTab(front.id, front.url, announce, echo?.tabId === front.id ? echo.seq : void 0);
  }
  scheduleFanOut(scope, origin, front?.id);
  scheduleNotify();
}
async function runCommand(command, echo) {
  const current = await load();
  const tab = await activeTab();
  const origin = originOf(tab?.url);
  const scope = scopeFor(current);
  if (scope === "site" && !origin) return;
  switch (command) {
    case "volume-up":
      commit(current, scope, origin, nudge(readScope(current, scope, origin), 1), tab, true, echo);
      break;
    case "volume-down":
      commit(current, scope, origin, nudge(readScope(current, scope, origin), -1), tab, true, echo);
      break;
    case "toggle-mute":
      commit(current, scope, origin, { muted: !readScope(current, scope, origin).muted }, tab, true, echo);
      break;
    case "toggle-global":
      current.globalOn = !current.globalOn;
      persist();
      if (tab?.id !== void 0) {
        void pushTab(tab.id, tab.url, true, echo?.tabId === tab.id ? echo.seq : void 0);
      }
      scheduleFanOut("global", origin, tab?.id);
      scheduleNotify();
      break;
    case "reset":
      commit(current, scope, origin, defaultAudio(), tab, true, echo);
      break;
  }
}
async function bindings() {
  const commands = await chrome.commands.getAll();
  return commands.filter(
    (c) => Boolean(c.name && c.shortcut)
  ).map((c) => ({ command: c.name, shortcut: c.shortcut }));
}
async function handle(request) {
  const current = await load();
  const tab = await activeTab();
  const origin = originOf(tab?.url);
  switch (request.type) {
    case "popup:hello":
      break;
    case "popup:set-global-on":
      current.globalOn = request.on;
      persist();
      if (tab?.id !== void 0) void pushTab(tab.id, tab.url);
      scheduleFanOut("global", origin, tab?.id);
      break;
    case "popup:set-volume":
      if (request.scope === "site" && !origin) break;
      commit(current, request.scope, origin, { volume: request.volume }, tab);
      break;
    case "popup:nudge-volume":
      if (request.scope === "site" && !origin) break;
      commit(
        current,
        request.scope,
        origin,
        nudge(readScope(current, request.scope, origin), request.steps),
        tab
      );
      break;
    case "popup:set-muted":
      if (request.scope === "site" && !origin) break;
      commit(current, request.scope, origin, { muted: request.muted }, tab);
      break;
    case "popup:reset":
      if (request.scope === "site" && !origin) break;
      commit(current, request.scope, origin, defaultAudio(), tab);
      break;
  }
  return { ok: true, state: await popupState() };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "content:ready") {
    const tabId = sender.tab?.id;
    if (tabId !== void 0) {
      if (message.capped) cappedTabs.add(tabId);
      else cappedTabs.delete(tabId);
      scheduleNotify();
      void load().then(async () => {
        await pushTab(tabId, sender.tab?.url);
        await send(tabId, { type: "content:bindings", bindings: await bindings() });
      });
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "content:command") {
    const tabId = sender.tab?.id;
    void runCommand(
      message.command,
      tabId === void 0 ? void 0 : { tabId, seq: message.seq }
    );
    sendResponse({ ok: true });
    return false;
  }
  void handle(message).then(sendResponse).catch(
    (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
  );
  return true;
});
chrome.commands.onCommand.addListener((command) => {
  void runCommand(command);
});
chrome.tabs.onActivated.addListener(forgetActive);
chrome.tabs.onRemoved.addListener((tabId) => {
  cappedTabs.delete(tabId);
  forgetActive();
});
chrome.windows.onFocusChanged.addListener(forgetActive);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    cappedTabs.delete(tabId);
    forgetActive();
  }
  if (changeInfo.title) forgetActive();
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  void load().then(() => pushTab(tabId, changeInfo.url ?? tab.url));
});
chrome.runtime.onStartup.addListener(() => void load());
chrome.runtime.onInstalled.addListener(() => void load());
void load();
