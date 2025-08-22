// popup.js

async function render() {
  const list = document.getElementById("open-tabs");
  const closedList = document.getElementById("closed-tabs");
  list.innerHTML = "";
  closedList.innerHTML = "";

  const tabs = await chrome.tabs.query({});
  const { lockedTabs = [], closedTabs = [], autoCleanerEnabled = false } =
    await chrome.storage.local.get(["lockedTabs", "closedTabs", "autoCleanerEnabled"]);
  const lockedSet = new Set(lockedTabs);

  // Sort by tab.id (proxy for creation order): oldest at bottom
  tabs.sort((a, b) => a.id - b.id);

  for (const tab of tabs) {
    const li = document.createElement("li");
    const ageMins = Math.floor((Date.now() - (tab.lastAccessed || Date.now())) / 60000);

    li.innerHTML = `
      <input type="checkbox" ${lockedSet.has(tab.id) ? "checked" : ""}>
      ${tab.title}
      <span>— Opened ${ageMins} min ago</span>
      <button class="lock">${lockedSet.has(tab.id) ? "🔒" : "🔓"}</button>
    `;

    li.querySelector("input").addEventListener("change", e => {
      chrome.runtime.sendMessage({ type: e.target.checked ? "lockTab" : "unlockTab", tabId: tab.id });
    });
    list.appendChild(li);
  }

  // Recently closed
  if (closedTabs.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.textContent = "No closed tabs yet";
    closedList.appendChild(emptyLi);
  } else {
    closedTabs.forEach(tab => {
      const li = document.createElement("li");
      li.innerHTML = `
        ${tab.title}
        <button class="restore">Restore</button>
        <button class="delete">✖</button>
      `;
      li.querySelector(".restore").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "restoreTab", url: tab.url, time: tab.time });
      });
      li.querySelector(".delete").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "deleteClosedTab", url: tab.url, time: tab.time });
      });
      closedList.appendChild(li);
    });
  }

  // Toggle switch
  const toggle = document.getElementById("toggle-cleaner");
  toggle.textContent = autoCleanerEnabled ? "ON" : "OFF";
  toggle.className = autoCleanerEnabled ? "on" : "off";

  toggle.onclick = async () => {
    await chrome.storage.local.set({ autoCleanerEnabled: !autoCleanerEnabled });
    render();
  };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "refresh") render();
});

render();
