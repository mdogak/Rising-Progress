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

  let lastIssuesText = '';

  // --- Beta badge control (scoped to Issues modal) ---
  let _issuesBetaPrevDisplay = null;
  function hideIssuesBetaBadge(){
    const betaBadge = document.getElementById('betaBadge');
    if (betaBadge){
      _issuesBetaPrevDisplay = betaBadge.style.display;
      betaBadge.style.display = 'none';
    }
  }
  function restoreIssuesBetaBadge(){
    const betaBadge = document.getElementById('betaBadge');
    if (betaBadge && _issuesBetaPrevDisplay !== null){
      betaBadge.style.display = _issuesBetaPrevDisplay;
      _issuesBetaPrevDisplay = null;
    }
  }


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
            <div class="issues-modal-actions">
              <button type="button" id="issuesCopyBtn" class="issues-copy-btn"><span class="issues-copy-icon" aria-hidden="true"></span><span class="issues-copy-text">Copy</span></button>
              <button type="button" class="issues-close" aria-label="Close recommendations">&times;</button>
            </div>
          </div>

          <div id="issuesHealth" class="issues-health">
            <div id="issuesHealthTitle" class="issues-health-title"></div>
            <table id="issuesHealthTable" class="issues-health-table"></table>
            <div id="issuesHealthDays" class="issues-health-days"></div>
            <div class="issues-health-chartwrap">
              <img id="issuesHealthChart" class="issues-health-chart" alt="Progress chart"/>
            </div>
          </div>

          <ul id="issuesList" class="issues-list"></ul>
        </div>`;
      document.body.appendChild(overlay);

      // Inject scoped styles for modal height + internal scrolling (once)
      if (!overlay.querySelector('#issuesModalScrollStyles')) {
        const style = document.createElement('style');
        style.id = 'issuesModalScrollStyles';
        style.textContent = `
          .issues-modal {
            max-height: 90vh;
            display: flex;
            flex-direction: column;
          }

          .issues-modal-header {
            flex-shrink: 0;
          }

          .issues-list {
            flex: 1 1 auto;
            overflow-y: auto;
            margin: 0;
            padding-right: 6px;
          }

          .issues-copy-btn {
            flex-shrink: 0;
          }
        `;
        overlay.appendChild(style);
      }
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

    function pctTextFromValue(v){
    if (v == null || v === '') return '0%';
    const s = String(v).trim();
    if (!s) return '0%';
    if (s.endsWith('%')) return s;
    return s + '%';
  }

  function pickFirstDefined(obj, keys){
    if (!obj) return null;
    for (let i=0;i<keys.length;i++){
      const k = keys[i];
      if (obj[k] != null && obj[k] !== '') return obj[k];
    }
    return null;
  }

  function getTotalLegendActualPlan(){
    const out = { actual: '0%', plan: '0%' };
    try{
      if (typeof window !== 'undefined' && window.legendStats){
        const a = window.legendStats.actualPct;
        const p = window.legendStats.plannedPct;
        if (a != null && a !== '') out.actual = pctTextFromValue(a);
        if (p != null && p !== '') out.plan = pctTextFromValue(p);
      }
    }catch(e){ /* ignore */ }
    return out;
  }

  function getSectionsInGridOrder(model){
    if (!model) return [];
    if (Array.isArray(model.sections)) return model.sections;
    if (Array.isArray(model.section)) return model.section;
    return [];
  }

  function getSectionName(sec, idx){
    if (!sec) return 'Section ' + String(idx+1);
    const v = sec.name || sec.label || sec.sectionName || sec.title;
    return (v != null && String(v).trim()) ? String(v).trim() : ('Section ' + String(idx+1));
  }

  function getSectionActualPlanText(sec){
    // Do NOT recompute. Read existing computed values from the section object only.
    const actualKeys = ['pct','actualPct','progressPct','weightedPct','percent','progressPercent','actualPercent'];
    const planKeys = ['plannedPct','planPct','plannedPercent','planPercent','plannedToDatePct','plannedtodatePct','plannedToDate','plannedtodate'];
    const a = pickFirstDefined(sec, actualKeys);
    const p = pickFirstDefined(sec, planKeys);
    return {
      actual: pctTextFromValue(a),
      plan: pctTextFromValue(p)
    };
  }

  function getDaysRelativeTextFromLegend(){
    try{
      const el = document.querySelector('div.legend-sub.forecast.legend-daysrel');
      if (el) return (el.textContent || '').trim();
    }catch(e){ /* ignore */ }
    return '';
  }

  function setHealthChartImage(overlay){
    const img = overlay ? overlay.querySelector('#issuesHealthChart') : null;
    const wrap = overlay ? overlay.querySelector('.issues-health-chartwrap') : null;
    if (!img) return;
    let dataUrl = '';
    try{
      const canvas = document.getElementById('progressChart');
      if (canvas && typeof canvas.toDataURL === 'function') {
        dataUrl = canvas.toDataURL('image/png');
      }
    }catch(e){ dataUrl = ''; }
    if (dataUrl) {
      img.src = dataUrl;
      img.style.width = '800px';
      img.style.height = 'auto';
      img.style.display = '';
      if (wrap) wrap.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      if (wrap) wrap.style.display = 'none';
    }
  }

  function buildProjectHealth(overlay){
    if (!overlay) return;
    const model = getModel();
    const proj = document.getElementById('projectName')?.value || (model && model.project && model.project.name) || 'Current Project';

    const titleEl = overlay.querySelector('#issuesHealthTitle');
    if (titleEl) {
      titleEl.textContent = 'Project Health: ' + proj;
    }

    const tableEl = overlay.querySelector('#issuesHealthTable');
    if (tableEl) {
      const totals = getTotalLegendActualPlan();
      let html = '';
      html += '<thead><tr>' +
        '<th>Progress</th>' +
        '<th class="right">Actual</th>' +
        '<th class="right">Plan</th>' +
        '</tr></thead>';
      html += '<tbody>';

      html += '<tr class="issues-health-total">' +
        '<td>Total</td>' +
        '<td class="right">' + totals.actual + '</td>' +
        '<td class="right">' + totals.plan + '</td>' +
        '</tr>';

      const sections = getSectionsInGridOrder(model);
      for (let i=0;i<sections.length;i++){
        const sec = sections[i];
        // If section has zero scopes or zero weight, display 0% (as required)
        const scopeCount = Number(pickFirstDefined(sec, ['scopeCount','scopesCount','numScopes','scopeLen','scope_length']) || 0);
        const weight = Number(pickFirstDefined(sec, ['weight','cost','sectionWeight','pctWeight','percentWeight']) || 0);
        let actualPlan = getSectionActualPlanText(sec);

        if (!scopeCount || !weight) {
          actualPlan = { actual: '0%', plan: '0%' };
        }

        html += '<tr>' +
          '<td>' + String(getSectionName(sec, i)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</td>' +
          '<td class="right">' + actualPlan.actual + '</td>' +
          '<td class="right">' + actualPlan.plan + '</td>' +
          '</tr>';
      }

      html += '</tbody>';
      tableEl.innerHTML = html;
    }

    const daysEl = overlay.querySelector('#issuesHealthDays');
    if (daysEl) {
      const t = getDaysRelativeTextFromLegend();
      daysEl.textContent = t;
      daysEl.style.display = t ? '' : 'none';
    }

    setHealthChartImage(overlay);
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
      titleEl.textContent = 'Issues: ' + proj;
    }

    buildProjectHealth(overlay);

    // Update last history date line if available
    const lastHistoryEl = overlay.querySelector('#issuesLastHistory');
    if (lastHistoryEl) {
      const historyDateField = document.getElementById('historyDate');
      const fieldDate = historyDateField && historyDateField.value ? historyDateField.value : '';
      const lastDateRaw = fieldDate || getLastHistoryDateFromModel();
      if (lastDateRaw) {
        const pretty = friendlyDate(lastDateRaw);
        lastHistoryEl.textContent = 'Data as of: ' + pretty;
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

    hideIssuesBetaBadge();
    overlay.classList.remove('hidden');
    document.body.dataset.issuesScrollLock = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
  }


function closeIssuesModal(){
    const overlay = document.getElementById('issuesOverlay');
    if(overlay){
      overlay.classList.add('hidden');
    }
    restoreIssuesBetaBadge();
    if (document.body.dataset.issuesScrollLock !== undefined) {
      document.body.style.overflow = document.body.dataset.issuesScrollLock;
      delete document.body.dataset.issuesScrollLock;
    }
  }

  
  function copyIssuesToClipboard(){
    const overlay = document.getElementById('issuesOverlay') || ensureOverlay();
    const listEl = overlay.querySelector('#issuesList');
    const titleEl = overlay.querySelector('#issuesTitle');
    const subtitleEl = overlay.querySelector('.issues-modal-subtitle');
    const dateEl = overlay.querySelector('#issuesLastHistory');

    // Helper to safely embed textContent into HTML
    function esc(s){
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
    }

    // -------- Build plain-text (fallback-friendly) --------
    let plainLines = [];
    const titleTxt = titleEl ? (titleEl.textContent || '').trim() : '';
    const subtitleTxt = subtitleEl ? (subtitleEl.textContent || '').trim() : '';
    const dateTxt = (dateEl && dateEl.textContent) ? dateEl.textContent.trim() : '';

    if (titleTxt) plainLines.push(titleTxt);
    if (subtitleTxt) plainLines.push(subtitleTxt);
    if (dateTxt) plainLines.push(dateTxt);
    if (titleTxt || subtitleTxt || dateTxt) plainLines.push(''); // spacer

    // -------- Build HTML using semantic lists (email-client friendly) --------
    let html = '<div>';

    if (titleTxt) {
      html += '<div style="font-size:18px; font-weight:700; margin:0 0 4px 0;">' + esc(titleTxt) + '</div>';
    }
    if (subtitleTxt) {
      html += '<div style="font-weight:400; color:#ea580c; margin:0 0 4px 0;">' + esc(subtitleTxt) + '</div>';
    }
    if (dateTxt) {
      html += '<div style="font-weight:400; font-size:13px; color:#4b5563; margin:0 0 12px 0;">' + esc(dateTxt) + '</div>';
    }

    // List serialization:
    // - Scope titles: bold, unbulleted
    // - Issues: bulleted list
    let scopeOpen = false;

    function closeScope(){
      if (scopeOpen){
        html += '</ul>';
      }
      scopeOpen = false;
    }

    function openScope(scopeTitle){
      closeScope();
      html += '<div style="font-weight:700; margin:0 0 6px 0;">' + esc(scopeTitle) + '</div>';
      html += '<ul style="margin:0 0 8px 18px;">';
      scopeOpen = true;

      // plain text: bullet + scope title
      plainLines.push('- ' + scopeTitle);
    }

    function addIssueLine(issueText){
      if (!scopeOpen){
        // If an issue line appears without a scope header, keep output readable.
        html += '<li style="margin:0 0 4px 0; font-weight:400;">' + esc(issueText) + '</li>';
        // ASCII-only bullet
        plainLines.push('- ' + issueText);
        return;
      }

      html += '<li style="margin:0 0 4px 0; font-weight:400;">' + esc(issueText) + '</li>';

      // plain text: indent issues under scope (ASCII-only)
      plainLines.push('  - ' + issueText);
    }

    if (listEl && listEl.children && listEl.children.length) {
      Array.from(listEl.children).forEach(function(li){
        const raw = (li.textContent || '').trim();
        if (!raw) return;

        if (li.classList.contains('issues-scope-title')) {
          // Remove trailing ":" for copied output (modal UI stays unchanged)
          const title = raw.endsWith(':') ? raw.slice(0, -1).trim() : raw;
          openScope(title || raw);
        } else {
          addIssueLine(raw);
        }
      });
    }

    closeScope();
    html += '</div>';

    const plain = plainLines.join('\\n');

    // -------- Clipboard write with robust fallbacks --------
    try {
      const canWriteRich = navigator.clipboard && navigator.clipboard.write && (typeof ClipboardItem !== 'undefined');
      if (canWriteRich) {
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" })
          })
        ]).catch(function(){

  function fmtCommaInt(n){
    try{
      const s = String(Math.round(Number(n)||0));
      return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }catch(e){ return String(n); }
  }

          // If rich write fails, try plain text before legacy fallback.
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(plain).catch(function(){

  function fmtCommaInt(n){
    try{
      const s = String(Math.round(Number(n)||0));
      return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }catch(e){ return String(n); }
  }
 fallbackCopy(plain); });
          } else {
            fallbackCopy(plain);
          }
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(plain).catch(function(){

  function fmtCommaInt(n){
    try{
      const s = String(Math.round(Number(n)||0));
      return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }catch(e){ return String(n); }
  }
 fallbackCopy(plain); });
      } else {
        fallbackCopy(plain);
      }
    } catch(e){
      fallbackCopy(plain);
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
