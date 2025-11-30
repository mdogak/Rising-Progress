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
        const y=Number(parts[0]); const m=Number(parts[1])-1; const d=Number(parts[2]);
        return fmtUS(new Date(m,d,y));
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

        // --- Planned vs Actual text for this scope ---
        // 1) Pull raw values from the DOM first
        let actualRaw = '';
        const progressInput = row.querySelector('[data-k="progress"]');
        if (progressInput) {
          actualRaw = (progressInput.value || progressInput.textContent || '').trim();
        }

        let plannedRaw = '';
        const plannedCellDom = row.querySelector('[data-k="planned"]');
        if (plannedCellDom) {
          plannedRaw = (plannedCellDom.textContent || plannedCellDom.innerText || '').trim();
          // Strip any % sign that may be appended in the cell
          if (plannedRaw.endsWith('%')) {
            plannedRaw = plannedRaw.slice(0, -1).trim();
          }
        }

        // 2) Fallback to model values only if DOM is empty
        if ((!actualRaw || actualRaw === '') && scope) {
          const hasUnits = scope.totalUnits !== '' && scope.totalUnits != null && !isNaN(Number(scope.totalUnits));
          if (hasUnits && scope.unitsToDate != null) {
            actualRaw = String(scope.unitsToDate);
          } else if (!hasUnits && scope.actualPct != null) {
            actualRaw = String(scope.actualPct);
          }
        }

        if ((!plannedRaw || plannedRaw === '') && scope) {
          let plannedPct = 0;
          try {
            if (typeof window.calcScopePlannedPctToDate === 'function') {
              plannedPct = window.calcScopePlannedPctToDate(scope) || 0;
            }
          } catch(e) {
            plannedPct = 0;
          }

          const totalUnitsNum = (scope && scope.totalUnits !== '' && scope.totalUnits != null)
            ? Number(scope.totalUnits)
            : 0;

          if (scope && Number.isFinite(totalUnitsNum) && totalUnitsNum > 0) {
            const plannedUnits = (plannedPct / 100) * totalUnitsNum;
            plannedRaw = String(plannedUnits);
          } else {
            plannedRaw = String(plannedPct);
          }
        }

        // 3) Determine units text (DOM first, then scope fallback)
        let unitsText = '';
        const unitsEl = row.querySelector('[data-k="unitsLabel"]');
        if (unitsEl && 'value' in unitsEl) {
          unitsText = (unitsEl.value || '').trim();
        } else if (scope && scope.unitsLabel) {
          unitsText = String(scope.unitsLabel).trim();
        }

        // 4) Apply decimal rules based on units
        const actualNum = Number(actualRaw || '0');
        const plannedNum = Number(plannedRaw || '0');

        let formattedActual;
        let formattedPlanned;

        if (unitsText === '%' || unitsText === 'Percent' || unitsText === '') {
          // Treat as percent – always show 1 decimal place
          formattedActual  = Number.isFinite(actualNum) ? actualNum.toFixed(1) : '0.0';
          formattedPlanned = Number.isFinite(plannedNum) ? plannedNum.toFixed(1) : '0.0';
        } else {
          // Non-percent units (Feet, Miles, Units, etc.) – round to whole numbers
          formattedActual  = Number.isFinite(actualNum) ? String(Math.round(actualNum)) : '0';
          formattedPlanned = Number.isFinite(plannedNum) ? String(Math.round(plannedNum)) : '0';
        }

        // 5) Final text line
        scopeIssues.push(
          'In progress at ' + formattedActual + ' ' + unitsText +
          ' and planned to date to be at ' + formattedPlanned + ' ' + unitsText
        );
      }
    });

    let finalBullets = [];
    if(anyFlagged){
      byScope.forEach(function(issues, scopeName){
        if (issues && issues.length) {
          finalBullets.push(scopeName + ':');
          issues.forEach(function(i){
            finalBullets.push('     -' + i);
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
      const lastDate = fieldDate || getLastHistoryDateFromModel();
      if (lastDate) {
        lastHistoryEl.textContent = 'Progress last updated: ' + lastDate;
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
