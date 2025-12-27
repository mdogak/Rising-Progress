/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader
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

export function initUrlLoader(){
  try{
    const params = new URLSearchParams(window.location.search || '');
    const raw = (params.get('prgs') || '').trim();
    if(!raw) return;

    const parsed = parsePrgsParam(raw);
    if(!parsed){
      console.warn('[RP][URL] Invalid prgs= value (expected rel: or url:):', raw);
      // Don't block app; allow default loading to proceed
      return;
    }

    // Expose a promise so save-load auto-load can await us (race-free precedence)
    window.__RP_URL_LOAD_PROMISE = (async ()=>{
      try{
        let target = parsed.target;

        // Allow encoded or unencoded values
        try { target = decodeURIComponent(target); } catch(e){}

        const res = await fetch(target, { cache:'no-store' });
        if(!res.ok) throw new Error(`HTTP ${res.status}`);

        const text = await res.text();
        if(!text || !text.trim()) throw new Error('Empty PRGS content');

        // Treat URL load as a new project load (clear History Date suppression keys)
        clearHistoryDateProjectSuppression();

        // Load exactly as if user used Open File
        loadFromPrgsText(text);

        // One-time use: remove prgs= from the URL after a successful load
        try{
          const u = new URL(window.location.href);
          u.searchParams.delete('prgs');
          window.history.replaceState({}, '', u.toString());
        }catch(e){}
        // Hydration flag prevents preset/session/default from overriding this load
        window.__RP_URL_HYDRATED = true;
        return true;
      }catch(err){
        console.warn('[RP][URL] Failed to load PRGS from URL:', err);
        toast(parsed.mode==='url' ? 'Project URL blocked by browser security (CORS)' : 'Failed to load project');
        return false;
      }
    })();
  }catch(e){
    console.warn('[RP][URL] initUrlLoader failed:', e);
  }
}
