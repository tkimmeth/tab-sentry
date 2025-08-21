// popup.js
// Renders current open tabs + recently closed tabs with restore

const $ = id => document.getElementById(id);

// -------------------------
// RENDER OPEN TABS (with lock checkboxes)
// -------------------------
async function renderOpenTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const { lockedTabs = [] } = await chrome.storage.local.get("lockedTabs");
  const lockedSet = new Set(lockedTabs);

  const list = $("open-tabs");
  list.innerHTML = "";

  // Queue style: oldest at bottom
  tabs.sort((a, b) => a.id - b.id);

  for (const tab of tabs) {
    const li = document.createElement("li");

    // Lock checkbox
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

    // Tab link
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = tab.title || tab.url;
    a.onclick = () => chrome.tabs.update(tab.id, { active: true });

    li.appendChild(checkbox);
    li.appendChild(a);

    // Optional locked marker
    if (lockedSet.has(tab.id)) {
      const mark = document.createElement("span");
      mark.textContent = " ✔";
      mark.style.color = "green";
      li.appendChild(mark);
    }

    list.appendChild(li);
  }
}


// -------------------------
// RENDER RECENTLY CLOSED
// -------------------------
async function renderClosedTabs() {
  const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
  const list = $("closed-tabs");
  const emptyState = document.querySelector(".RecentlyClosed .empty-state");

  list.innerHTML = "";

  if (closedTabs.length === 0) {
    // show the "No closed tabs yet" message
    if (emptyState) emptyState.style.display = "block";
    return;
  } else {
    // hide message when tabs exist
    if (emptyState) emptyState.style.display = "none";
  }

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
      // reopen tab
      await chrome.tabs.create({ url });

      // remove restored tab from history
      const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
      const newList = closedTabs.filter(
        t => !(t.url === url && t.time === time)
      );
      await chrome.storage.local.set({ closedTabs: newList });

      // refresh both lists
      renderClosedTabs();
      renderOpenTabs();
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
  renderOpenTabs();
});

// -------------------------
// INIT
// -------------------------
renderOpenTabs();
renderClosedTabs();

// Listen for refresh messages from background script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "refresh") {
    renderOpenTabs();
    renderClosedTabs();
  }
});
