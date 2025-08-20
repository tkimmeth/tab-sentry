// bg.js
// Tracks tabs, saves history, heartbeat, auto-closes idle ones.

// -------------------------
// INSTALL
// -------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("heartbeat", { periodInMinutes: .25 }); // every 15 seconds
  console.log("[Tab Sentry] Heartbeat alarm created");
});
// -------------------------
// MESSAGE HANDLER (ping test)
// -------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "notify") {
    console.log("[Tab Sentry] Received ping from popup", new Date().toISOString());
    sendResponse({ ok: true });
    return true;
  }
});

// -------------------------
// TAB TRACKING + STORAGE
// -------------------------
const lastActive = {};    // tabId -> last active timestamp
let tabUrls = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    tabUrls[tabId] = {
      url: tab.url,
      title: tab.title || new URL(tab.url).hostname
    };
  }
});

// Update lastActive when tab is activated
chrome.tabs.onActivated.addListener(({ tabId }) => {
  lastActive[tabId] = Date.now();
});

// Update lastActive when window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab) lastActive[activeTab.id] = Date.now();
});

// Normalize URLs (to dedupe better, esp. YouTube)
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);

    // YouTube special case — only keep video + playlist
    if (u.hostname.includes("youtube.com") && u.searchParams.has("v")) {
      let base = `https://www.youtube.com/watch?v=${u.searchParams.get("v")}`;
      if (u.searchParams.has("list")) {
        base += "&list=" + u.searchParams.get("list");
      }
      return base;
    }

    // Strip junk params
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");

    return u.toString();
  } catch {
    return raw;
  }
}

// -------------------------
// Save closed tab URL (dedup stack)
// -------------------------
async function saveClosedTab(tabId) {
  const tabData = tabUrls[tabId];
  if (!tabData || !tabData.url) return;

  const { url, title } = tabData;

  // skip internal pages
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) {
    console.log("[Tab Sentry] Skipped internal page:", url);
    return;
  }

  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");

  const filtered = closedTabs.filter(t => t.url !== url);

  filtered.unshift({
    url,
    title,
    time: new Date().toISOString()
  });

  await chrome.storage.local.set({ closedTabs: filtered.slice(0, 20) });

  console.log("[Tab Sentry] Saved closed tab:", title, url);
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await saveClosedTab(tabId);
  delete tabUrls[tabId];
});


// -------------------------
// AUTO-CLOSE LOGIC
// -------------------------
const COUNTDOWN_SECONDS = 5;    // demo-friendly (10s countdown)
const THRESHOLD_COUNT = 3;       // start cleaning if >5 tabs
const CLOSE_INTERVAL_MINUTES = .1;
const whitelist = ["google.com", "surveymonkey.com", "docs.google.com"];

let countdown = 0;
let closingInProgress = false;

// Badge countdown + close logic
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
      if (tabs.length > THRESHOLD_COUNT) {
        let oldestTab = null;
        let oldestTime = Date.now();

        for (const tab of tabs) {
          if (!tab.url || tab.pinned) continue;
          const domain = new URL(tab.url).hostname;
          if (whitelist.some(w => domain.includes(w))) continue;

          const last = lastActive[tab.id] || Date.now();
          if (last < oldestTime) {
            oldestTime = last;
            oldestTab = tab;
          }
        }

        if (oldestTab) {
          console.log("[Tab Sentry] Closing tab:", oldestTab.url);
          await saveClosedTab(oldestTab.url);
          chrome.tabs.remove(oldestTab.id);
        }
      }

      chrome.action.setBadgeText({ text: "" }); // clear badge
      closingInProgress = false;
    }

    countdown--;
  }, 1000);
}

// Heartbeat runs once per minute
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "heartbeat") return;
  const tabs = await chrome.tabs.query({});
  console.log("[Tab Sentry] Heartbeat raw tabs:", tabs);
  console.log("[Tab Sentry] Heartbeat: open tabs =", tabs.length);

  if (tabs.length > THRESHOLD_COUNT) {
    console.log("[Tab Sentry] Over threshold, starting cleanup countdown.");
    startCountdownAndClose();
  }
});

console.log("[Tab Sentry] Background service ready", new Date().toISOString());
chrome.alarms.getAll(a => console.log("Alarms:", a));
