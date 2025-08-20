// popup.js
// counts tabs, pings background, show recently closed tabs

const $ = id => document.getElementById(id);

// -------------------------
// BUTTON HANDLERS (count + ping)
// -------------------------
$("count").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({});
  $("out").textContent = `Open tabs: ${tabs.length}`;
  console.log("[Tab Sentry] Counted tabs:", tabs.length);
});

$("ping").addEventListener("click", async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: "notify" });
    $("out").textContent = res?.ok ? "Pinged background" : "Ping failed";
  } catch {
    $("out").textContent = "Ping failed (no background)";
  }
});

// -------------------------
// RENDER RECENTLY CLOSED
// -------------------------
closedTabs.forEach(({ url, title, time }) => {
  const li = document.createElement("li");

  // Title
  const a = document.createElement("a");
  a.href = url;
  a.textContent = title;
  a.target = "_blank";
  a.style.fontWeight = "bold";

  // Domain
  const domain = document.createElement("div");
  domain.textContent = new URL(url).hostname;
  domain.style.fontSize = "12px";
  domain.style.color = "#666";

  // Timestamp
  const meta = document.createElement("span");
  meta.textContent = new Date(time).toLocaleTimeString();
  meta.style.fontSize = "11px";
  meta.style.color = "#aaa";

  // Restore button
  const btn = document.createElement("button");
  btn.textContent = "Restore";
  btn.onclick = async () => {
    await chrome.tabs.create({ url });

    // remove from history
    const { closedTabs = [] } = await chrome.storage.local.get("closedTabs");
    const newList = closedTabs.filter(t => !(t.url === url && t.time === time));
    await chrome.storage.local.set({ closedTabs: newList });

    renderClosedTabs();
  };

  li.appendChild(a);
  li.appendChild(domain);
  li.appendChild(meta);
  li.appendChild(btn);

  list.appendChild(li);
});
