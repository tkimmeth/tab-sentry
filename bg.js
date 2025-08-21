// bg.js
// Tracks tabs, saves history, heartbeat, auto-closes idle ones.

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("heartbeat", { periodInMinutes: 0.25 }); // every 15s
  console.log("[Tab Sentry] Heartbeat alarm created");
});

// -------------------------
// TAB STATE
// -------------------------
const lastActive = {};
let tabUrls = {};
const lockedTabs = new Set();

// -------------------------
// LOCKING STATE
// -------------------------
async function saveLocks() {
  await chrome.storage.local.set({ lockedTabs: Array.from(lockedTabs) });
}

async function loadLocks() {
  const { lockedTabs: stored = [] } = await chrome.storage.local.get("lockedTabs");
  lockedTabs.clear();
  stored.forEach(id => lockedTabs.add(id));
}
loadLocks();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "lockTab") {
    lockedTabs.add(msg.tabId);
    saveLocks();
    sendResponse({ ok: true });
  } else if (msg.type === "unlockTab") {
    lockedTabs.delete(msg.tabId);
    saveLocks();
    sendResponse({ ok: true });
  } else if (msg.type === "restoreTab") {
    handleRestoreTab(msg.url, msg.time).then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async
  }
});

// -------------------------
// SAVE CLOSED TABS + NOTIFY POPUP
// -------------------------
async function saveClosedTab(tabId) {
  const tabData = tabUrls[tabId];
  if (!tabData || !tabData.url) return;

  const { url, title } = tabData;
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) return;

  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const filtered = closedTabs.filter(t => !(t.url === url));
  filtered.unshift({ url, title, time: new Date().toISOString() });

  await chrome.storage.local.set({ closedTabs: filtered.slice(0, 50) });
  console.log("[Tab Sentry] Saved closed tab:", title, url);

  try { chrome.runtime.sendMessage({ type: "refresh" }); } catch {}
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await saveClosedTab(tabId);
  delete tabUrls[tabId];
});

// -------------------------
// TRACK TAB ACTIVITY
// -------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    tabUrls[tabId] = { url: tab.url, title: tab.title || new URL(tab.url).hostname };
    lastActive[tabId] = Date.now();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  lastActive[tabId] = Date.now();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab) lastActive[activeTab.id] = Date.now();
});

// -------------------------
// RESTORE HANDLER
// -------------------------
async function handleRestoreTab(url, time) {
  await chrome.tabs.create({ url });

  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const newList = closedTabs.filter(t => !(t.url === url && t.time === time));
  await chrome.storage.local.set({ closedTabs: newList });

  // refresh popup if open
  try { chrome.runtime.sendMessage({ type: "refresh" }); } catch {}
}

// -------------------------
// AUTO-CLOSE LOGIC (Gentle Close)
// -------------------------
let COUNTDOWN_SECONDS = 5;
let THRESHOLD_COUNT = 5;
let IDLE_MINUTES = 10;

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  THRESHOLD_COUNT = settings.threshold ?? THRESHOLD_COUNT;
  IDLE_MINUTES = settings.idleTimeout ?? IDLE_MINUTES;
  console.log("[Tab Sentry] Settings loaded:", { THRESHOLD_COUNT, IDLE_MINUTES });
}
loadSettings();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) loadSettings();
});

let countdown = 0;
let closingInProgress = false;

async function startCountdownAndClose() {
  if (closingInProgress) return;
  closingInProgress = true;
  countdown = COUNTDOWN_SECONDS;

  const interval = setInterval(async () => {
    chrome.action.setBadgeText({ text: String(countdown) });
    chrome.action.setBadgeBackgroundColor({ color: "red" });

    if (countdown <= 0) {
      clearInterval(interval);

      const tabs = await chrome.tabs.query({ currentWindow: true });
      console.log("[Tab Sentry] Gentle Close cycle: open tabs =", tabs.length);

      if (tabs.length > THRESHOLD_COUNT) {
        let oldestTab = null;
        let oldestTime = Infinity;  // FIX: prevents index 0 stall

        for (const tab of tabs) {
          if (!tab.url || tab.pinned) continue;
          if (lockedTabs.has(tab.id)) continue;

          const domain = new URL(tab.url).hostname;
          if (["docs.google.com", "surveymonkey.com"].some(w => domain.includes(w))) continue;

          const last = lastActive[tab.id] || Date.now();
          if (last < oldestTime) {
            oldestTime = last;
            oldestTab = tab;
          }
        }

        if (oldestTab) {
          await saveClosedTab(oldestTab.id);
          chrome.tabs.remove(oldestTab.id);
        }
      }

      chrome.action.setBadgeText({ text: "" });
      closingInProgress = false;
    }

    countdown--;
  }, 1000);
}

// -------------------------
// HEARTBEAT
// -------------------------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "heartbeat") return;
  const tabs = await chrome.tabs.query({});
  console.log("[Tab Sentry] Heartbeat: open tabs =", tabs.length);
  if (tabs.length > THRESHOLD_COUNT) {
    startCountdownAndClose();
  }
});

console.log("[Tab Sentry] Background service ready", new Date().toISOString());
