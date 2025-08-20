chrome.runtime.onInstalled.addListener(() => {
  console.log("[Tab Sentry] Installed and background service started ")+ new Date().toISOString();
  chrome.alarms.create("heartbeat", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === "heartbeat") {
    console.log("[Tab Sentry] heartbeat", new Date().toISOString());
  }
});

// quick notification test callable from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "notify") {
    chrome.notifications.create({
      type: "basic",
      // iconUrl: "icons/icon128.png",
      title: "Tab Sentry",
      message: "Background service received your ping "
    }, () => sendResponse({ ok: true }));
    return true; // keep channel open for async sendResponse
  }
});
