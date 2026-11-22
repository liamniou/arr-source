const SCRIPT_ID = "arr-source";
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, key: "", data: null };

function parseInstances(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([url]) => /^https?:\/\//.test(url || ""))
    .map(([url, apiKey]) => ({ origin: new URL(url).origin, apiKey: apiKey || "" }));
}

async function registerScripts() {
  const { instances = "" } = await chrome.storage.local.get("instances");
  const matches = [...new Set(parseInstances(instances).map((i) => `${i.origin}/*`))];
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // not registered yet
  }
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches, js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true },
  ]);
}

async function fetchOverseerrRequests() {
  const { overseerrUrl = "", overseerrApiKey = "" } = await chrome.storage.local.get([
    "overseerrUrl",
    "overseerrApiKey",
  ]);
  if (!overseerrUrl || !overseerrApiKey) return [];
  const base = overseerrUrl.replace(/\/+$/, "");
  const key = base + overseerrApiKey;
  if (cache.data && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;

  const out = [];
  const take = 100;
  for (let skip = 0; ; skip += take) {
    const res = await fetch(`${base}/api/v1/request?take=${take}&skip=${skip}&sort=added`, {
      headers: { "X-Api-Key": overseerrApiKey },
    });
    if (!res.ok) throw new Error(`Overseerr HTTP ${res.status}`);
    const { results, pageInfo } = await res.json();
    for (const r of results) {
      const m = r.media || {};
      out.push({
        mediaType: m.mediaType,
        tmdbId: m.tmdbId,
        tvdbId: m.tvdbId,
        externalServiceId: r.is4k ? m.externalServiceId4k : m.externalServiceId,
        is4k: !!r.is4k,
        createdAt: r.createdAt,
        isAutoRequest: !!r.isAutoRequest,
        user: r.requestedBy?.displayName || r.requestedBy?.username || r.requestedBy?.email || "unknown",
      });
    }
    if (skip + take >= pageInfo.results) break;
  }
  cache = { at: Date.now(), key, data: out };
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "overseerr-requests") return;
  fetchOverseerrRequests()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.instances) registerScripts();
  if (changes.overseerrUrl || changes.overseerrApiKey) cache = { at: 0, key: "", data: null };
});
chrome.runtime.onInstalled.addListener(registerScripts);
chrome.runtime.onStartup.addListener(registerScripts);
