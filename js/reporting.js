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
          <div class="issues-modal-header">
            <div class="issues-modal-heading">
              <div id="reportingProjectHeader" class="reporting-project-header"></div>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
              <button type="button" id="reportingCopyBtn" class="issues-copy-btn" aria-label="Copy reporting">
                <span aria-hidden="true">📋</span>
                <span>Copy</span>
              </button>
              <button type="button" class="issues-close" aria-label="Close recommendations">&times;</button>
            </div>
          </div>
          <div id="reportingContent" class="reporting-content">
            <div id="reportingContentWrap" class="reporting-content-wrap">
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

    headRow.appendChild(healthTitle);

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
    issuesTitle.textContent = 'Potential Issues:';

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

    // Always use a simple, consistent title.
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

    function readText(el){
      try{ return (el && (el.textContent || el.innerText || '') || '').trim(); }catch(e){ return ''; }
    }

    function escapeHtml(s){
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
    }

    function buildPlainText(){
      const lines = [];
      const projHdr = readText(overlay.querySelector('#reportingProjectHeader'));
      if (projHdr) lines.push(projHdr);

      lines.push('');
      lines.push('Project Health:');
      lines.push('Summary of project health comparing planned progress to actual progress.');

      try{
        const asOfPretty = overlay && overlay.dataset ? (overlay.dataset.reportingAsOfPretty || '') : '';
        if (asOfPretty) lines.push('Data as of: ' + asOfPretty);
      }catch(e){ /* ignore */ }

      try{
        const tbl = overlay.querySelector('.reporting-health-table');
        if (tbl) {
          const rows = Array.from(tbl.querySelectorAll('tr'));
          rows.forEach(function(tr, idx){
            const cells = Array.from(tr.children || []);
            const vals = cells.map(function(c){ return readText(c); }).filter(Boolean);
            if (!vals.length) return;
            if (idx === 0) return; // skip header row
            if (vals.length >= 3) {
              lines.push(vals[0] + ' | Actual: ' + vals[1] + ' | Plan: ' + vals[2]);
            } else {
              lines.push(vals.join(' | '));
            }
          });
        }
      }catch(e){ /* ignore */ }

      try{
        const daysRel = overlay.querySelector('.reporting-daysrel');
        const daysText = readText(daysRel);
        if (daysText) lines.push(daysText);
      }catch(e){ /* ignore */ }

      lines.push('');
      lines.push('Potential Issues:');

      try{
        const lis = Array.from(overlay.querySelectorAll('#reportingList li'));
        lis.forEach(function(li){
          const t = readText(li);
          if (!t) return;
          if (li.classList.contains('issues-section-title')) {
            lines.push(t);
          } else if (li.classList.contains('issues-scope-title')) {
            lines.push(t);
          } else {
            lines.push('• ' + t);
          }
        });
      }catch(e){ /* ignore */ }

      return lines.join('\n');
    }

    function buildEmailSafeHtml(){
      const projHdr = readText(overlay.querySelector('#reportingProjectHeader'));
      const asOfPretty = (overlay && overlay.dataset) ? (overlay.dataset.reportingAsOfPretty || '') : '';

      // Health table extraction
      let healthRows = [];
      try{
        const tbl = overlay.querySelector('.reporting-health-table');
        if (tbl) {
          const trs = Array.from(tbl.querySelectorAll('tbody tr'));
          trs.forEach(function(tr){
            const tds = Array.from(tr.querySelectorAll('td'));
            if (tds.length >= 3) {
              healthRows.push({
                label: readText(tds[0]),
                actual: readText(tds[1]),
                plan: readText(tds[2]),
                isTotal: tr.classList.contains('reporting-health-total')
              });
            }
          });
        }
      }catch(e){ /* ignore */ }

      const daysText = readText(overlay.querySelector('.reporting-daysrel'));

      // Chart image src (unchanged)
      let imgSrc = '';
      try{
        const img = overlay.querySelector('.reporting-chart-img');
        if (img && img.src) imgSrc = img.src;
      }catch(e){ /* ignore */ }

      // Issues list
      const issueEntries = [];
      try{
        const lis = Array.from(overlay.querySelectorAll('#reportingList li'));
        lis.forEach(function(li){
          const t = readText(li);
          if (!t) return;
          let kind = 'item';
          if (li.classList.contains('issues-section-title')) kind = 'section';
          else if (li.classList.contains('issues-scope-title')) kind = 'scope';
          issueEntries.push({ kind: kind, text: t });
        });
      }catch(e){ /* ignore */ }

      // Build email-safe HTML using only allowed tags, inline styles, table-based layout.
      const font = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, Helvetica, sans-serif';
      const baseColor = '#374151';
      const accentBlue = '#2563eb';
      const accentOrange = '#ea580c';
      const border = '#e2e8f0';
      const danger = '#dc2626';

      let h = '';
      h += '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-family:' + font + '; color:' + baseColor + ';">';
      h += '<tr><td style="padding:0;">';

      if (projHdr) {
        h += '<div style="font-size:24px; font-weight:700; color:' + accentOrange + '; padding:0 0 12px 0;">' + escapeHtml(projHdr) + '</div>';
      }

      h += '<div style="font-size:22px; font-weight:700; color:' + accentBlue + '; padding:0 0 10px 0;">Project Health:</div>';
      h += '<div style="font-size:16px; color:' + accentOrange + '; padding:0 0 2px 0;">Summary of project health comparing planned progress to actual progress.</div>';
      if (asOfPretty) {
        h += '<div style="font-size:16px; color:' + baseColor + '; padding:0 0 10px 0;">Data as of: ' + escapeHtml(asOfPretty) + '</div>';
      } else {
        h += '<div style="font-size:16px; color:' + baseColor + '; padding:0 0 10px 0;"></div>';
      }

      // Health table
      h += '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:auto; border:1px solid ' + border + ';">';
      h += '<tr>';
      h += '<td style="padding:6px 10px; border:1px solid ' + border + '; background:' + accentBlue + '; color:#ffffff; font-weight:700;">Progress</td>';
      h += '<td style="padding:6px 10px; border:1px solid ' + border + '; background:' + accentBlue + '; color:#ffffff; font-weight:700;">Actual</td>';
      h += '<td style="padding:6px 10px; border:1px solid ' + border + '; background:' + accentBlue + '; color:#ffffff; font-weight:700;">Plan</td>';
      h += '</tr>';
      healthRows.forEach(function(r){
        const weight = r.isTotal ? '700' : '400';
        // Red actual if behind plan (simple parse)
        let actualStyle = 'padding:6px 10px; border:1px solid ' + border + '; font-weight:' + weight + ';';
        try{
          const a = parseFloat(String(r.actual||'').replace(/[^0-9.\-]/g,''));
          const p = parseFloat(String(r.plan||'').replace(/[^0-9.\-]/g,''));
          if (isFinite(a) && isFinite(p) && a < p) {
            actualStyle += ' color:' + danger + ';';
          }
        }catch(e){ /* ignore */ }

        h += '<tr>';
        h += '<td style="padding:6px 10px; border:1px solid ' + border + '; font-weight:' + weight + ';">' + escapeHtml(r.label) + '</td>';
        h += '<td style="' + actualStyle + '">' + escapeHtml(r.actual) + '</td>';
        h += '<td style="padding:6px 10px; border:1px solid ' + border + '; font-weight:' + weight + ';">' + escapeHtml(r.plan) + '</td>';
        h += '</tr>';
      });
      h += '</table>';

      if (daysText) {
        h += '<div style="font-size:16px; color:#16a34a; padding:8px 0 0 0;">' + escapeHtml(daysText) + '</div>';
      }

      if (imgSrc) {
        h += '<div style="padding:14px 0 0 0;">';
        h += '<img src="' + escapeHtml(imgSrc) + '" alt="Progress chart" style="width:1000px; max-width:100%; height:auto; border:1px solid ' + border + '; border-radius:12px;" />';
        h += '</div>';
      }

      h += '<div style="font-size:22px; font-weight:700; color:' + accentBlue + '; padding:14px 0 10px 0;">Potential Issues:</div>';

      // Bullets as table rows: bullet cell + text cell
      h += '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%;">';
      issueEntries.forEach(function(ent){
        let bullet = '';
        let textStyle = 'font-size:16px; color:' + baseColor + ';';
        let bulletStyle = 'font-size:16px; color:' + baseColor + ';';
        let padTop = 0;

        if (ent.kind === 'section') {
          bullet = '';
          textStyle = 'font-size:16px; color:' + accentOrange + '; font-weight:700;';
          padTop = 8;
        } else if (ent.kind === 'scope') {
          bullet = '';
          textStyle = 'font-size:16px; color:#111827; font-weight:700;';
          padTop = 8;
        } else {
          bullet = '•';
          textStyle = 'font-size:16px; color:' + baseColor + ';';
          bulletStyle = 'font-size:16px; color:' + baseColor + ';';
          padTop = 0;
        }

        h += '<tr>';
        h += '<td valign="top" style="width:18px; padding:' + padTop + 'px 6px 6px 0; ' + bulletStyle + '">' + escapeHtml(bullet) + '</td>';
        h += '<td valign="top" style="padding:' + padTop + 'px 0 6px 0; ' + textStyle + '">' + escapeHtml(ent.text) + '</td>';
        h += '</tr>';
      });
      h += '</table>';

      h += '</td></tr></table>';
      return h;
    }

    const html = buildEmailSafeHtml();
    const text = buildPlainText();

    function execCommandCopyHtml(htmlString){
      let ok = false;
      const holder = document.createElement('div');
      holder.style.position = 'fixed';
      holder.style.left = '-9999px';
      holder.style.top = '0';
      holder.style.width = '1200px';
      holder.style.background = '#ffffff';
      holder.innerHTML = htmlString;
      document.body.appendChild(holder);

      try{
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
        try{
          const sel = window.getSelection();
          if (sel) sel.removeAllRanges();
        }catch(_){ }
      }

      try{ document.body.removeChild(holder); }catch(e){ /* ignore */ }
      return ok;
    }

    (async function(){
      let ok = false;
      try{
        if (navigator && navigator.clipboard && navigator.clipboard.write && typeof window.ClipboardItem !== 'undefined') {
          const htmlBlob = new Blob([html], { type: 'text/html' });
          const textBlob = new Blob([text], { type: 'text/plain' });
          const item = new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
          await navigator.clipboard.write([item]);
          ok = true;
        }
      }catch(e){
        ok = false;
      }

      if (!ok) {
        ok = execCommandCopyHtml(html);
      }

      if (!ok) {
        fallbackCopyText(text);
      } else {
        try{ window.alert('Reporting copied. Paste into email or notes.'); }catch(e){ /* ignore */ }
      }
    })();
  }

  function fallbackCopyText(text){
  const ta = document.createElement('textarea');
  ta.value = String(text || '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try{
    document.execCommand('copy');
  }catch(e){
    // ignore
  }
  document.body.removeChild(ta);
}

  // Expose public API
  window.openReportingModal = openReportingModal;
  window.closeReportingModal = closeReportingModal;
})();
