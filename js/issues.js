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
              <div class="issues-modal-subtitle">Summary of issues based on differences between the current plan and actual progress.</div>
              <div id="issuesLastHistory" class="issues-last-history"></div>
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
      const parts = String(iso).split('-');
      if(parts.length===3){
        const y = Number(parts[0]);
        const m = Number(parts[1]) - 1; // month index 0-11
        const d = Number(parts[2]);
        return fmtUS(new Date(y, m, d));
      }
      return fmtUS(new Date(iso));
    }catch(e){ return String(iso); }
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

    const rowsContainer = document.getElementById('scopeRows');
    const rows = rowsContainer ? rowsContainer.querySelectorAll('.row') : [];

    // If there is no model and no rows at all, fall back immediately.
    if ((!model || !Array.isArray(model.scopes)) && (!rows || rows.length === 0)) {
      bullets.push('No issues identified based on current plan.');
      try {
        if (window.sessionStorage) {
          sessionStorage.setItem('issues_bullets', JSON.stringify(bullets));
        }
      } catch(e) { /* ignore */ }
      lastIssuesText = bullets.join('\n');
      return bullets;
    }

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
    const byScope = new Map();

    rows.forEach(function(row){
      const idx = Number(row.dataset.index);
      const scopes = model && Array.isArray(model.scopes) ? model.scopes : null;
      const scope = (scopes && Number.isFinite(idx)) ? scopes[idx] : null;

      // Determine scope name as best we can from model or DOM
      let scopeName = (scope && scope.label && String(scope.label).trim()) || '';
      if (!scopeName) {
        const labelInput = row.querySelector('[data-k="label"]');
        if (labelInput) {
          scopeName = (labelInput.value || labelInput.textContent || '').trim();
        }
      }
      if (!scopeName) {
        scopeName = Number.isFinite(idx) ? ('Scope ' + (idx+1)) : 'Scope';
      }

      if (!byScope.has(scopeName)) {
        byScope.set(scopeName, []);
      }
      const scopeIssues = byScope.get(scopeName);

      const startInput = row.querySelector('[data-k="start"]');
      const endInput   = row.querySelector('[data-k="end"]');
      const plannedCell = row.querySelector('[data-k="planned"]');

      const startFlag = !!(startInput && startInput.classList.contains('flag-start'));
      const endFlag   = !!(endInput && endInput.classList.contains('flag-end'));
      const plannedFlag = !!(plannedCell && plannedCell.classList.contains('flag-planned'));

      if(startFlag){
        anyFlagged = true;
        const rawVal = (scope && scope.start) || (startInput && startInput.value) || '';
        const pretty = friendlyDate(rawVal);
        scopeIssues.push('Planned to start on ' + pretty + ' but has not started');
      }

      if(endFlag){
        anyFlagged = true;
        const rawVal = (scope && scope.end) || (endInput && endInput.value) || '';
        const pretty = friendlyDate(rawVal);
        scopeIssues.push('Planned to end on ' + pretty + ' but has not yet finished');
      }

      if(plannedFlag){
        anyFlagged = true;

        // Actual progress from DOM: <input data-k="progress">
        let actualRaw = 0;
        const progressInput = row.querySelector('[data-k="progress"]');
        if (progressInput) {
          const v = (progressInput.value || progressInput.textContent || '').trim();
          const num = parseFloat(v);
          actualRaw = isNaN(num) ? 0 : num;
        }

        // Planned progress from DOM: <span data-k="planned">
        let plannedRaw = 0;
        const plannedCellDom = row.querySelector('[data-k="planned"]');
        let plannedIsPercent = false;
        if (plannedCellDom) {
          const t = (plannedCellDom.textContent || plannedCellDom.value || '').trim();
          if (t.includes('%')) {
            plannedIsPercent = true;
            const num = parseFloat(t.replace('%',''));
            plannedRaw = isNaN(num) ? 0 : num;
          } else {
            const num = parseFloat(t);
            plannedRaw = isNaN(num) ? 0 : num;
          }
        }

        // Decide if this scope is units-based or percent-based:
        // If totalUnits > 0, treat as units; otherwise treat as percent.
        const totalUnitsNum = (scope && scope.totalUnits !== '' && scope.totalUnits != null)
          ? Number(scope.totalUnits)
          : 0;
        const isUnitsBased = scope && Number.isFinite(totalUnitsNum) && totalUnitsNum > 0;

        let unitsText = '';
        let actualText = '';
        let plannedValueText = '';

        if (isUnitsBased) {
          // Units (e.g., Feet): 0 decimal places for both values
          unitsText = scope && scope.unitsLabel ? String(scope.unitsLabel) : '';
          const actualUnitsVal = Math.round(isNaN(actualRaw) ? 0 : actualRaw);
          const plannedUnitsVal = Math.round(isNaN(plannedRaw) ? 0 : plannedRaw);
          actualText = String(actualUnitsVal);
          plannedValueText = String(plannedUnitsVal);
        } else {
          // Percent: 1 decimal place for both values
          unitsText = (scope && scope.unitsLabel) ? String(scope.unitsLabel) : '%';
          const actualPctVal = isNaN(actualRaw) ? 0 : actualRaw;
          const plannedPctVal = isNaN(plannedRaw) ? 0 : plannedRaw;
          actualText = actualPctVal.toFixed(1);
          plannedValueText = plannedPctVal.toFixed(1);
          if (!unitsText) unitsText = '%';
        }

        const unitsSuffix = unitsText ? (' ' + unitsText) : '';

        scopeIssues.push(
          'In progress at ' + actualText + unitsSuffix +
          ' and planned to date to be at ' + plannedValueText + unitsSuffix
        );
      }
    });

    let finalBullets = [];
    if(anyFlagged){
      byScope.forEach(function(issues, scopeName){
        if (issues && issues.length) {
          finalBullets.push(scopeName + ':');
          issues.forEach(function(i){
            // Indent issue lines, but omit hyphen so the UI and copied text are cleaner.
            finalBullets.push('     ' + i);
          });
        }
      });
    } else {
      finalBullets.push('No issues identified based on current plan.');
    }

    try {
      if (window.sessionStorage) {
        sessionStorage.setItem('issues_bullets', JSON.stringify(finalBullets));
      }
    } catch(e) { /* ignore */ }

    lastIssuesText = finalBullets.join('\n');
    return finalBullets;
  }

  function getLastHistoryDateFromModel(){
    const model = getModel();
    if (!model) return '';
    let dateVal = '';

    // Prefer a history array if present
    if (Array.isArray(model.history) && model.history.length) {
      const last = model.history[model.history.length - 1];
      if (last) {
        dateVal = last.date || last.historyDate || last.labelDate || last.snapshotDate || '';
      }
    }

    // Fallback to a direct property if one exists
    if (!dateVal && model.lastHistoryDate) {
      dateVal = model.lastHistoryDate;
    }

    if (!dateVal) return '';
    return friendlyDate(dateVal);
  }

  function openIssuesModal(){
    const overlay = ensureOverlay();

    if (typeof window !== 'undefined' && typeof window.syncActualFromDOM === 'function') {
      window.syncActualFromDOM();
    }

    // Always use a simple, consistent title.
    const titleEl = overlay.querySelector('#issuesTitle');
    if (titleEl) {
      const proj=document.getElementById('projectName')?.value||'Current Project';
      titleEl.textContent = 'Issues for ' + proj;
    }

    // Update last history date line if available
    const lastHistoryEl = overlay.querySelector('#issuesLastHistory');
    if (lastHistoryEl) {
      const historyDateField = document.getElementById('historyDate');
      const fieldDate = historyDateField && historyDateField.value ? historyDateField.value : '';
      const lastDateRaw = fieldDate || getLastHistoryDateFromModel();
      if (lastDateRaw) {
        const pretty = friendlyDate(lastDateRaw);
        lastHistoryEl.textContent = 'Progress last updated: ' + pretty;
        lastHistoryEl.style.display = '';
      } else {
        lastHistoryEl.textContent = '';
        lastHistoryEl.style.display = 'none';
      }
    }

    const listEl = overlay.querySelector('#issuesList');
    if (listEl) {
      listEl.innerHTML = '';
      const bullets = buildIssues();
      bullets.forEach(function (text) {
        const li = document.createElement('li');
        if (text.endsWith(':')) {
          li.classList.add('issues-scope-title');
        } else {
          li.classList.add('issues-scope-item');
        }
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
