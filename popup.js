const $ = id => document.getElementById(id);

$("count").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({});
  $("out").textContent = `Open tabs: ${tabs.length}`;
  console.log("[Tab Sentry] Counted tabs:", tabs.length);
});

$("ping").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "notify" });
  $("out").textContent = res?.ok ? "Pinged background" : "Ping failed";
});
