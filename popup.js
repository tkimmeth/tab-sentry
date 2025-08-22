// popup.js — tabsentry UI

const $ = id => document.getElementById(id);

// --- ON/OFF toggle that controls settings.enabled ---
async function initToggle() {
  const btn = $("auto-toggle");
  const { settings = {} } = await chrome.storage.local.get("settings");
  const enabled = settings.enabled ?? true;
  renderToggle(btn, enabled);

  btn.addEventListener("click", async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const next = !(settings.enabled ?? true);
    await chrome.storage.local.set({ settings: { ...settings, enabled: next } });
    renderToggle(btn, next);
    // ping bg to reload quickly (optional, bg also listens to storage changes)
    chrome.runtime.sendMessage({ type: "refreshSettings" });
  });
}

function renderToggle(btn, enabled) {
  if (enabled) {
    btn.classList.add("toggle-on");
    btn.classList.remove("toggle-off");
    btn.textContent = "ON";
  } else {
    btn.classList.add("toggle-off");
    btn.classList.remove("toggle-on");
    btn.textContent = "OFF";
  }
}

// -------------------------
// RENDER OPEN TABS
// -------------------------
async function renderOpenTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const { lockedTabs = [] } = await chrome.storage.local.get("lockedTabs");
  const lockedSet = new Set(lockedTabs);

  const list = $("open-tabs");
  const emptyState = document.querySelector(".OpenTabs .empty-state");
  list.innerHTML = "";

  $("ActiveTabCounter").textContent = tabs.length;

  if (tabs.length === 0) {
    emptyState.style.display = "block";
    return;
  } else {
    emptyState.style.display = "none";
  }

  tabs.sort((a, b) => a.id - b.id);

  for (const tab of tabs) {
    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = lockedSet.has(tab.id);
    checkbox.title = "Lock this tab";
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        await chrome.runtime.sendMessage({ type: "lockTab", tabId: tab.id });
      } else {
        await chrome.runtime.sendMessage({ type: "unlockTab", tabId: tab.id });
      }
      renderOpenTabs();
    });

    const favicon = document.createElement("img");
    favicon.src = tab.favIconUrl || "images/default.png";
    favicon.className = "favicon";

    const a = document.createElement("a");
    a.href = "#";
    a.textContent = tab.title || tab.url;
    a.onclick = () => chrome.tabs.update(tab.id, { active: true });

    const meta = document.createElement("span");
    const opened = new Date(tab.lastAccessed || Date.now());
    const mins = Math.floor((Date.now() - opened) / 60000);
    meta.textContent = ` — Opened ${mins} min ago`;
    meta.className = "meta";


    const status = document.createElement("span");
    status.className = "status"; //CSS modifier
    //Audible indicator
    if(tab.audible)
    {
      const audioStatus = document.createElement("span");
      audioStatus.textContent = "🔊";
      status.appendChild(audioStatus);
    }
    const lockIcon = document.createElement("span");
    lockIcon.textContent = lockedSet.has(tab.id) ? " 🔒" : " 🔓";
    lockIcon.style.marginLeft = "6px";
    status.appendChild(lockIcon);

    li.appendChild(checkbox);
    li.appendChild(favicon);
    li.appendChild(a);
    li.appendChild(meta);
    li.appendChild(status);

    list.appendChild(li);
  }
}

// -------------------------
// RENDER CLOSED TABS
// -------------------------
async function renderClosedTabs() {
  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const list = $("closed-tabs");
  const emptyState = document.querySelector(".RecentlyClosed .empty-state");
  list.innerHTML = "";

  $("ResourcesSaved").textContent = closedTabs.length;

  const searchQuery = $("search-closed").value.toLowerCase();
  const filtered = closedTabs.filter(({ url, title }) => {
    const text = (title || url).toLowerCase();
    return text.includes(searchQuery);
  });

  if (filtered.length === 0) {
    emptyState.style.display = "block";
    return;
  } else {
    emptyState.style.display = "none";
  }

  filtered.forEach(({ url, title, time }) => {
    const li = document.createElement("li");

    const favicon = document.createElement("img");
    try {
      favicon.src = "https://www.google.com/s2/favicons?domain=" + new URL(url).hostname;
    } catch {
      favicon.src = "images/default.png";
    }
    favicon.className = "favicon";

    const restoreAndRemove = async () => {
      chrome.runtime.sendMessage({ type: "restoreTab", url, time });
    };

    const a = document.createElement("a");
    a.href = "#";
    a.textContent = title || url;
    a.onclick = (e) => {
      e.preventDefault();
      restoreAndRemove();
    };

    const meta = document.createElement("span");
    meta.textContent = " (" + new Date(time).toLocaleTimeString() + ")";
    meta.className = "meta";

    const btnRestore = document.createElement("button");
    btnRestore.textContent = "Restore";
    btnRestore.onclick = restoreAndRemove;

    const btnDelete = document.createElement("button");
    btnDelete.textContent = "✖";
    btnDelete.title = "Remove from history";
    btnDelete.onclick = async () => {
      const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
      const newList = closedTabs.filter(t => !(t.url === url && t.time === time));
      await chrome.storage.local.set({ closedTabs: newList });
      renderClosedTabs();
      renderOpenTabs();
    };

    li.appendChild(favicon);
    li.appendChild(a);
    li.appendChild(meta);
    li.appendChild(btnRestore);
    li.appendChild(btnDelete);

    list.appendChild(li);
  });
}

// -------------------------
// WIRE UP
// -------------------------
$("search-closed").addEventListener("input", renderClosedTabs);
$("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ closedTabs: [] });
  renderClosedTabs();
  renderOpenTabs();
});

renderOpenTabs();
renderClosedTabs();
initToggle();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "refresh") {
    renderOpenTabs();
    renderClosedTabs();
  }
});

// settings drawer
const settingsBtn = document.getElementById("settings-btn");
const settingsView = document.getElementById("settings-view");
if (settingsBtn && settingsView) {
  settingsBtn.addEventListener("click", () => {
    settingsView.classList.toggle("open");
    if (settingsView.classList.contains("open")) {
      loadSettings();
    }
  });
}
async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("threshold").value = settings.threshold ?? 5;
  $("idle-timeout").value = settings.idleTimeout ?? 10;
}
const saveBtn = document.getElementById("save-settings");
if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const threshold = parseInt($("threshold").value, 10);
    const idleTimeout = parseInt($("idle-timeout").value, 10);
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, threshold, idleTimeout } });
    const status = $("status");
    status.textContent = "Saved!";
    setTimeout(() => (status.textContent = ""), 2000);
  });
}
