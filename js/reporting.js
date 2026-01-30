/*
(c) 2025 Rising Progress LLC. All rights reserved.
*/

// issues.js
// Builds a friendly recommendations modal based on scope flags from progress.html

(function(){

  function fmtCommaInt(n){
    try{
      const s = String(Math.round(Number(n)||0));
      return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }catch(e){ return String(n); }
  }

  let lastReportingText = '';

  // --- Beta badge control (scoped to Issues modal) ---
  let _reportingBetaPrevDisplay = null;
  function hideReportingBetaBadge(){
    const betaBadge = document.getElementById('betaBadge');
    if (betaBadge){
      _reportingBetaPrevDisplay = betaBadge.style.display;
      betaBadge.style.display = 'none';
    }
  }
  function restoreReportingBetaBadge(){
    const betaBadge = document.getElementById('betaBadge');
    if (betaBadge && _reportingBetaPrevDisplay !== null){
      betaBadge.style.display = _reportingBetaPrevDisplay;
      _reportingBetaPrevDisplay = null;
    }
  }


  function ensureOverlay(){
    let overlay = document.getElementById('reportingOverlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.id = 'reportingOverlay';
      overlay.className = 'issues-overlay hidden';
      overlay.innerHTML = `
        <div class="issues-modal" role="dialog" aria-modal="true" aria-label="Reporting">
          <div class="issues-modal-header reporting-modal-header">
            <button type="button" class="issues-close" aria-label="Close reporting">&times;</button>
          </div>
          <div id="reportingContent class="reporting-content">
            <div id="reportingContentWrap" class="reporting-content-wrap">
              <div id="reportingProjectHeader" class="reporting-project-header"></div>
              <div id="reportingHealthWrap" class="reporting-health-wrap"></div>
              <ul id="reportingList" class="issues-list"></ul>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }

    // Wire up listeners once
    if (!overlay.dataset.bound) {
      const closeBtn = overlay.querySelector('.issues-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeReportingModal);
      }
      overlay.addEventListener('click', function(e){
        if (e.target === overlay) closeReportingModal();
      });
      overlay.addEventListener('click', function(e){
        try{
          const btn = e && e.target && e.target.closest ? e.target.closest('#reportingCopyBtn') : null;
          if (btn) {
            copyReportingToClipboard();
          }
        }catch(_){ }
      });
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
          sessionStorage.setItem('reporting_bullets', JSON.stringify(bullets));
        }
      } catch(e) { /* ignore */ }
      lastReportingText = bullets.join('\n');
      return bullets;
    }

    // When running inside issues.html there are no scope rows. Try to hydrate from stored bullets.
    if (!rows || rows.length === 0) {
      try {
        if (window.sessionStorage) {
          const raw = sessionStorage.getItem('reporting_bullets');
          if (raw) {
            const stored = JSON.parse(raw);
            if (Array.isArray(stored) && stored.length) {
              lastReportingText = stored.join('\n');
              return stored;
            }
          }
        }
      } catch(e) { /* ignore */ }
      bullets.push('No issues identified based on current plan.');
      lastReportingText = bullets.join('\n');
      return bullets;
    }

    let anyFlagged = false;

    // Group issues by section and then by scope (preserves DOM order).
    const bySection = new Map();
    let sawNamedSection = false;

    function ensureSection(sectionName){
      const key = (sectionName && String(sectionName).trim()) ? String(sectionName).trim() : '';
      if (key) sawNamedSection = true;
      if (!bySection.has(key)) {
        bySection.set(key, { overunitsSummaries: [], byScope: new Map() });
      }
      return bySection.get(key);
    }

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

      // Determine section name from model if present
      const sectionName = (scope && scope.sectionName != null) ? String(scope.sectionName).trim() : '';
      const sectionBucket = ensureSection(sectionName);

      if (!sectionBucket.byScope.has(scopeName)) {
        sectionBucket.byScope.set(scopeName, []);
      }
      const scopeIssues = sectionBucket.byScope.get(scopeName);

      const startInput = row.querySelector('[data-k="start"]');
      const endInput   = row.querySelector('[data-k="end"]');
      const plannedCell = row.querySelector('[data-k="planned"]');
      const progressInput = row.querySelector('[data-k="progress"]');
      const totalUnitsInput = row.querySelector('[data-k="totalUnits"]');

      const startFlag = !!(startInput && startInput.classList.contains('flag-start'));
      const endFlag   = !!(endInput && endInput.classList.contains('flag-end'));
      const plannedFlag = !!(plannedCell && plannedCell.classList.contains('flag-planned'));
      const overUnitsFlag = !!(progressInput && progressInput.classList.contains('flag-overunits'));

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
          actualText = fmtCommaInt(actualUnitsVal);
          plannedValueText = fmtCommaInt(plannedUnitsVal);
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

      if(overUnitsFlag){
        anyFlagged = true;

        // Units label: prefer model
        const unitsText = (scope && scope.unitsLabel != null) ? String(scope.unitsLabel).trim() : '';
        const unitsSuffix = unitsText ? (' ' + unitsText) : '';

        // Progress: from DOM input (0 decimals)
        let progNum = 0;
        if (progressInput) {
          const v = (progressInput.value || progressInput.textContent || '').trim();
          const n = parseFloat(v);
          progNum = isNaN(n) ? 0 : n;
        }

        // Total units: prefer model, then DOM (blank treated as 0)
        let totalRaw = '';
        if (scope && scope.totalUnits != null && scope.totalUnits !== '' && isFinite(Number(scope.totalUnits))) {
          totalRaw = String(scope.totalUnits);
        } else if (totalUnitsInput) {
          totalRaw = (totalUnitsInput.value || totalUnitsInput.textContent || '').trim();
        }
        let totalNum = parseFloat(totalRaw);
        if (!isFinite(totalNum)) totalNum = 0;

        const progText = fmtCommaInt(Math.round(progNum));
        const totalText = fmtCommaInt(Math.round(totalNum));

        const line =
          progText + unitsSuffix + ' exceeds the total of ' + totalText + unitsSuffix;

        // Scope-level bullet
        scopeIssues.push(line);
      }
    });

    let finalBullets = [];
    if(anyFlagged){
      bySection.forEach(function(sectionObj, sectionName){
        let sectionHasIssues = false;
        sectionObj.byScope.forEach(function(issues){
          if (issues && issues.length) sectionHasIssues = true;
        });

        const hasNamedSection = sectionName && String(sectionName).trim();
        const emitSectionHeader = hasNamedSection && sectionHasIssues;

        if (emitSectionHeader) {
          finalBullets.push({ type: 'section', text: '--' + String(sectionName).trim() + '--' });
        }

        sectionObj.byScope.forEach(function(issues, scopeName){
          if (issues && issues.length) {
            finalBullets.push({ type: 'scope', text: scopeName + ':' });
            issues.forEach(function(i){
              finalBullets.push({ type: 'item', text: '     ' + i });
            });
          }
        });
      });
    } else {
      finalBullets.push({ type: 'item', text: 'No issues identified based on current plan.' });
    }

    try {
      if (window.sessionStorage) {
        sessionStorage.setItem('reporting_bullets', JSON.stringify(finalBullets));
      }
    } catch(e) { /* ignore */ }

    lastReportingText = finalBullets.join('\n');
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

  
  function getProjectName(){
    const el = document.getElementById('projectName');
    let name = '';
    if (el) {
      name = (el.value || el.textContent || '').trim();
    }
    if (!name) {
      const model = getModel();
      if (model && model.project && model.project.name) {
        name = String(model.project.name).trim();
      }
    }
    if (!name) name = 'Current Project';
    // If projectName element exists but is empty (standalone), seed it so later reads are stable.
    if (el && !(el.value || '').trim()) {
      try { el.value = name; } catch(e){}
    }
    return name;
  }

  function readPctTextFromEl(el){
    if (!el) return '';
    const t = (el.textContent || el.value || '').trim();
    return t;
  }

  function coercePctText(t){
    // Keep existing formatting if it already includes '%'
    if (!t) return '0%';
    const s = String(t).trim();
    if (!s) return '0%';
    if (s.indexOf('%') !== -1) return s;
    // If raw number, append %
    const n = Number(s);
    if (!isFinite(n)) return '0%';
    return String(s) + '%';
  }

  function buildProgressTableRows(){
    // Total comes from legend values (authoritative, no recompute)
    const totalActual = coercePctText(readPctTextFromEl(document.querySelector('.legend-sub.actual')));
    const totalPlanned = coercePctText(readPctTextFromEl(document.querySelector('.legend-sub.planned')));

    const rows = [];
    rows.push({ label: 'Total', actual: totalActual, plan: totalPlanned, isTotal: true });

    // Section rows come from existing section summary elements (DOM order)
    const sectionRows = Array.from(document.querySelectorAll('.section-row'));
    sectionRows.forEach(function(sr){
      let name = '';
      const titleEl = sr.querySelector('.section-title');
      if (titleEl) {
        name = (titleEl.value || titleEl.textContent || '').trim();
      }
      if (!name) {
        // Fallback: try any first cell text
        const scopeCell = sr.querySelector('.section-scope');
        if (scopeCell) name = (scopeCell.textContent || '').trim();
      }
      if (!name) name = 'Section';

      let actual = '';
      let plan = '';

      const pctEl = sr.querySelector('.section-pct');
      actual = coercePctText(readPctTextFromEl(pctEl));

            // Planned % must come from the Planned column rendered in the main grid (no recompute)
      const planEl = sr.querySelector('.section-planned');
      plan = coercePctText(readPctTextFromEl(planEl));

      // Fallback: if section planned isn't available yet, derive from scope planned cells in this section
      if ((!plan || plan === '0%') && sr.dataset && sr.dataset.startIndex != null && sr.dataset.endIndex != null) {
        const startIdx = Number(sr.dataset.startIndex);
        const endIdx = Number(sr.dataset.endIndex);

        const scopeRows = Array.from(document.querySelectorAll('#scopeRows .scope-row'));
        let acc = 0;
        let count = 0;

        for (let i = startIdx; i <= endIdx; i++) {
          const rowEl = scopeRows[i];
          if (!rowEl) continue;
          const plannedCell = rowEl.querySelector('[data-k="planned"]');
          const t = (plannedCell && plannedCell.textContent || '').trim();
          if (!t) continue;

          if (t.includes('%')) {
            const n = parseFloat(t.replace('%',''));
            if (isFinite(n)) { acc += n; count++; }
          }
        }

        if (count > 0) {
          plan = (acc / count).toFixed(1) + '%';
        }
      }

      // If section has no scopes or no weight, force 0% for both
      // We infer "no weight" if actual and plan are missing or non-numeric.
      const aNum = Number(String(actual).replace('%','').trim());
      const pNum = Number(String(plan).replace('%','').trim());
      if (!isFinite(aNum) && !isFinite(pNum)) {
        actual = '0%';
        plan = '0%';
      }

      rows.push({ label: name, actual: actual || '0%', plan: plan || '0%', isTotal: false });
    });

    return rows;
  }

  function renderProjectHealth(overlay){
    const wrap = overlay.querySelector('#reportingHealthWrap');
    if (!wrap) return;

    const proj = getProjectName();

    // Clear existing
    wrap.innerHTML = '';

    const headRow = document.createElement('div');
    headRow.className = 'reporting-head-row';

    const healthTitle = document.createElement('div');
    healthTitle.className = 'reporting-health-title';
    healthTitle.textContent = 'Project Health:';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.id = 'reportingCopyBtn';
    copyBtn.className = 'issues-copy-btn';
    copyBtn.setAttribute('aria-label','Copy reporting to clipboard');
    copyBtn.innerHTML = '<span class="rp-copy-icon" aria-hidden="true">📋</span><span>Copy</span>';

    headRow.appendChild(healthTitle);
    headRow.appendChild(copyBtn);

    const summaryBlock = document.createElement('div');
    summaryBlock.className = 'reporting-summary';

    const summaryLine = document.createElement('div');
    summaryLine.className = 'reporting-summary-line';
    summaryLine.textContent = 'Summary of project health comparing planned progress to actual progress.';

    const asOfLine = document.createElement('div');
    asOfLine.className = 'reporting-asof';
    const pretty = overlay && overlay.dataset ? (overlay.dataset.reportingAsOfPretty || '') : '';
    asOfLine.textContent = pretty ? ('Data as of: ' + pretty) : '';

    summaryBlock.appendChild(summaryLine);
    if (asOfLine.textContent) summaryBlock.appendChild(asOfLine);

    const tbl = document.createElement('table');
    tbl.className = 'reporting-health-table';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Progress','Actual','Plan'].forEach(function(h){
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);

    const tbody = document.createElement('tbody');

    function parseDisplayedPct(txt){
      try{
        const s = String(txt == null ? '' : txt).trim();
        if (!s) return null;
        const n = parseFloat(s.replace(/[^0-9.\-]/g,''));
        return isFinite(n) ? n : null;
      }catch(e){ return null; }
    }

    const rows = buildProgressTableRows();
    rows.forEach(function(r){
      const tr = document.createElement('tr');
      if (r.isTotal) tr.className = 'reporting-health-total';
      const td0 = document.createElement('td'); td0.textContent = r.label;
      const td1 = document.createElement('td'); td1.textContent = r.actual;
      const td2 = document.createElement('td'); td2.textContent = r.plan;

      try{
        const aNum = parseDisplayedPct(r.actual);
        const pNum = parseDisplayedPct(r.plan);
        if (aNum != null && pNum != null && aNum < pNum) {
          td1.classList.add('rp-actual-behind');
        }
      }catch(e){ /* ignore */ }
      tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);

    // Chart image (from #captureRegion; fallback to existing chart canvas)
    const chartWrap = document.createElement('div');
    chartWrap.className = 'reporting-chart-wrap';

    // Loading placeholder while html2canvas renders
    const loading = document.createElement('div');
    loading.className = 'reporting-chart-loading';
    loading.textContent = 'Loading chart image…';
    // Keep styling minimal so UI remains stable even without CSS updates
    loading.style.fontSize = '13px';
    loading.style.color = '#6b7280';
    loading.style.padding = '8px 0';

    const img = document.createElement('img');
    img.className = 'reporting-chart-img';
    img.alt = 'Progress chart';

    // Start hidden until we can render an image
    img.style.display = 'none';

    chartWrap.appendChild(loading);
    chartWrap.appendChild(img);

    function useCanvasFallback(){
      try{
        const canvas = document.getElementById('progressChart');
        if (canvas && typeof canvas.toDataURL === 'function') {
          img.src = canvas.toDataURL('image/png');
          img.style.display = '';
        }
      }catch(e){ /* ignore */ }
      // Always hide placeholder once we either succeed or give up
      loading.style.display = 'none';
    }

    let started = false;
    try{
      const region = document.getElementById('captureRegion');
      const h2c = (typeof window !== 'undefined') ? window.html2canvas : null;

      if (region && typeof h2c === 'function') {
        started = true;
        h2c(region, { backgroundColor: '#ffffff', scale: 2, useCORS: true })
          .then(function(c){
            try{
              img.src = c.toDataURL('image/png');
              img.style.display = '';
              loading.style.display = 'none';
            }catch(e){
              useCanvasFallback();
            }
          })
          .catch(function(){
            useCanvasFallback();
          });
      }
    }catch(e){ /* ignore */ }

    if (!started) {
      useCanvasFallback();
    }

    const issuesTitle = document.createElement('div');
    issuesTitle.className = 'reporting-issues-title';
    issuesTitle.textContent = 'Issues:';

    wrap.appendChild(headRow);
    wrap.appendChild(summaryBlock);
    wrap.appendChild(tbl);

    try{
      const daysRelSrc = document.querySelector('.legend-sub.forecast.legend-daysrel') || document.querySelector('.legend-daysrel');
      if (daysRelSrc) {
        const daysRel = daysRelSrc.cloneNode(true);
        daysRel.classList.add('legend-sub','forecast','legend-daysrel');
        daysRel.classList.add('reporting-daysrel');
        wrap.appendChild(daysRel);
      }
    }catch(e){ /* ignore */ }

    wrap.appendChild(chartWrap);
    wrap.appendChild(issuesTitle);
  }
function openReportingModal(){
    const overlay = ensureOverlay();

    if (typeof window !== 'undefined' && typeof window.syncActualFromDOM === 'function') {
      window.syncActualFromDOM();
    }

    // Set project header inside scrollable content.
try{
  const proj = getProjectName();
  const hdr = overlay.querySelector('#reportingProjectHeader');
  if (hdr) hdr.textContent = proj + ' Reporting';
}catch(e){ /* ignore */ }

// Update last history date line if available
    try{
      const historyDateField = document.getElementById('historyDate');
      const fieldDate = historyDateField && historyDateField.value ? historyDateField.value : '';
      const lastDateRaw = fieldDate || getLastHistoryDateFromModel();
      overlay.dataset.reportingAsOfPretty = lastDateRaw ? friendlyDate(lastDateRaw) : '';
      const lastHistoryEl = overlay.querySelector('#reportingLastHistory');
      if (lastHistoryEl){
        lastHistoryEl.textContent = '';
        lastHistoryEl.style.display = 'none';
      }
    }catch(e){}


    renderProjectHealth(overlay);

    const listEl = overlay.querySelector('#reportingList');
    if (listEl) {
      listEl.innerHTML = '';
      const bullets = buildIssues();
      bullets.forEach(function (entry) {
        const li = document.createElement('li');
        const text = entry.text || '';
        if (entry.type === 'section') {
          li.classList.add('issues-section-title');
        } else if (entry.type === 'scope') {
          li.classList.add('issues-scope-title');
        } else {
          li.classList.add('issues-scope-item');
        }
        li.textContent = text;
        listEl.appendChild(li);
      });
    }

    hideReportingBetaBadge();
    overlay.classList.remove('hidden');
    document.body.dataset.issuesScrollLock = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
  }


function closeReportingModal(){
    const overlay = document.getElementById('reportingOverlay');
    if(overlay){
      overlay.classList.add('hidden');
    }
    restoreReportingBetaBadge();
    if (document.body.dataset.issuesScrollLock !== undefined) {
      document.body.style.overflow = document.body.dataset.issuesScrollLock;
      delete document.body.dataset.issuesScrollLock;
    }
  }

  
  
  
function copyReportingToClipboard(){
  const overlay = document.getElementById('reportingOverlay') || ensureOverlay();
  const srcRoot = overlay.querySelector('#reportingContentWrap') || overlay.querySelector('#reportingContent') || overlay.querySelector('.reporting-content');
  if (!srcRoot) return;

  const payload = buildReportingCopyPayload(overlay, srcRoot);

  writeReportingToClipboard(payload.html, payload.text)
    .then(function(){
      window.alert('Reporting copied. Paste into email or notes.');
    })
    .catch(function(){
      // Last resort: plain text
      fallbackCopyText(payload.text || '');
    });
}

function buildReportingCopyPayload(overlay, srcRoot){
  // Plain text: clone and remove any UI-only elements.
  let plain = '';
  try{
    const clone = srcRoot.cloneNode(true);
    const copyBtn = clone.querySelector('#reportingCopyBtn');
    if (copyBtn && copyBtn.parentNode) copyBtn.parentNode.removeChild(copyBtn);
    plain = (clone.innerText || clone.textContent || '').trim();
  }catch(e){
    plain = (srcRoot.innerText || srcRoot.textContent || '').trim();
  }

  const html = buildEmailSafeReportingHtml(overlay, srcRoot);

  return { html: html, text: plain };
}

function escHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function buildEmailSafeReportingHtml(overlay, srcRoot){
  const accent = '#2563eb';
  const accent2 = '#ea580c';
  const danger = '#dc2626';
  const border = '#e2e8f0';
  const text = '#374151';

  function pickText(sel){
    try{
      const el = srcRoot.querySelector(sel);
      return el ? (el.textContent || '').trim() : '';
    }catch(e){ return ''; }
  }

  const projectHeader = pickText('#reportingProjectHeader');
  const healthTitle = pickText('.reporting-health-title') || 'Project Health:';
  const summaryLine = pickText('.reporting-summary-line');
  const asOfLine = pickText('.reporting-asof');
  const daysRelLine = (function(){
    try{
      const el = srcRoot.querySelector('.reporting-daysrel') || srcRoot.querySelector('.legend-daysrel');
      return el ? (el.textContent || '').trim() : '';
    }catch(e){ return ''; }
  })();

  // Chart image: MUST be copied exactly as-is.
  let chartSrc = '';
  let chartAlt = 'Progress chart';
  try{
    const img = srcRoot.querySelector('.reporting-chart-img');
    if (img && img.getAttribute) {
      chartSrc = img.getAttribute('src') || '';
      chartAlt = img.getAttribute('alt') || chartAlt;
    }
  }catch(e){ /* ignore */ }

  // Health table: read existing DOM and rebuild with inline styles.
  let healthTableHtml = '';
  try{
    const tbl = srcRoot.querySelector('.reporting-health-table');
    if (tbl) {
      const rows = Array.from(tbl.querySelectorAll('tr'));
      const headerCells = rows.length ? Array.from(rows[0].querySelectorAll('th,td')).map(c => (c.textContent||'').trim()) : ['Progress','Actual','Plan'];

      const bodyRows = Array.from(tbl.querySelectorAll('tbody tr'));
      const bodyHtml = bodyRows.map(function(tr){
        const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent||'').trim());
        const isTotal = tr.classList && tr.classList.contains('reporting-health-total');

        // Determine if actual is behind plan (red)
        let actualStyle = '';
        try{
          const actualTd = tr.querySelector('td:nth-child(2)');
          if (actualTd && actualTd.classList && actualTd.classList.contains('rp-actual-behind')) {
            actualStyle = 'color:' + danger + ';';
          }
        }catch(e){}

        const baseCellStyle = 'padding:6px 10px;border:1px solid ' + border + ';text-align:left;font-size:16px;line-height:1.25;color:' + text + ';';
        const bold = isTotal ? 'font-weight:700;' : '';
        return (
          '<tr>' +
            '<td style="' + baseCellStyle + bold + '">' + escHtml(tds[0] || '') + '</td>' +
            '<td style="' + baseCellStyle + bold + actualStyle + '">' + escHtml(tds[1] || '') + '</td>' +
            '<td style="' + baseCellStyle + bold + '">' + escHtml(tds[2] || '') + '</td>' +
          '</tr>'
        );
      }).join('');

      const thStyle = 'padding:6px 10px;border:1px solid ' + border + ';background:' + accent + ';color:#ffffff;font-weight:700;text-align:left;font-size:16px;line-height:1.25;';
      healthTableHtml =
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 10px 0;">' +
          '<tr>' +
            '<td style="' + thStyle + '">' + escHtml(headerCells[0] || 'Progress') + '</td>' +
            '<td style="' + thStyle + '">' + escHtml(headerCells[1] || 'Actual') + '</td>' +
            '<td style="' + thStyle + '">' + escHtml(headerCells[2] || 'Plan') + '</td>' +
          '</tr>' +
          bodyHtml +
        '</table>';
    }
  }catch(e){ /* ignore */ }

  // Issues list: transform to email-safe structure (NO ul/li).
  let issuesHtml = '';
  try{
    const list = srcRoot.querySelector('#reportingList');
    if (list) {
      const items = Array.from(list.querySelectorAll('li'));
      const rows = [];

      items.forEach(function(li){
        const cls = li.classList || {};
        const t = (li.textContent || '').replace(/\s+$/,'').replace(/^\s+/,'');
        if (!t) return;

        const isSection = cls.contains && cls.contains('issues-section-title');
        const isScope = cls.contains && cls.contains('issues-scope-title');
        const isItem = cls.contains && cls.contains('issues-scope-item');

        if (isSection) {
          rows.push(
            '<tr><td colspan="2" style="padding:10px 0 4px 0;font-size:16px;line-height:1.25;color:' + accent + ';font-weight:700;">' +
              escHtml(t.replace(/^--|--$/g,'')) +
            '</td></tr>'
          );
          return;
        }

        if (isScope) {
          rows.push(
            '<tr><td colspan="2" style="padding:10px 0 2px 0;font-size:16px;line-height:1.25;color:#111827;font-weight:700;">' +
              escHtml(t) +
            '</td></tr>'
          );
          return;
        }

        if (isItem) {
          rows.push(
            '<tr>' +
              '<td valign="top" style="width:18px;padding:2px 6px 6px 0;font-size:18px;line-height:1.25;color:' + text + ';">&bull;</td>' +
              '<td valign="top" style="padding:2px 0 6px 0;font-size:16px;line-height:1.25;color:' + text + ';">' + escHtml(t) + '</td>' +
            '</tr>'
          );
          return;
        }

        // Fallback: treat as bullet.
        rows.push(
          '<tr>' +
            '<td valign="top" style="width:18px;padding:2px 6px 6px 0;font-size:18px;line-height:1.25;color:' + text + ';">&bull;</td>' +
            '<td valign="top" style="padding:2px 0 6px 0;font-size:16px;line-height:1.25;color:' + text + ';">' + escHtml(t) + '</td>' +
          '</tr>'
        );
      });

      issuesHtml =
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
          rows.join('') +
        '</table>';
    }
  }catch(e){ /* ignore */ }

  const outerStyle = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:' + text + ';';
  const sectionPad = 'padding:0 0 10px 0;';

  const html =
    '<div style="' + outerStyle + '">' +

      // Project header
      (projectHeader ? (
        '<div style="font-size:24px;line-height:1.25;font-weight:700;color:' + accent2 + ';padding:0 0 12px 0;">' +
          escHtml(projectHeader) +
        '</div>'
      ) : '') +

      // Health title + copy omitted
      '<div style="font-size:22px;line-height:1.25;font-weight:700;color:' + accent + ';' + sectionPad + '">' + escHtml(healthTitle) + '</div>' +

      // Summary
      (summaryLine ? (
        '<div style="font-size:16px;line-height:1.3;color:' + accent2 + ';padding:0 0 2px 0;">' + escHtml(summaryLine) + '</div>'
      ) : '') +
      (asOfLine ? (
        '<div style="font-size:16px;line-height:1.3;color:' + text + ';padding:0 0 8px 0;">' + escHtml(asOfLine) + '</div>'
      ) : '<div style="padding:0 0 8px 0;"></div>') +

      // Table
      (healthTableHtml || '') +

      // DaysRel line (green)
      (daysRelLine ? (
        '<div style="font-size:15px;line-height:1.3;color:#16a34a;padding:0 0 10px 0;">' + escHtml(daysRelLine) + '</div>'
      ) : '<div style="padding:0 0 10px 0;"></div>') +

      // Chart image
      (chartSrc ? (
        '<div style="padding:0 0 14px 0;">' +
          '<img src="' + chartSrc + '" alt="' + escHtml(chartAlt) + '" style="display:block;width:1000px;max-width:100%;height:auto;border:1px solid ' + border + ';border-radius:12px;background:#ffffff;" />' +
        '</div>'
      ) : '') +

      // Issues title
      '<div style="font-size:22px;line-height:1.25;font-weight:700;color:' + accent + ';padding:0 0 10px 0;">Issues:</div>' +

      // Issues content
      (issuesHtml || '') +

    '</div>';

  return html;
}

function writeReportingToClipboard(html, text){
  // Prefer the async Clipboard API with both HTML and plain text.
  try{
    if (navigator && navigator.clipboard && window.ClipboardItem && typeof navigator.clipboard.write === 'function') {
      const item = new ClipboardItem({
        'text/html': new Blob([String(html || '')], { type: 'text/html' }),
        'text/plain': new Blob([String(text || '')], { type: 'text/plain' })
      });
      return navigator.clipboard.write([item]);
    }
  }catch(e){ /* ignore */ }

  // Fallback: use execCommand('copy') with an oncopy handler to set both formats.
  return new Promise(function(resolve, reject){
    let ok = false;

    function onCopy(e){
      try{
        if (e && e.clipboardData) {
          e.clipboardData.setData('text/html', String(html || ''));
          e.clipboardData.setData('text/plain', String(text || ''));
          e.preventDefault();
          ok = true;
        }
      }catch(_){}
    }

    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    holder.style.top = '0';
    holder.style.width = '1200px';
    holder.innerHTML = String(html || '');

    document.body.appendChild(holder);

    try{
      document.addEventListener('copy', onCopy);

      const range = document.createRange();
      range.selectNodeContents(holder);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      ok = document.execCommand('copy');
      if (sel) sel.removeAllRanges();
    }catch(e){
      ok = false;
    }

    try{ document.removeEventListener('copy', onCopy); }catch(_){}
    try{ document.body.removeChild(holder); }catch(_){}

    if (ok) resolve();
    else reject(new Error('copy_failed'));
  });
}

function fallbackCopyText(text){
(text){
    const ta = document.createElement('textarea');
    ta.value = String(text || '');
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
    window.alert('Reporting copied. Paste into email or notes.');
  }


  // Expose public API
  window.openReportingModal = openReportingModal;
  window.closeReportingModal = closeReportingModal;
})();