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
let settings = null;
let writeTimer = null;
const cappedTabs = /* @__PURE__ */ new Set();
async function load() {
  if (settings) return settings;
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  settings = readSettings(bag[STORAGE_KEY]);
  return settings;
}
function persist() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }, WRITE_DEBOUNCE_MS);
}
async function send(tabId, command) {
  try {
    await chrome.tabs.sendMessage(tabId, command);
  } catch {
  }
}
async function pushTab(tabId, url, announce = false) {
  const origin = originOf(url);
  if (!origin || !settings) return;
  await send(tabId, {
    type: "content:apply",
    audio: resolveAudio(settings, origin),
    announce,
    global: settings.globalOn
  });
}
async function pushAll(announce = false) {
  const tabs = await chrome.tabs.query({});
  const active = announce ? (await activeTab())?.id : void 0;
  await Promise.all(
    tabs.map(
      (tab) => tab.id === void 0 ? void 0 : pushTab(tab.id, tab.url, tab.id === active)
    )
  );
}
async function pushOrigin(origin, announce = false) {
  const tabs = await chrome.tabs.query({});
  const active = announce ? (await activeTab())?.id : void 0;
  await Promise.all(
    tabs.filter((tab) => tab.id !== void 0 && originOf(tab.url) === origin).map((tab) => pushTab(tab.id, tab.url, tab.id === active))
  );
}
async function activeTab() {
  const [inCurrent] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (inCurrent) return inCurrent;
  const [inLast] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return inLast ?? null;
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
async function apply(scope, origin, patch, announce = false) {
  const current = await load();
  writeScope(current, scope, origin, patch);
  persist();
  if (scope === "global") await pushAll(announce);
  else await pushOrigin(origin, announce);
  await notifyPopup();
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
async function runCommand(command) {
  const current = await load();
  const tab = await activeTab();
  const origin = originOf(tab?.url);
  const scope = scopeFor(current);
  if (scope === "site" && !origin) return;
  switch (command) {
    case "volume-up":
      await apply(scope, origin, nudge(readScope(current, scope, origin), 1), true);
      break;
    case "volume-down":
      await apply(scope, origin, nudge(readScope(current, scope, origin), -1), true);
      break;
    case "toggle-mute": {
      const now = readScope(current, scope, origin);
      await apply(scope, origin, { muted: !now.muted }, true);
      break;
    }
    case "toggle-global":
      current.globalOn = !current.globalOn;
      persist();
      await pushAll(true);
      await notifyPopup();
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
      await pushAll();
      break;
    case "popup:set-volume":
      if (request.scope === "site" && !origin) break;
      await apply(request.scope, origin, { volume: request.volume });
      break;
    case "popup:nudge-volume": {
      if (request.scope === "site" && !origin) break;
      const next = nudge(readScope(current, request.scope, origin), request.steps);
      await apply(request.scope, origin, next);
      break;
    }
    case "popup:set-muted":
      if (request.scope === "site" && !origin) break;
      await apply(request.scope, origin, { muted: request.muted });
      break;
    case "popup:reset":
      if (request.scope === "site" && !origin) break;
      await apply(request.scope, origin, defaultAudio());
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
      void notifyPopup();
      void load().then(async () => {
        await pushTab(tabId, sender.tab?.url);
        await send(tabId, { type: "content:bindings", bindings: await bindings() });
      });
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "content:command") {
    void runCommand(message.command);
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
chrome.tabs.onRemoved.addListener((tabId) => cappedTabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) cappedTabs.delete(tabId);
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  void load().then(() => pushTab(tabId, changeInfo.url ?? tab.url));
});
chrome.runtime.onStartup.addListener(() => void load());
chrome.runtime.onInstalled.addListener(() => void load());
void load();
