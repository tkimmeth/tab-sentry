const $ = id => document.getElementById(id);

// Load existing values when page opens
async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("threshold").value = settings.threshold ?? 5;
  $("idle-timeout").value = settings.idleTimeout ?? 10;
}
loadSettings();

// Save when button is clicked
$("save-settings").addEventListener("click", async () => {
  const threshold = parseInt($("threshold").value, 10);
  const idleTimeout = parseInt($("idle-timeout").value, 10);

  await chrome.storage.local.set({
    settings: { threshold, idleTimeout }
  });

  $("status").textContent = "Saved!";
  setTimeout(() => $("status").textContent = "", 2000);

  // notify background to reload settings
  chrome.runtime.sendMessage({ type: "refreshSettings" });
});
