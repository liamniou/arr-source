const fields = ["instances", "overseerrUrl", "overseerrApiKey"];

chrome.storage.local.get(fields).then((v) => {
  for (const f of fields) document.getElementById(f).value = v[f] || "";
});

document.getElementById("save").addEventListener("click", async () => {
  const v = Object.fromEntries(fields.map((f) => [f, document.getElementById(f).value.trim()]));
  await chrome.storage.local.set(v);
  document.getElementById("status").textContent = "Saved. Reload the Radarr/Sonarr tabs.";
});
