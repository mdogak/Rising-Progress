/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader + Open Project trigger (post-default-load)
*/
import { loadFromPrgsText } from './save-load.js';

/**
 * Clear project-scoped History Date suppression keys
 */
function clearHistoryDateProjectSuppression(){
  try {
    localStorage.removeItem('rp_historyDate_lastProjectKey');
    localStorage.removeItem('rp_historyDate_activeProjectKey');
  } catch(e){}
}

function parsePrgsParam(raw){
  if(!raw) return null;
  const s = String(raw);
  if (s.startsWith('rel:')) return { mode:'rel', target: s.slice(4) };
  if (s.startsWith('url:')) return { mode:'url', target: s.slice(4) };
  return null;
}

/**
 * One-shot ?file=open handler
 * WAITS until the default project has finished loading
 * (model exists + scopes populated), then triggers Open Project.
 */
function maybeTriggerOpenFileAfterDefaultLoad(params){
  if (params.get('file') !== 'open') return false;

  // Do not mix with other loaders
  if (params.has('prgs') || params.has('preset')) return false;

  let fired = false;

  const cleanupUrl = () => {
    try{
      const url = new URL(window.location.href);
      url.searchParams.delete('file');
      window.history.replaceState({}, '', url.toString());
    }catch(e){}
  };

  const isDefaultLoaded = () => {
    return (
      typeof window.model === 'object' &&
      Array.isArray(window.model.scopes) &&
      window.model.scopes.length > 0
    );
  };

  const tryDispatch = () => {
    if (fired) return true;
    if (!isDefaultLoaded()) return false;

    const openItem = document.querySelector('[data-act="open"]');
    if (!openItem) return false;

    fired = true;
    try {
      openItem.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    } catch(e) {
      console.warn('[RP][URL] Failed to dispatch open action:', e);
    }

    cleanupUrl();
    return true;
  };

  // Poll lightly until default project is ready
  const MAX_WAIT_MS = 8000;
  const INTERVAL_MS = 50;
  let waited = 0;

  const tick = () => {
    if (tryDispatch()) return;

    waited += INTERVAL_MS;
    if (waited >= MAX_WAIT_MS) {
      console.warn('[RP][URL] Default project never finished loading');
      cleanupUrl();
      return;
    }

    setTimeout(tick, INTERVAL_MS);
  };

  tick();
  return true;
}

export function initUrlLoader(){
  try{
    const params = new URLSearchParams(window.location.search || '');

    // Defer Open Project until AFTER default load completes
    maybeTriggerOpenFileAfterDefaultLoad(params);

    const raw = (params.get('prgs') || '').trim();
    const force = params.get('force') === 'true';

    // One-shot per session UNLESS force=true
    if (raw && !force && sessionStorage.getItem('rp_prgs_loaded') === '1') {
      return;
    }

    // force=true explicitly clears prior session state
    if (force) {
      try { sessionStorage.clear(); } catch(e){}
    }

    if(!raw) return;

    const parsed = parsePrgsParam(raw);
    if(!parsed){
      console.warn('[RP][URL] Invalid prgs= value (expected rel: or url:):', raw);
      return;
    }

    window.__RP_URL_LOAD_PROMISE = (async ()=>{
      try{
        let target = parsed.target;
        try { target = decodeURIComponent(target); } catch(e){}

        const res = await fetch(target, { cache:'no-store' });
        if(!res.ok) throw new Error('HTTP ' + res.status);

        const text = await res.text();
        if(!text || !text.trim()) throw new Error('Empty PRGS content');

        clearHistoryDateProjectSuppression();
        loadFromPrgsText(text);

        window.__RP_URL_HYDRATED = true;
        try { sessionStorage.setItem('rp_prgs_loaded', '1'); } catch(e){}

        try {
          if (force) {
            const url = new URL(window.location.href);
            url.searchParams.delete('force');
            window.history.replaceState({}, '', url.toString());
          }
        } catch(e){}

        return true;
      }catch(err){
        console.warn('[RP][URL] Failed to load PRGS from URL:', err);
        return false;
      }
    })();
  }catch(e){
    console.warn('[RP][URL] initUrlLoader failed:', e);
  }
}
