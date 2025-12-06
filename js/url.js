// url.js
export async function loadFromUrlParams() {
  const params = new URLSearchParams(window.location.search);

  const nav = performance.getEntriesByType("navigation")[0];
  const isReload = nav && nav.type === "reload";

  if (isReload) {
    console.log("Refresh detected — keeping existing sessionStorage model.");
    return null;
  }

  if (params.has("path")) {
    const rawPath = params.get("path");
    const url = resolveUrl(rawPath);
    return fetchText(url);
  }

  return null;
}

function resolveUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path.trim();
  }
  return `/${path.replace(/^\/+/, "")}`;
}

async function fetchText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load: ${url}`);

    const text = await res.text();
    const ext = url.toLowerCase().endsWith(".json") ? "json" : "csv";

    if (!window.model) window.model = {};
    window.model.loadedFromUrl = url;

    return { text, url, ext };
  } catch (err) {
    console.error("URL Loader Error:", err);
    return null;
  }
}

export function applyProjectModel(obj) {
  window.model = obj;
}
