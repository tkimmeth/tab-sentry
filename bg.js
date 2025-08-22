// bg.js
// Tracks tabs, saves history, heartbeat, auto-closes idle ones.

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("heartbeat", { periodInMinutes: 0.25 });
  console.log("[Tab Sentry] Background service ready");
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

// -------------------------
// CLOSED TABS HANDLING
// -------------------------
async function saveClosedTab(tabId) {
  const tabData = tabUrls[tabId];
  if (!tabData || !tabData.url) {
    console.log("[History] No tab data found for", tabId);
    return;
  }

  const { url, title } = tabData;
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) return;

  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const newEntry = { url, title, time: Date.now() };
  closedTabs.unshift(newEntry);

  await chrome.storage.local.set({ closedTabs: closedTabs.slice(0, 50) });
  console.log("[History] Saved closed tab:", title || url);

  chrome.runtime.sendMessage({ type: "refresh" }).catch(() => {});
}

async function handleRestoreTab(url, time) {
  await chrome.tabs.create({ url });
  await handleDeleteTab(url, time);
  console.log("[History] Restored tab:", url);
}

async function handleDeleteTab(url, time) {
  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const newList = closedTabs.filter(t => !(t.url === url && t.time === time));
  await chrome.storage.local.set({ closedTabs: newList });
  chrome.runtime.sendMessage({ type: "refresh" }).catch(() => {});
  console.log("[History] Deleted closed tab:", url);
}

// -------------------------
// MESSAGE HANDLER
// -------------------------
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
    return true;
  } else if (msg.type === "deleteClosedTab") {
    handleDeleteTab(msg.url, msg.time).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Ensure we have data before saving
  if (!tabUrls[tabId]) {
    try {
      const [tab] = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
      if (tab?.tab) {
        tabUrls[tabId] = { url: tab.tab.url, title: tab.tab.title };
      }
    } catch (e) {
      console.warn("[History] Could not recover data for closed tab:", tabId);
    }
  }

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
// AUTO-CLOSE LOGIC
// -------------------------
let COUNTDOWN_SECONDS = 5;
let THRESHOLD_COUNT = 5;
let IDLE_MINUTES = 10;
let HEARTBEAT_MINUTES = 0.25;
let autoCleanerEnabled = false;

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  THRESHOLD_COUNT = settings.threshold ?? THRESHOLD_COUNT;
  IDLE_MINUTES = settings.idleTimeout ?? IDLE_MINUTES;
  HEARTBEAT_MINUTES = settings.heartbeat ?? HEARTBEAT_MINUTES;

  const { autoCleanerEnabled: stored = false } = await chrome.storage.local.get("autoCleanerEnabled");
  autoCleanerEnabled = stored;

  // reset alarm to new heartbeat
  chrome.alarms.clear("heartbeat", () => {
    chrome.alarms.create("heartbeat", { periodInMinutes: HEARTBEAT_MINUTES });
  });

  console.log("[Settings] Loaded:", { THRESHOLD_COUNT, IDLE_MINUTES, HEARTBEAT_MINUTES, autoCleanerEnabled });
}
loadSettings();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) loadSettings();
  if (changes.autoCleanerEnabled) {
    autoCleanerEnabled = changes.autoCleanerEnabled.newValue;
    console.log("[Toggle] Auto-cleaner is now", autoCleanerEnabled ? "ON" : "OFF");
  }
});

let countdown = 0;
let closingInProgress = false;
let countdownInterval = null;

async function startCountdownAndClose() {
  if (closingInProgress) return;
  if (!autoCleanerEnabled) return;

  closingInProgress = true;
  countdown = COUNTDOWN_SECONDS;

  countdownInterval = setInterval(async () => {
    if (!autoCleanerEnabled) {
      clearInterval(countdownInterval);
      chrome.action.setBadgeText({ text: "" });
      closingInProgress = false;
      console.log("[Cleaner] Aborted countdown (toggle OFF)");
      return;
    }

    chrome.action.setBadgeText({ text: String(countdown) });
    chrome.action.setBadgeBackgroundColor({ color: "red" });

    if (countdown <= 0) {
      clearInterval(countdownInterval);

      const tabs = await chrome.tabs.query({});
      console.log("[Cleaner] Gentle Close cycle: open tabs =", tabs.length);

      if (tabs.length > THRESHOLD_COUNT) {
        let oldestTab = null;
        let oldestTime = Infinity;

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
          console.log("[Cleaner] Closing:", oldestTab.title || oldestTab.url);
          await saveClosedTab(oldestTab.id);
          chrome.tabs.remove(oldestTab.id);
        } else {
          console.log("[Cleaner] No eligible tabs found this cycle.");
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
  console.log("[Heartbeat] Open tabs:", tabs.length);

  if (autoCleanerEnabled && tabs.length > THRESHOLD_COUNT) {
    console.log("[Cleaner] Over threshold (" + THRESHOLD_COUNT + "), starting cleanup.");
    startCountdownAndClose();
  }
});
