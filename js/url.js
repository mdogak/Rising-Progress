/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader + user-activated Open action dialog (dismissable)
*/
import { loadFromPrgsText } from './save-load.js';
import { openProjectLoader } from './loader.js';

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
 * Injects a minimal modal that requires a REAL user click
 * to launch the Open Project action.
 */
function showOpenFilePrompt(){
  if (document.getElementById('rp-openfile-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'rp-openfile-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    position: relative;
    background: #fff;
    padding: 22px 24px 20px;
    border-radius: 8px;
    max-width: 320px;
    width: 90%;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    text-align: center;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  const close = document.createElement('div');
  close.textContent = '×';
  close.style.cssText = `
    position: absolute;
    top: 6px;
    right: 10px;
    font-size: 20px;
    cursor: pointer;
    color: #666;
  `;

  const msg = document.createElement('div');
  msg.textContent = 'Would you like to open a project file?';
  msg.style.marginBottom = '14px';
  msg.style.fontSize = '15px';

  const btn = document.createElement('button');
  btn.textContent = 'Open File';
  btn.style.cssText = `
    padding: 8px 14px;
    font-size: 14px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: #2563eb;
    color: #fff;
  `;

  const cleanup = () => {
    try{
      const url = new URL(window.location.href);
      url.searchParams.delete('open');
      window.history.replaceState({}, '', url.toString());
    }catch(e){}
    overlay.remove();
  };

  btn.addEventListener('click', () => {
    const openItem = document.querySelector('[data-act="open"]');
    if (openItem) {
      openItem.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }
    cleanup();
  });

  close.addEventListener('click', cleanup);
  overlay.addEventListener('click', (e)=>{
    if (e.target === overlay) cleanup();
  });

  box.appendChild(close);
  box.appendChild(msg);
  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/**
 * One-shot ?open=file handler
 * Waits for default project to load, then shows prompt
 */
function maybePromptForOpenAction(params){
  if (params.get('open') !== 'file') return false;
  if (params.has('prgs') || params.has('preset')) return false;

  const isDefaultLoaded = () =>
    typeof window.model === 'object' &&
    Array.isArray(window.model.scopes) &&
    window.model.scopes.length > 0;

  const tick = () => {
    if (!isDefaultLoaded()) {
      setTimeout(tick, 50);
      return;
    }
    showOpenFilePrompt();
  };

  tick();
  return true;
}

export function initUrlLoader(){
  try{
    const params = new URLSearchParams(window.location.search || '');

    // ?open=loader opens the Project Loader modal (only when not also loading a project)
    if (params.get('open') === 'loader' && !params.has('prgs') && !params.has('preset')) {
      openProjectLoader();
      return;
    }

    // Prompt user for Open actions after default load
    maybePromptForOpenAction(params);

    const raw = (params.get('prgs') || '').trim();
    const force = params.get('force') === 'true';

    if (raw && !force && sessionStorage.getItem('rp_prgs_loaded') === '1') return;

    if (force) {
      try { sessionStorage.clear(); } catch(e){}
    }

    if(!raw) return;

    const parsed = parsePrgsParam(raw);
    if(!parsed) return;

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

        // URL loads don't trigger user-driven DOM events, so dependent UI (like section header planned %)
        // can appear stale until the user edits a field. Force a post-hydration render + compute.
        try{
          const kick = ()=>{
            try { window.syncScopeRowsToModel && window.syncScopeRowsToModel(); } catch(_){ }
            try { window.computeAndRender && window.computeAndRender(); } catch(_){ }
          };
          // Defer to ensure loadFromPrgsText has finished updating the model + inputs.
          if (window.requestAnimationFrame) {
            requestAnimationFrame(()=> setTimeout(kick, 0));
          } else {
            setTimeout(kick, 0);
          }
        }catch(_){ }

        window.__RP_URL_HYDRATED = true;
        try { sessionStorage.setItem('rp_prgs_loaded', '1'); } catch(e){}

        if (force) {
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('force');
            window.history.replaceState({}, '', url.toString());
          } catch(e){}
        }
        return true;
      }catch(e){
        return false;
      }
    })();
  }catch(e){}
}
