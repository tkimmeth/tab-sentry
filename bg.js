// bg.js — tabsentry: tracks tabs, saves history, closes idle ones

// boot + heartbeat
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("heartbeat", { periodInMinutes: 0.25 }); // ~15s
  console.log("[tabsentry] heartbeat created");
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "heartbeat") runHeartbeat();
});

// state
const lastActive = {};
let tabUrls = {};
const lockedTabs = new Set();

async function countdownAndClose(victim) {
  let countdown = 5;

  const interval = setInterval(async () => {
    chrome.action.setBadgeText({ text: String(countdown) });
    chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    }

    if (countdown <= 0) {
      clearInterval(interval);
      chrome.action.setBadgeText({ text: "" }); // clear badge
      try {
        await chrome.tabs.remove(victim.id);
        console.log("[tabsentry] Closed:", victim.url);
      } catch (e) {
        console.error("Failed to close:", e);
      }
    }
    countdown--;
  }, 1000);
}


// locks
async function saveLocks() {
  await chrome.storage.local.set({ lockedTabs: Array.from(lockedTabs) });
}
async function loadLocks() {
  const { lockedTabs: stored = [] } = await chrome.storage.local.get("lockedTabs");
  lockedTabs.clear();
  stored.forEach(id => lockedTabs.add(id));
}
loadLocks();

// messages
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "lockTab") {
    lockedTabs.add(msg.tabId); saveLocks(); sendResponse({ ok: true });
  } else if (msg.type === "unlockTab") {
    lockedTabs.delete(msg.tabId); saveLocks(); sendResponse({ ok: true });
  } else if (msg.type === "restoreTab") {
    handleRestoreTab(msg.url, msg.time).then(() => sendResponse({ ok: true })); return true;
  } else if (msg.type === "refreshSettings") {
    loadSettings().then(() => sendResponse({ ok: true })); return true;
  }
});

// history (serialized + de-duped)
let saveChain = Promise.resolve();
function enqueueSave(fn) {
  saveChain = saveChain.then(fn).catch(err => console.error("[history] save err:", err));
  return saveChain;
}
const savedTabIds = new Map();
const TABID_DEDUPE_MS = 8000;

async function saveClosedTab(tabId) {
  const tabData = tabUrls[tabId];
  if (!tabData || !tabData.url) return;

  const { url, title } = tabData;
  if (!url || url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) return;

  return enqueueSave(async () => {
    const now = Date.now();
    const lastSave = savedTabIds.get(tabId) || 0;
    if (now - lastSave < TABID_DEDUPE_MS) return;
    savedTabIds.set(tabId, now);
    setTimeout(() => { if ((savedTabIds.get(tabId) || 0) === now) savedTabIds.delete(tabId); }, TABID_DEDUPE_MS);

    const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
    const top = closedTabs[0];
    if (top && top.url === url) {
      const topTime = new Date(top.time).getTime();
      if (now - topTime < 3000) return; // recent top is same -> skip
    }
    const filtered = closedTabs.filter(t => t.url !== url);
    filtered.unshift({ url, title, time: new Date(now).toISOString() });
    await chrome.storage.local.set({ closedTabs: filtered.slice(0, 50) });
    try { chrome.runtime.sendMessage({ type: "refresh" }); } catch {}
  });
}
chrome.tabs.onRemoved.addListener(async (tabId) => { await saveClosedTab(tabId); delete tabUrls[tabId]; });

// track tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    const url = tab.url || changeInfo.url; if (!url) return;
    let title = tab.title; if (!title) { try { title = new URL(url).hostname; } catch { title = ""; } }
    tabUrls[tabId] = { url, title }; lastActive[tabId] = Date.now();
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => { lastActive[tabId] = Date.now(); });
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab) lastActive[activeTab.id] = Date.now();
});

// restore
async function handleRestoreTab(url, time) {
  await chrome.tabs.create({ url });
  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const newList = closedTabs.filter(t => !(t.url === url && t.time === time));
  await chrome.storage.local.set({ closedTabs: newList });
  try { chrome.runtime.sendMessage({ type: "refresh" }); } catch {}
}

// settings (incl. toggle)
let THRESHOLD_COUNT = 5;
let IDLE_MINUTES = 10;
let ENABLED = true;

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  THRESHOLD_COUNT = settings.threshold ?? 5;
  IDLE_MINUTES  = settings.idleTimeout ?? 10;
  ENABLED       = settings.enabled ?? true;
  console.log("[tabsentry] settings:", { THRESHOLD_COUNT, IDLE_MINUTES, ENABLED });
}
loadSettings();
chrome.storage.onChanged.addListener(changes => { if (changes.settings) loadSettings(); });

// heartbeat — close one oldest idle tab if over threshold
async function runHeartbeat() {
  if (!ENABLED) return; // <- THE TOGGLE CHECK
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (!tabs || tabs.length <= THRESHOLD_COUNT) return;

    const locked = new Set(lockedTabs);
    const candidates = tabs.filter(t => {
      if (!t || !t.id || !t.url) return false;
      if (t.pinned) return false;
      if (locked.has(t.id)) return false;
      let host = ""; try { host = new URL(t.url).hostname; } catch {}
      if (["docs.google.com", "surveymonkey.com"].some(w => host.includes(w))) return false;
      return true;
    });
    if (candidates.length === 0) return;

    const now = Date.now();
    const idleOk = candidates.filter(t => {
      const last = lastActive[t.id] ?? t.lastAccessed ?? now;
      return (now - last) / 60000 >= IDLE_MINUTES;
    });
    const pool = idleOk.length ? idleOk : candidates;

    let victim = null, oldest = Infinity;
    for (const t of pool) {
      const last = lastActive[t.id] ?? t.lastAccessed ?? now;
      if (last < oldest) { oldest = last; victim = t; }
    }
    if (!victim) return;

    if (victim.url) {
      let title = victim.title; if (!title) { try { title = new URL(victim.url).hostname; } catch { title = ""; } }
      tabUrls[victim.id] = { url: victim.url, title };
    }

    countdownAndClose(victim);
  } catch (e) {
    console.error("[tabsentry] heartbeat error:", e);
  }
}

console.log("[tabsentry] background ready", new Date().toISOString());
