/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader + Open File trigger (observer-based)
*/
import { loadFromPrgsText } from './save-load.js';

function toast(msg){
  try{
    const t = document.getElementById('toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(()=>{ try{ t.classList.remove('show'); }catch(e){} }, 1800);
  }catch(e){}
}

// Clear project-scoped History Date suppression keys (treat URL load as "new project").
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
 * Uses MutationObserver to wait for toolbar Open button to exist
 */
function maybeTriggerOpenFile(params){
  if (params.get('file') !== 'open') return false;

  // Do not mix with other loaders
  if (params.has('prgs') || params.has('preset')) return false;

  let triggered = false;

  const cleanupUrl = () => {
    try{
      const url = new URL(window.location.href);
      url.searchParams.delete('file');
      window.history.replaceState({}, '', url.toString());
    }catch(e){}
  };

  const tryTrigger = () => {
    if (triggered) return true;

    const openBtn =
      document.getElementById('toolbarOpen') ||
      document.querySelector('[data-action="open"], button[title*="Open" i]');

    if (openBtn) {
      triggered = true;
      try{
        openBtn.click();
      }catch(e){
        console.warn('[RP][URL] Failed to click Open button:', e);
      }
      cleanupUrl();
      return true;
    }
    return false;
  };

  // Try immediately (in case toolbar already exists)
  if (tryTrigger()) return true;

  // Observe DOM for toolbar insertion
  const observer = new MutationObserver(() => {
    if (tryTrigger()) {
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Safety timeout
  setTimeout(() => {
    if (!triggered) {
      observer.disconnect();
      console.warn('[RP][URL] Open File button never appeared');
      cleanupUrl();
    }
  }, 8000);

  return true;
}

export function initUrlLoader(){
  try{
    const params = new URLSearchParams(window.location.search || '');

    // Handle one-shot Open File trigger
    maybeTriggerOpenFile(params);

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
        toast('Failed to load project from URL');
        return false;
      }
    })();
  }catch(e){
    console.warn('[RP][URL] initUrlLoader failed:', e);
  }
}
