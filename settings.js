// settings.js
async function load() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  document.getElementById("threshold").value = settings.threshold ?? 5;
  document.getElementById("idleTimeout").value = settings.idleTimeout ?? 10;
  document.getElementById("heartbeat").value = settings.heartbeat ?? 0.25;
}

document.getElementById("save").addEventListener("click", async () => {
  const settings = {
    threshold: parseInt(document.getElementById("threshold").value, 10),
    idleTimeout: parseInt(document.getElementById("idleTimeout").value, 10),
    heartbeat: parseFloat(document.getElementById("heartbeat").value)
  };
  await chrome.storage.local.set({ settings });
  alert("Settings saved!");
});

load();
