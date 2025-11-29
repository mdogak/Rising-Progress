// issues.js
// Builds a friendly recommendations modal based on scope flags from progress.html

(function(){
  let lastIssuesText = '';

  function ensureOverlay(){
    let overlay = document.getElementById('issuesOverlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.id = 'issuesOverlay';
      overlay.className = 'issues-overlay hidden';
      overlay.innerHTML = `
        <div class="issues-modal" role="dialog" aria-modal="true" aria-labelledby="issuesTitle">
          <div class="issues-modal-header">
            <div class="issues-modal-heading">
              <div id="issuesTitle" class="issues-modal-title">Issues</div>
              <div class="issues-modal-subtitle">Identified issues based on inconsistencies between actual and plan data.</div>
            </div>
            <button type="button" class="issues-close" aria-label="Close recommendations">&times;</button>
          </div>
          <ul id="issuesList" class="issues-list"></ul>
          <button type="button" id="issuesCopyBtn" class="issues-copy-btn">Copy Issues</button>
        </div>`;
      document.body.appendChild(overlay);
    }

    // Wire up listeners once
    if (!overlay.dataset.bound) {
      const closeBtn = overlay.querySelector('.issues-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeIssuesModal);
      }
      overlay.addEventListener('click', function(e){
        if (e.target === overlay) closeIssuesModal();
      });
      const copyBtn = overlay.querySelector('#issuesCopyBtn');
      if (copyBtn) {
        copyBtn.addEventListener('click', copyIssuesToClipboard);
      }
      overlay.dataset.bound = '1';
    }

    return overlay;
  }

  function friendlyDate(iso){
    if(!iso) return '';
    try{
      const d = new Date(iso);
      if(Number.isNaN(d.getTime())){
        // try treat as yyyy-mm-dd without time
        const parts = String(iso).split('-');
        if(parts.length === 3){
          const y = Number(parts[0]);
          const m = Number(parts[1]) - 1;
          const day = Number(parts[2]);
          const d2 = new Date(y, m, day);
          if(!Number.isNaN(d2.getTime())) return fmtUS(d2);
        }
        return String(iso);
      }
      return fmtUS(d);
    }catch(e){
      return String(iso);
    }
  }

  function fmtUS(d){
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yyyy = d.getFullYear();
    return mm + '/' + dd + '/' + yyyy;
  }

  function getModel(){
    if (typeof window.model !== 'undefined' && window.model) {
      return window.model;
    }
    // Fallback to session storage if available (e.g., standalone issues.html)
    try{
      const key = (typeof window.COOKIE_KEY === 'string') ? window.COOKIE_KEY : 'progress_tracker_v3b';
      const raw = window.sessionStorage ? sessionStorage.getItem(key) : null;
      if(raw){
        return JSON.parse(raw);
      }
    }catch(e){
      /* ignore */
    }
    return null;
  }

  
  function buildIssues(){
    const model = getModel();
    const bullets = [];

    // If there is no model or scopes at all, fall back immediately.
    if(!model || !Array.isArray(model.scopes)){
      bullets.push('No issues identified based on current plan.');
      try {
        if (window.sessionStorage) {
          sessionStorage.setItem('issues_bullets', JSON.stringify(bullets));
        }
      } catch(e) { /* ignore */ }
      lastIssuesText = bullets.join('\n');
      return bullets;
    }

    const rowsContainer = document.getElementById('scopeRows');
    const rows = rowsContainer ? rowsContainer.querySelectorAll('.row') : [];

    // When running inside issues.html there are no scope rows. Try to hydrate from stored bullets.
    if (!rows || rows.length === 0) {
      try {
        if (window.sessionStorage) {
          const raw = sessionStorage.getItem('issues_bullets');
          if (raw) {
            const stored = JSON.parse(raw);
            if (Array.isArray(stored) && stored.length) {
              lastIssuesText = stored.join('\n');
              return stored;
            }
          }
        }
      } catch(e) { /* ignore */ }
      bullets.push('No issues identified based on current plan.');
      lastIssuesText = bullets.join('\n');
      return bullets;
    }

    let anyFlagged = false;

    rows.forEach(function(row){
      const idx = Number(row.dataset.index);
      if(!Number.isFinite(idx)) return;
      const scope = model.scopes[idx];
      if(!scope) return;

      const scopeName = (scope.label && String(scope.label).trim()) || ('Scope ' + (idx+1));

      const startInput = row.querySelector('[data-k="start"]');
      const endInput   = row.querySelector('[data-k="end"]');
      const plannedCell = row.querySelector('[data-k="planned"]');

      const startFlag = !!(startInput && startInput.classList.contains('flag-start'));
      const endFlag   = !!(endInput && endInput.classList.contains('flag-end'));
      const plannedFlag = !!(plannedCell && plannedCell.classList.contains('flag-planned'));

      if(startFlag){
        anyFlagged = true;
        const txt = scope.start || (startInput && startInput.value) || '';
        bullets.push(scopeName + ' was planned to start on ' + friendlyDate(txt) + ' but has not started.');
      }

      if(endFlag){
        anyFlagged = true;
        const txt = scope.end || (endInput && endInput.value) || '';
        bullets.push(scopeName + ' was planned to end on ' + friendlyDate(txt) + ' but has not yet finished.');
      }

      if(plannedFlag){
        anyFlagged = true;

        let plannedPct = 0;
        try{
          if (typeof window.calcScopePlannedPctToDate === 'function') {
            plannedPct = window.calcScopePlannedPctToDate(scope) || 0;
          }
        }catch(e){
          plannedPct = 0;
        }

        let plannedValueText = '';
        let unitsText = '';

        const totalUnitsNum = (scope.totalUnits !== '' && scope.totalUnits != null) ? Number(scope.totalUnits) : 0;
        if (Number.isFinite(totalUnitsNum) && totalUnitsNum > 0) {
          const plannedUnits = (plannedPct/100) * totalUnitsNum;
          plannedValueText = plannedUnits.toFixed(1);
          unitsText = scope.unitsLabel ? String(scope.unitsLabel) : '';
        } else {
          plannedValueText = plannedPct.toFixed(1);
          unitsText = scope.unitsLabel ? String(scope.unitsLabel) : '%';
        }

        bullets.push(scopeName + ' is in progress and should be at ' + plannedValueText + ' ' + unitsText + ' to date.');
      }
    });

    if(!anyFlagged){
      bullets.length = 0;
      bullets.push('No issues identified based on current plan.');
    }

    // Persist the latest issues so issues.html can display them standalone.
    try {
      if (window.sessionStorage) {
        sessionStorage.setItem('issues_bullets', JSON.stringify(bullets));
      }
    } catch(e) { /* ignore */ }

    lastIssuesText = bullets.join('\n');
    return bullets;
  }

  function openIssuesModal(){
    const overlay = ensureOverlay();

    // Always use a simple, consistent title.
    const titleEl = overlay.querySelector('#issuesTitle');
    if (titleEl) {
      titleEl.textContent = 'Issues';
    }

    const listEl = overlay.querySelector('#issuesList');
    if (listEl) {
      listEl.innerHTML = '';
      const bullets = buildIssues();
      bullets.forEach(function (text) {
        const li = document.createElement('li');
        li.textContent = text;
        listEl.appendChild(li);
      });
    }

    overlay.classList.remove('hidden');
    document.body.dataset.issuesScrollLock = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
  }

function closeIssuesModal(){
    const overlay = document.getElementById('issuesOverlay');
    if(overlay){
      overlay.classList.add('hidden');
    }
    if (document.body.dataset.issuesScrollLock !== undefined) {
      document.body.style.overflow = document.body.dataset.issuesScrollLock;
      delete document.body.dataset.issuesScrollLock;
    }
  }

  
  function copyIssuesToClipboard(){
    const overlay = document.getElementById('issuesOverlay') || ensureOverlay();

    const titleEl = overlay.querySelector('#issuesTitle');
    const subtitleEl = overlay.querySelector('.issues-modal-subtitle');

    let bullets = [];
    const listEl = overlay.querySelector('#issuesList');
    if (listEl && listEl.children.length) {
      bullets = Array.from(listEl.children)
        .map(li => li.textContent.trim())
        .filter(Boolean);
    } else {
      bullets = buildIssues();
    }

    if (!bullets || bullets.length === 0) return;

    const parts = [];
    if (titleEl && titleEl.textContent) {
      parts.push(titleEl.textContent.trim());
    }
    if (subtitleEl && subtitleEl.textContent) {
      parts.push(subtitleEl.textContent.trim());
    }
    parts.push('');
    parts.push(bullets.map(b => '• ' + b).join('\n'));

    const text = parts.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function(){
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

function fallbackCopy(text){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try{
      document.execCommand('copy');
    }catch(e){
      // ignore
    }
    document.body.removeChild(ta);
    window.alert('Issues copied. You can paste into email or notes.');
  }

  // Expose public API
  window.openIssuesModal = openIssuesModal;
  window.closeIssuesModal = closeIssuesModal;
})();
