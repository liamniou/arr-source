(async () => {
  const CACHE_MS = 5 * 60 * 1000;
  const RELOAD_MIN_MS = 30 * 1000;
  const LINK_RE = /^\/(movie|series)\/([^/?#]+)$/;

  const { instances = "" } = await chrome.storage.local.get("instances");
  const entry = instances
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([url]) => /^https?:\/\//.test(url || "") && new URL(url).origin === location.origin);
  if (!entry) return;
  let apiKey = entry[1] || "";
  let apiRoot = "/api/v3";

  // The *arr UI itself reads its API key from initialize.json when the session is authorized.
  if (!apiKey) {
    try {
      const init = await (await fetch("/initialize.json", { credentials: "same-origin" })).json();
      apiKey = init.apiKey || "";
      apiRoot = init.apiRoot || apiRoot;
    } catch {
      // fall through; requests below will fail with a clear error
    }
  }

  async function api(path) {
    const res = await fetch(`${apiRoot}/${path}`, {
      credentials: "same-origin",
      headers: apiKey ? { "X-Api-Key": apiKey } : {},
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  let app;
  try {
    app = (await api("system/status")).appName;
  } catch (e) {
    console.warn("[arr-source] API not reachable (set an API key in the extension options?)", e);
    return;
  }
  if (app !== "Radarr" && app !== "Sonarr") return;
  const isRadarr = app === "Radarr";

  let state = null;
  let loadedAt = 0;
  let loading = null;

  async function load() {
    const [items, lists, listItems, requests] = await Promise.all([
      api(isRadarr ? "movie" : "series"),
      api("importlist").catch(() => []),
      isRadarr ? api("importlist/movie").catch(() => []) : [],
      chrome.runtime
        .sendMessage({ type: "overseerr-requests" })
        .then((r) => (r?.ok ? r.data : []))
        .catch(() => []),
    ]);

    const listNames = new Map(lists.map((l) => [l.id, l.name.replace(/^Collecta:\s*/, "")]));
    const listsByTmdb = new Map(listItems.map((m) => [m.tmdbId, (m.lists || []).map((id) => listNames.get(id)).filter(Boolean)]));

    const bySlug = new Map();
    for (const it of items) {
      const req = requests.filter((r) =>
        isRadarr
          ? r.mediaType === "movie" && r.tmdbId === it.tmdbId
          : r.mediaType === "tv" && r.tvdbId === it.tvdbId && it.tvdbId
      ).filter((r) => r.externalServiceId == null || r.externalServiceId === it.id);
      bySlug.set(it.titleSlug, {
        added: it.added,
        requests: req,
        lists: isRadarr ? listsByTmdb.get(it.tmdbId) || [] : [],
      });
    }
    state = { bySlug, hasLists: lists.some((l) => l.enabled) };
    loadedAt = Date.now();
  }

  function ensureLoaded() {
    if (!loading) loading = load().finally(() => (loading = null));
    return loading;
  }

  function describe(info) {
    if (info.requests.length) {
      const names = [...new Set(info.requests.map((r) => r.user))];
      const auto = info.requests.every((r) => r.isAutoRequest) ? ", auto" : "";
      const first = info.requests.map((r) => r.createdAt).sort()[0];
      return {
        text: `Source: Overseerr (${names.join(", ")}${auto})`,
        title: `Requested via Overseerr by ${names.join(", ")} on ${new Date(first).toLocaleString()}`,
      };
    }
    if (info.lists.length) {
      return { text: `Source: List (${info.lists.join(", ")})`, title: `Import list(s): ${info.lists.join(", ")}` };
    }
    if (!isRadarr && state.hasLists) {
      return { text: "Source: Direct / list", title: "Not requested via Overseerr; Sonarr does not expose which import list added a series" };
    }
    return { text: "Source: Direct", title: `Not requested via Overseerr and not in any import list. Added ${info.added}` };
  }

  function setLine(parent, anchorEl, className, slug) {
    const info = state.bySlug.get(slug);
    let line = parent.querySelector(":scope > .arr-source-line");
    if (!info) {
      line?.remove();
      return false;
    }
    const { text, title } = describe(info);
    if (!line) {
      line = document.createElement("div");
      line.className = `arr-source-line ${className}`;
    }
    if (line.textContent !== text) line.textContent = text;
    if (line.title !== title) line.title = title;
    const target = anchorEl ? anchorEl.nextSibling : null;
    if (line.parentElement !== parent || (anchorEl && line.previousSibling !== anchorEl)) {
      parent.insertBefore(line, target);
    }
    return true;
  }

  function process() {
    if (!state) return;
    let missing = false;

    for (const a of document.querySelectorAll('a[href^="/movie/"], a[href^="/series/"]')) {
      const m = LINK_RE.exec(a.getAttribute("href"));
      if (!m) continue;
      const card = a.closest('[class*="IndexPoster-content"]');
      if (!card) continue;
      const titles = card.querySelectorAll(':scope > [class*="IndexPoster-title"]:not(.arr-source-line)');
      const last = titles[titles.length - 1];
      if (!last) continue;
      if (!setLine(card, last, last.className, m[2])) missing = true;
      // The virtualized grid gives every cell a fixed height; stack upper rows above lower ones so the
      // extra line can draw over the row gap instead of being covered by the next row.
      const cell = card.parentElement;
      if (cell) cell.style.zIndex = String(1e6 - (parseFloat(cell.style.top) || 0));
    }

    const m = LINK_RE.exec(location.pathname);
    if (m) {
      const details = [...document.querySelectorAll('[class*="Details-details"]')].find((el) =>
        [...el.classList].some((c) => /Details-details-[\w-]+$/.test(c))
      );
      const first = details?.firstElementChild;
      if (first && !setLine(details, first, "", m[2])) missing = true;
      const line = details?.querySelector(":scope > .arr-source-line");
      if (line) line.style.cssText = "margin-top:6px;font-size:14px;opacity:.85";
    }

    if (missing && Date.now() - loadedAt > RELOAD_MIN_MS) ensureLoaded().then(schedule);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      process();
    });
  }

  await ensureLoaded();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  setInterval(() => {
    if (Date.now() - loadedAt > CACHE_MS) ensureLoaded().then(schedule);
  }, 60 * 1000);
  schedule();
})();
