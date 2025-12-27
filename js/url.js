/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader + Open File trigger (button-driven)
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
 * Triggers the SAME code path as clicking the Open File button
 */
function maybeTriggerOpenFile(params){
  if (params.get('file') !== 'open') return false;

  // Do not mix with other loaders
  if (params.has('prgs') || params.has('preset')) return false;

  const MAX_WAIT_MS = 4000;
  const INTERVAL_MS = 50;
  let waited = 0;

  const tryTrigger = () => {
    // Prefer clicking the actual Open button (this creates the file input)
    const openBtn =
      document.getElementById('toolbarOpen') ||
      document.querySelector('[data-action="open"], button[title*="Open" i]');

    if (openBtn) {
      try{
        openBtn.click();
      }catch(e){
        console.warn('[RP][URL] Failed to click Open button:', e);
      }

      // Remove parameter immediately (one-time use)
      try{
        const url = new URL(window.location.href);
        url.searchParams.delete('file');
        window.history.replaceState({}, '', url.toString());
      }catch(e){}

      return;
    }

    waited += INTERVAL_MS;
    if (waited >= MAX_WAIT_MS) {
      console.warn('[RP][URL] Open File button not found within wait window');
      return;
    }

    setTimeout(tryTrigger, INTERVAL_MS);
  };

  tryTrigger();
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
