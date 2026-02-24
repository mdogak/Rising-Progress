/*
 (c) 2026 Rising Progress LLC. All rights reserved.
 AI Template Generator modal injector + behavior
*/


  const STORAGE_KEY = 'rp_ai_project_description';
  const MAX_CHARS = 2000;

  function $(sel, root){ return (root||document).querySelector(sel); }

  function cleanupOpenParam(){
    try{
      const url = new URL(window.location.href);
      if (url.searchParams.get('open') === 'ai') {
        url.searchParams.delete('open');
        window.history.replaceState({}, '', url.toString());
      }
    }catch(e){}
  }

  function isLoggedIn(){
    // Prefer app-provided helpers (reusing existing auth mechanism when present)
    try{
      if (typeof window.isLoggedIn === 'function') return !!window.isLoggedIn();
      if (typeof window.getCurrentUser === 'function') return !!window.getCurrentUser();
      if (typeof window.getAuthUser === 'function') return !!window.getAuthUser();
    }catch(e){}

    // Common Firebase patterns (best-effort, no imports)
    try{
      if (window.auth && window.auth.currentUser) return true;
    }catch(e){}
    try{
      if (window.firebase && window.firebase.auth && typeof window.firebase.auth === 'function') {
        const u = window.firebase.auth().currentUser;
        if (u) return true;
      }
    }catch(e){}
    try{
      // modular v9 style, if app has already initialized and exposed getAuth()
      if (window.getAuth && typeof window.getAuth === 'function') {
        const a = window.getAuth();
        if (a && a.currentUser) return true;
      }
    }catch(e){}

    return false;
  }

  function redirectToLoginPreserveOpen(){
    // Preserve open=ai so post-login returns to the modal
    const here = new URL(window.location.href);
    if (here.searchParams.get('open') !== 'ai') {
      here.searchParams.set('open', 'ai');
    }

    // If the app exposes a central auth redirect helper, use it.
    try{
      if (typeof window.requireLogin === 'function') {
        window.requireLogin(here.toString());
        return;
      }
      if (typeof window.redirectToLogin === 'function') {
        window.redirectToLogin(here.toString());
        return;
      }
    }catch(e){}

    // Best-effort fallback: stash return URL for the login page if it supports it.
    try{ sessionStorage.setItem('rp_post_login_redirect', here.toString()); }catch(e){}
    try{ sessionStorage.setItem('rp_login_return', here.toString()); }catch(e){}

    // Conservative login URL: many apps use login.html with a redirect param
    const loginUrl = new URL('login.html', window.location.href);
    loginUrl.searchParams.set('redirect', here.toString());
    window.location.href = loginUrl.toString();
  }

  function ensureToast(){
    let t = document.getElementById('aiToast');
    if (t) return t;

    t = document.createElement('div');
    t.id = 'aiToast';
    t.style.cssText = [
      'position: fixed',
      'left: 50%',
      'bottom: 24px',
      'transform: translateX(-50%)',
      'background: rgba(17,24,39,0.92)',
      'color: #fff',
      'padding: 10px 14px',
      'border-radius: 10px',
      'font-size: 14px',
      'z-index: 10050',
      'max-width: calc(100vw - 40px)',
      'box-shadow: 0 10px 30px rgba(0,0,0,0.25)',
      'display: none'
    ].join(';');
    document.body.appendChild(t);
    return t;
  }

  let toastTimer = null;
  function showToast(msg, sticky){
    const t = ensureToast();
    t.textContent = msg || '';
    t.style.display = 'block';
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (!sticky) {
      toastTimer = setTimeout(()=>{ try{ t.style.display='none'; }catch(e){} }, 2200);
    }
  }
  function hideToast(){
    const t = document.getElementById('aiToast');
    if (t) t.style.display = 'none';
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  async function fetchMarkupOnce(){
    // Fetch AI.html and append its root overlay element
    let res = null;
    // Be tolerant to filename casing (ai.html vs AI.html)
    const candidates = ['ai.html', 'AI.html'];
    for (const p of candidates) {
      try{
        const r = await fetch(p, { cache: 'no-store' });
        if (r && r.ok) { res = r; break; }
      }catch(e){}
    }
    if (!res) throw new Error('Failed to load AI.html');
    const html = await res.text();

    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const overlay = wrap.firstElementChild;
    if (!overlay || overlay.id !== 'AIOverlay') {
      throw new Error('AI.html is missing #AIOverlay root');
    }
    document.body.appendChild(overlay);
    return overlay;
  }

  function applySizing(overlay){
    const modal = $('.issues-modal', overlay);
    if (!modal) return;

    // Measure Issues modal max-width (if it exists), then multiply by 1.3
    let issuesMaxPx = 720;
    try{
      const issuesModal = document.getElementById('issuesOverlay') ? $('#issuesOverlay .issues-modal') : $('.issues-modal');
      if (issuesModal) {
        const cs = window.getComputedStyle(issuesModal);
        const mw = cs && cs.maxWidth ? cs.maxWidth : '';
        const n = parseFloat(mw);
        if (isFinite(n) && n > 0) issuesMaxPx = n;
      }
    }catch(e){}

    const target = issuesMaxPx * 1.3;
    const cap = Math.floor(window.innerWidth * 0.95);
    modal.style.maxWidth = Math.min(target, cap) + 'px';
    modal.style.width = '95%';
  }

  function injectScopedStyles(overlay){
    if ($('#aiModalScrollStyles', overlay)) return;

    const style = document.createElement('style');
    style.id = 'aiModalScrollStyles';
    style.textContent = `
      /* Scoped to AI modal only */
      #AIOverlay .issues-modal{
        max-height: 90vh;
        display: flex;
        flex-direction: column;
      }
      #AIOverlay .issues-modal-header{
        flex-shrink: 0;
      }
      #AIOverlay .ai-body{
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0 2px 6px 2px;
      }
      #AIOverlay .ai-textarea-wrap{
        position: relative;
        margin-top: 10px;
      }
      #AIOverlay #aiProjectDescription{
        width: 100%;
        min-height: 220px;
        resize: vertical;
        box-sizing: border-box;
        padding: 12px 12px 30px 12px;
      }
      #AIOverlay .ai-char-count{
        position: absolute;
        right: 10px;
        bottom: 8px;
        font-size: 12px;
        color: #6b7280;
        user-select: none;
        pointer-events: none;
      }
      #AIOverlay #aiGenerateBtn{
        margin-top: 14px;
      }
      #AIOverlay #aiTermsLink{
        color: #2563eb;
        text-decoration: none;
      }
      #AIOverlay #aiTermsLink:hover{
        text-decoration: underline;
      }
    `;
    overlay.appendChild(style);
  }

  function lockScroll(){
    document.body.dataset.aiScrollLock = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll(){
    if (document.body.dataset.aiScrollLock !== undefined) {
      document.body.style.overflow = document.body.dataset.aiScrollLock;
      delete document.body.dataset.aiScrollLock;
    }
  }

  function updateCounter(overlay){
    const ta = $('#aiProjectDescription', overlay);
    const c = $('#aiCharCount', overlay);
    if (!ta || !c) return;

    const n = (ta.value || '').length;
    c.textContent = n.toLocaleString() + '/2,000 characters';
  }

  function wireOnce(overlay){
    if (overlay.dataset.bound === '1') return;

    const closeBtn = $('.issues-close', overlay);
    if (closeBtn) closeBtn.addEventListener('click', closeAIModal);

    overlay.addEventListener('click', (e)=>{
      if (e.target === overlay) closeAIModal();
    });

    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') {
        const o = document.getElementById('AIOverlay');
        if (o && !o.classList.contains('hidden')) closeAIModal();
      }
    });

    const ta = $('#aiProjectDescription', overlay);
    if (ta) {
      ta.addEventListener('input', ()=>{
        // Session-only persistence (cleared on reload via beforeunload)
        try{ sessionStorage.setItem(STORAGE_KEY, ta.value || ''); }catch(e){}
        updateCounter(overlay);
      });
    }

    const btn = $('#aiGenerateBtn', overlay);
    if (btn) btn.addEventListener('click', onGenerate);

    // Clear session-only storage on reload/navigation
    if (!window.__rpAiBeforeUnloadBound) {
      window.__rpAiBeforeUnloadBound = true;
      window.addEventListener('beforeunload', ()=>{
        try{ sessionStorage.removeItem(STORAGE_KEY); }catch(e){}
      });
    }

    overlay.dataset.bound = '1';
  }

  async function ensureOverlay(){
    let overlay = document.getElementById('AIOverlay');
    if (!overlay) overlay = await fetchMarkupOnce();
    injectScopedStyles(overlay);
    wireOnce(overlay);

    // Style the generate button to match existing buttons when possible
    try{
      const gen = $('#aiGenerateBtn', overlay);
      if (gen && !gen.dataset.styled) {
        const ref = document.getElementById('baselineBtn') ||
                    document.getElementById('toolbarIssues') ||
                    document.querySelector('button');
        if (ref && ref.className) gen.className = ref.className;
        gen.dataset.styled = '1';
      }
    }catch(e){}

    // Restore textarea value if present (session-only)
    try{
      const ta = $('#aiProjectDescription', overlay);
      if (ta) {
        const saved = sessionStorage.getItem(STORAGE_KEY) || '';
        ta.value = saved;
        updateCounter(overlay);
      }
    }catch(e){}

    applySizing(overlay);
    return overlay;
  }

  async function onGenerate(){
    const overlay = document.getElementById('AIOverlay') || await ensureOverlay();
    const ta = $('#aiProjectDescription', overlay);

    // Raw user input (limit enforced by maxlength on textarea)
    const projectDescriptionText = (ta && ta.value) ? String(ta.value) : '';

    // Store as a JSON string under the spec-required variable name "project-description"
    const projectDescriptionJSON = JSON.stringify({ "project-description": projectDescriptionText });

    // Expose variables (hyphenated names require bracket notation)
    try{ window['project-description'] = projectDescriptionJSON; }catch(e){}

    showToast('Processing...', true);

    try{
      const [promptJSON, schemaJSON] = await Promise.all([
        fetch('Prompt/Create-Template-Prompt.json', { cache: 'no-store' }).then(r=>{ if(!r.ok) throw new Error('Prompt fetch failed'); return r.text(); }),
        fetch('schema/schema-columnar-full.json', { cache: 'no-store' }).then(r=>{ if(!r.ok) throw new Error('Schema fetch failed'); return r.text(); })
      ]);

      // Create the spec-required variable "AI-request" by joining:
      // 1) Prompt/Create-Template-Prompt.json
      // 2) project-description (JSON string)
      // 3) schema/schema-columnar-full.json
      const aiRequestText = promptJSON + "\n\n" + projectDescriptionJSON + "\n\n" + schemaJSON;
      try{ window['AI-request'] = aiRequestText; }catch(e){}

      // Clipboard copy
      const copied = await copyToClipboard(aiRequestText);
      if (copied) {
        showToast('Copied to clipboard.', false);
      } else {
        showToast('Copy failed. Please try again.', false);
      }
    } catch(e){
      showToast('Error. Please try again.', false);
    }
  }


  async function copyToClipboard(text){
    try{
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){ /* fall through */ }
    return fallbackCopy(text);
  }

  function fallbackCopy(text){
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try{ document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
      return true;
    }catch(e){
      return false;
    }
  }

  async function openAIModal(){
    // Firebase login gating
    if (!isLoggedIn()) {
      redirectToLoginPreserveOpen();
      return;
    }

    const overlay = await ensureOverlay();

    // Ensure counter is correct on open
    updateCounter(overlay);

    // Open
    overlay.classList.remove('hidden');
    lockScroll();

    // If opened via URL, keep existing cleanup behavior on close
  }

  function closeAIModal(){
    const overlay = document.getElementById('AIOverlay');
    if (overlay) overlay.classList.add('hidden');
    unlockScroll();
    hideToast();
    cleanupOpenParam();
  }

  // Expose public API for url.js
  window.openAIModal = openAIModal;
  window.closeAIModal = closeAIModal;

  // URL-based open (defensive; url.js also triggers)
  document.addEventListener('DOMContentLoaded', ()=>{
    try{
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('open') === 'ai' && !params.has('prgs') && !params.has('preset')) {
        openAIModal();
      }
    }catch(e){}
  });

  // Keep sizing responsive
  window.addEventListener('resize', ()=>{
    const overlay = document.getElementById('AIOverlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      try{ applySizing(overlay); }catch(e){}
    }
  });

/* ES Module Export: allows url.js to import openAiLoader without modification */
export async function openAiLoader() {
  return await openAIModal();
}
