/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader + Open Project trigger (event-dispatch)
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
 * Triggers the SAME delegated click handler used by
 * <div data-act="open">Open Project</div>
 */
function maybeTriggerOpenFile(params){
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

  const tryDispatch = () => {
    if (fired) return true;

    const openItem = document.querySelector('[data-act="open"]');
    if (!openItem) return false;

    fired = true;

    // Dispatch a trusted click event so delegated handlers fire
    try{
      openItem.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }catch(e){
      console.warn('[RP][URL] Failed to dispatch open action:', e);
    }

    cleanupUrl();
    return true;
  };

  // Try immediately
  if (tryDispatch()) return true;

  // Observe DOM until menu item appears
  const observer = new MutationObserver(() => {
    if (tryDispatch()) observer.disconnect();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Safety timeout
  setTimeout(() => {
    if (!fired) {
      observer.disconnect();
      console.warn('[RP][URL] Open Project action never appeared');
      cleanupUrl();
    }
  }, 8000);

  return true;
}

export function initUrlLoader(){
  try{
    const params = new URLSearchParams(window.location.search || '');

    // Handle one-shot Open Project trigger
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
