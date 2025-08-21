// popup.js
// Renders current open tabs + recently closed tabs with restore

const $ = id => document.getElementById(id);

// -------------------------
// RENDER OPEN TABS
// -------------------------
async function renderOpenTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const list = $("open-tabs");
  list.innerHTML = "";

  // Queue-like order: oldest at bottom
  tabs.sort((a, b) => a.id - b.id);

  for (const tab of tabs) {
    const li = document.createElement("li");

    const a = document.createElement("a");
    a.href = "#";
    a.textContent = tab.title || tab.url;
    a.style.fontWeight = "bold";
    a.onclick = () => chrome.tabs.update(tab.id, { active: true });

    li.appendChild(a);
    list.appendChild(li);
  }
}

// -------------------------
// RENDER RECENTLY CLOSED
// -------------------------
async function renderClosedTabs() {
  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const list = $("closed-tabs");
  list.innerHTML = "";

  closedTabs.forEach(({ url, title, time }) => {
    const li = document.createElement("li");

    const a = document.createElement("a");
    a.href = url;
    a.textContent = title || url;
    a.target = "_blank";
    a.style.fontWeight = "bold";

    const meta = document.createElement("span");
    meta.textContent = " (" + new Date(time).toLocaleTimeString() + ")";
    meta.style.fontSize = "11px";
    meta.style.color = "#888";

    const btn = document.createElement("button");
    btn.textContent = "Restore";
    btn.onclick = async () => {
      await chrome.tabs.create({ url });
      const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
      const newList = closedTabs.filter(t => !(t.url === url && t.time === time));
      await chrome.storage.local.set({ closedTabs: newList });
      renderClosedTabs();
    };

    li.appendChild(a);
    li.appendChild(meta);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// -------------------------
// CLEAR HISTORY
// -------------------------
$("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ closedTabs: [] });
  renderClosedTabs();
});

// -------------------------
// INIT
// -------------------------
renderOpenTabs();
renderClosedTabs();
// Listen for tab updates to refresh open tabs
chrome.tabs.onUpdated.addListener(() => renderOpenTabs());
// Listen for tab removal to refresh closed tabs
chrome.tabs.onRemoved.addListener(() => renderClosedTabs());
