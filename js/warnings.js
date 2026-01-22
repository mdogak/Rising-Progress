export function applyScopeWarnings({ model, container }) {
  if (!container || !model || !Array.isArray(model.scopes)) return;

  const historyInput = document.getElementById('historyDate');
  const historyDate = historyInput && historyInput.value
    ? new Date(historyInput.value + 'T00:00:00')
    : null;

  const rows = container.querySelectorAll('.row[data-index]');
  rows.forEach(row => {
    const idx = Number(row.dataset.index);
    const s = model.scopes[idx];
    if (!s) return;

    const progressEl = row.querySelector('[data-k="progress"]');
    const totalUnitsEl = row.querySelector('[data-k="totalUnits"]');

    // Cleanup
    if (progressEl) {
      progressEl.classList.remove('warn-progress-blue', 'warn-progress-orange');
    }
    if (totalUnitsEl) {
      totalUnitsEl.classList.remove('warn-totalunits-orange');
    }

    const actualPct = Number(s.actualPct) || 0;
    const isComplete = actualPct >= 100;

    // Progress field warnings
    if (progressEl && !isComplete) {
      progressEl.classList.add('warn-progress-blue');

      if (
        historyDate &&
        s.start &&
        s.end
      ) {
        const start = new Date(s.start + 'T00:00:00');
        const end = new Date(s.end + 'T00:00:00');

        if (
          historyDate >= start && actualPct < 100
        ) {
          progressEl.classList.remove('warn-progress-blue');
          progressEl.classList.add('warn-progress-orange');
        }
      }
    }

    // Total Units warnings
    if (totalUnitsEl && !isComplete) {
      const unitsLabel = s.unitsLabel;
      const totalUnits = s.totalUnits;

      if (
        unitsLabel !== '%' &&
        (totalUnits === 0 || totalUnits === '')
      ) {
        totalUnitsEl.classList.add('warn-totalunits-orange');
      }
    }
  });
}

function hasAnyTimeseries(model){
  if (!model) return false;
  const candidates = [];
  try {
    if (model.timeSeriesScopes) candidates.push(model.timeSeriesScopes);
    if (model.timeseriesScopes) candidates.push(model.timeseriesScopes);
    if (model.timeSeries) candidates.push(model.timeSeries);
    if (model.timeseries) candidates.push(model.timeseries);
    if (model.timeSeriesSections) candidates.push(model.timeSeriesSections);
    if (model.timeseries && model.timeseries.sections) candidates.push(model.timeseries.sections);
  } catch (e) {}

  for (const v of candidates) {
    if (!v) continue;
    if (Array.isArray(v) && v.length > 0) return true;
    if (typeof v === 'object' && v && Object.keys(v).length > 0) return true;
  }
  return false;
}

// --- Dirty-since-load baseline snapshot (stored outside the model) ---
function __scopeKey(scope, idx){
  if (!scope) return String(idx);
  const id = scope.scopeId || scope.id || scope.uid || scope.scopeID;
  return (id != null && id !== '') ? String(id) : String(idx);
}

function __serializeProgressBaseline(model){
  const scopes = (model && Array.isArray(model.scopes)) ? model.scopes : [];
  const rows = scopes.map((s, idx)=>{
    const key = __scopeKey(s, idx);
    // Only include fields that affect total actual%.
    // In Rising Progress, this is driven by each scope's actualPct.
    return {
      k: key,
      a: (s && (s.actualPct ?? '')),
      u: (s && (s.unitsToDate ?? '')),
      ul: (s && (s.unitsLabel ?? '')),
      tu: (s && (s.totalUnits ?? '')),
      c: (s && (s.cost ?? ''))
    };
  });
  // Sort for stability so reorders don't produce false positives when scopeId is present.
  rows.sort((x,y)=> (x.k < y.k ? -1 : (x.k > y.k ? 1 : 0)));
  return JSON.stringify(rows);
}

export function setScopesBaseline(model){
  try {
    window.__rpScopesBaseline = __serializeProgressBaseline(model);
  } catch(e){
    window.__rpScopesBaseline = null;
  }
}

export function scopesDifferFromBaseline(model){
  try {
    const base = window.__rpScopesBaseline;
    if (!base) return false;
    const curr = __serializeProgressBaseline(model);
    return curr !== base;
  } catch(e){
    return false;
  }
}

export function guardSaveWithDirtyScopes({ model, onAddAndSave, onSaveOnly, onCancel } = {}) {
  const saveOnly = (typeof onSaveOnly === 'function') ? onSaveOnly : function(){};
  const addAndSave = (typeof onAddAndSave === 'function') ? onAddAndSave : saveOnly;
  const cancel = (typeof onCancel === 'function') ? onCancel : function(){};

  try {
    if (!scopesDifferFromBaseline(model)) {
      saveOnly();
      return;
    }
  } catch (e) {
    // Defensive fallback: do not block saving.
    saveOnly();
    return;
  }

  let historyDateText = '';
  try {
    const historyInput = document.getElementById('historyDate');
    if (historyInput && historyInput.value) historyDateText = historyInput.value;
  } catch (e) {}

  // Ensure only one instance of this modal exists.
  const existingOverlay = document.getElementById('rp-ts-guard-overlay');
  if (existingOverlay && existingOverlay.parentNode) existingOverlay.parentNode.removeChild(existingOverlay);
  const existingModal = document.getElementById('rp-ts-guard-modal');
  if (existingModal && existingModal.parentNode) existingModal.parentNode.removeChild(existingModal);

  const overlay = document.createElement('div');
  overlay.id = 'rp-ts-guard-overlay';
  overlay.className = 'rp-hd-overlay';

  const modal = document.createElement('div');
  modal.id = 'rp-ts-guard-modal';
  modal.className = 'rp-hd-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'rp-ts-guard-title');

  // Primary row: Add+Save with date selector on the right.
  // Secondary button below: Save without adding.
  modal.innerHTML = `
    <div class="rp-hd-head">
      <h2 class="rp-hd-title" id="rp-ts-guard-title">Add recent changes to history?</h2>
      <button type="button" class="rp-hd-x" aria-label="Close">&times;</button>
    </div>
    <div class="rp-hd-body">
      <p class="rp-hd-instructions">
        You have updated progress since this project was loaded.
        Do you want to add these changes to history before saving?
      </p>
    </div>
    <div class="rp-hd-foot" style="padding:12px 16px;">
      <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start;flex-wrap:wrap;">
        <button type="button" class="rp-hd-btn rp-ts-guard-add">
          Add to History and Save
        </button>
        <input
          id="rp-ts-guard-date"
          class="rp-hd-input"
          type="date"
          value="${historyDateText || ''}"
          style="
            border:1px solid #ea580c;
            border-radius:6px;
            padding:6px 8px;
          "
        />
      </div>
      <div style="margin-top:14px;">
        <button type="button" class="rp-hd-btn rp-ts-guard-save-only">
          Save without adding to History
        </button>
      </div>
    </div>
  `;

  function cleanup() {
    document.removeEventListener('keydown', onKeydown, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function handleCancel() {
    cleanup();
    try { cancel(); } catch (e) {}
  }

  function handleAddAndSave() {
    // Ensure #historyDate matches selector at click time.
    try {
      const dateEl = modal.querySelector('#rp-ts-guard-date');
      const hd = document.getElementById('historyDate');
      if (dateEl && hd) hd.value = dateEl.value || '';
    } catch(e) {}
    cleanup();
    try { addAndSave(); } catch (e) {}
  }

  function handleSaveOnly() {
    cleanup();
    try { saveOnly(); } catch (e) {}
  }

  function onKeydown(e) {
    if (!e) return;
    if (e.key === 'Escape') {
      try { e.preventDefault(); } catch(_){ }
      handleCancel();
    }
  }

  overlay.addEventListener('click', function(){
    handleCancel();
  });
  modal.addEventListener('click', function(e){
    try{ e.stopPropagation(); }catch(_){ }
  });

  const closeBtn = modal.querySelector('.rp-hd-x');
  if (closeBtn) closeBtn.addEventListener('click', handleCancel);
  const addBtn = modal.querySelector('.rp-ts-guard-add');
  if (addBtn) addBtn.addEventListener('click', handleAddAndSave);
  const saveOnlyBtn = modal.querySelector('.rp-ts-guard-save-only');
  if (saveOnlyBtn) saveOnlyBtn.addEventListener('click', handleSaveOnly);

  // Live sync date selector into #historyDate immediately on change.
  const dateEl = modal.querySelector('#rp-ts-guard-date');
  if (dateEl) {
    const sync = ()=>{
      try {
        const hd = document.getElementById('historyDate');
        if (hd) hd.value = dateEl.value || '';
      } catch(e) {}
    };
    dateEl.addEventListener('input', sync);
    dateEl.addEventListener('change', sync);
  }

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  document.addEventListener('keydown', onKeydown, true);
}

export function guardSaveWithTimeseries({ model, onAddAndSave, onSaveOnly, onCancel } = {}) {
  const saveOnly = (typeof onSaveOnly === 'function') ? onSaveOnly : function(){};
  const addAndSave = (typeof onAddAndSave === 'function') ? onAddAndSave : saveOnly;
  const cancel = (typeof onCancel === 'function') ? onCancel : function(){};

  try {
    if (!hasAnyTimeseries(model) || window._scopesDirtySinceLastHistory !== true) {
      saveOnly();
      return;
    }
  } catch (e) {
    // Defensive fallback: if anything goes wrong, do not block saving.
    saveOnly();
    return;
  }

  let historyDateText = '';
  try {
    const historyInput = document.getElementById('historyDate');
    if (historyInput && historyInput.value) {
      historyDateText = historyInput.value;
    }
  } catch (e) {}

  // Ensure only one instance of this modal exists.
  const existingOverlay = document.getElementById('rp-ts-guard-overlay');
  if (existingOverlay && existingOverlay.parentNode) {
    existingOverlay.parentNode.removeChild(existingOverlay);
  }
  const existingModal = document.getElementById('rp-ts-guard-modal');
  if (existingModal && existingModal.parentNode) {
    existingModal.parentNode.removeChild(existingModal);
  }

  const overlay = document.createElement('div');
  overlay.id = 'rp-ts-guard-overlay';
  overlay.className = 'rp-hd-overlay';

  const modal = document.createElement('div');
  modal.id = 'rp-ts-guard-modal';
  modal.className = 'rp-hd-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'rp-ts-guard-title');

  modal.innerHTML = `
    <div class="rp-hd-head">
      <h2 class="rp-hd-title" id="rp-ts-guard-title">Add recent changes to history?</h2>
      <button type="button" class="rp-hd-x" aria-label="Close">&times;</button>
    </div>
    <div class="rp-hd-body">
      <p class="rp-hd-instructions">
        There are scope changes since history was last updated.
        Do you want to add these changes to history for date
        <strong>${historyDateText || ''}</strong> before saving?
      </p>
    </div>
    <div class="rp-hd-foot">
      <button type="button" class="rp-hd-btn rp-ts-guard-add">Add to History and Save</button>
      <button type="button" class="rp-hd-btn rp-ts-guard-save-only">Save without adding to History</button>
    </div>
  `;

  function cleanup() {
    document.removeEventListener('keydown', onKeydown, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function handleCancel() {
    cleanup();
    try { cancel(); } catch (e) {}
  }

  function handleAddAndSave() {
    cleanup();
    try { addAndSave(); } catch (e) {}
  }

  function handleSaveOnly() {
    cleanup();
    try { saveOnly(); } catch (e) {}
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      ev.preventDefault();
      handleCancel();
    }
  }

  overlay.addEventListener('click', function(ev){
    if (ev.target === overlay) {
      handleCancel();
    }
  });

  const closeBtn = modal.querySelector('.rp-hd-x');
  if (closeBtn) {
    closeBtn.addEventListener('click', function(){
      handleCancel();
    });
  }
  const addBtn = modal.querySelector('.rp-ts-guard-add');
  if (addBtn) {
    addBtn.addEventListener('click', function(){
      handleAddAndSave();
    });
  }
  const saveOnlyBtn = modal.querySelector('.rp-ts-guard-save-only');
  if (saveOnlyBtn) {
    saveOnlyBtn.addEventListener('click', function(){
      handleSaveOnly();
    });
  }

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  document.addEventListener('keydown', onKeydown, true);
}

export function markScopesDirtySinceLastHistory() {
  window._scopesDirtySinceLastHistory = true;
}

export function clearScopesDirtySinceLastHistory() {
  window._scopesDirtySinceLastHistory = false;
}

function hasSectionTimeseries(model){
  if (!model) return false;
  try {
    const ts = model.timeSeriesSections ||
      (model.timeseries && model.timeseries.sections) ||
      (model.timeSeries && model.timeSeries.sections);
    if (!ts) return false;
    if (Array.isArray(ts)) return ts.length > 0;
    if (typeof ts === 'object') return Object.keys(ts).length > 0;
    return !!ts;
  } catch (e) {
    return false;
  }
}

export function maybeWarnOnSectionWeightChange({ model, oldId, newId } = {}) {
  if (window._sectionWeightWarningAcknowledged) return;
  // This warning is about structural section membership changes (a scope moved between sections).
  // It should not be gated on timeseries existence; the user needs the warning even on new files.
  if (!model) return;

  const a = (oldId == null ? '' : String(oldId));
  const b = (newId == null ? '' : String(newId));
  if (a === b) return;

  window.alert(
    "Warning: A scope has moved between sections, changing the weight of the section. Section history will still be based on the previous configuration when scopes are moved."
  );
  window._sectionWeightWarningAcknowledged = true;
}


export function maybeWarnMissingTotalUnitsOnProgressEdit({ scope, rowElement, inputEl } = {}) {
  if (!scope || !rowElement || !inputEl) return false;

  const unitsLabel = (scope.unitsLabel || '').trim();
  if (unitsLabel === '%') return false;

  const tu = scope.totalUnits;
  const missing = (tu === '' || tu == null || !isFinite(Number(tu)) || Number(tu) <= 0);
  if (!missing) return false;

  // Revert progress to last valid value (unit mode)
  try {
    if (typeof revertProgressToLastValid === 'function') {
      revertProgressToLastValid(inputEl, scope, false);
    }
  } catch (e) {}

  try {
    window.alert('Warning: Total units need to be added if units are not %');
  } catch (e) {}

  try {
    const tuEl = rowElement.querySelector('[data-k="totalUnits"]');
    if (tuEl) tuEl.focus();
  } catch (e) {}

  return true;
}

export function handleProgressVsTotalUnitsWarning({ scope, rowElement } = {}) {
  if (!scope || !rowElement) return false;

  const unitsLabel = (scope.unitsLabel || '').trim();
  const isPercentMode = (unitsLabel === '%');

  // Only applies to unit-based scopes with a positive totalUnits.
  if (isPercentMode) return false;

  const totalUnits = Number(scope.totalUnits);
  const unitsToDate = Number(scope.unitsToDate);

  if (!(totalUnits > 0) || !(unitsToDate > totalUnits)) {
    return false;
  }

  const msg = '% or Units to Date is greater than total Units. Do you want to increase the total units?';
  const yes = window.confirm(msg);
  if (!yes) return false;

  const newTotal = isFinite(unitsToDate) ? unitsToDate : totalUnits;
  scope.totalUnits = newTotal;

  const tuInput = rowElement.querySelector('[data-k="totalUnits"]');
  if (tuInput) {
    tuInput.value = newTotal;
  }

  return true;
}

// --- Progress entry: last-valid capture + revert helpers ---
// Lightweight utilities to support "revert to last valid" behavior for progress inputs.
// These are UI-agnostic and MUST NOT introduce any save/history/baseline logic.
function captureLastValidProgress(input, value) {
  if (!input || !input.dataset) return;
  // Store as string to preserve integers/decimals exactly as shown in the input.
  const v = (value == null) ? '' : String(value);
  input.dataset.lastValid = v;
}

function revertProgressToLastValid(input, scope, isPercentMode) {
  if (!input || !input.dataset || !scope) return null;

  let lv = input.dataset.lastValid;

  // Fallback: use current model value if we don't have a stored last-valid value.
  if (lv == null || lv === '') {
    try {
      lv = isPercentMode ? String(scope.actualPct ?? 0) : String(scope.unitsToDate ?? 0);
    } catch (e) {
      lv = '0';
    }
  }

  let num = parseFloat(lv);
  if (!isFinite(num)) num = 0;

  // Safety guard: lastValid should already be valid, but ensure it can't re-introduce invalids.
  if (num < 0) num = 0;
  if (isPercentMode && num > 100) num = 100;

  // Restore DOM
  try { input.value = num; } catch (e) {}

  // Restore model
  try {
    if (isPercentMode) {
      scope.actualPct = num;
      scope.unitsToDate = 0;
    } else {
      scope.unitsToDate = num;
    }
  } catch (e) {}

  // Update stored last-valid to the restored value
  try { input.dataset.lastValid = String(num); } catch (e) {}
  return num;
}

export function registerWarningsGlobals() {
  if (typeof window === 'undefined') return;
  if (!window.RPWarnings) window.RPWarnings = {};
  window.RPWarnings.guardSaveWithTimeseries = guardSaveWithTimeseries;
  window.RPWarnings.guardSaveWithDirtyScopes = guardSaveWithDirtyScopes;
  window.RPWarnings.setScopesBaseline = setScopesBaseline;
  window.RPWarnings.scopesDifferFromBaseline = scopesDifferFromBaseline;
  window.RPWarnings.markScopesDirtySinceLastHistory = markScopesDirtySinceLastHistory;
  window.RPWarnings.clearScopesDirtySinceLastHistory = clearScopesDirtySinceLastHistory;
  window.RPWarnings.maybeWarnOnSectionWeightChange = maybeWarnOnSectionWeightChange;
  window.RPWarnings.handleProgressVsTotalUnitsWarning = handleProgressVsTotalUnitsWarning;
  window.RPWarnings.maybeWarnMissingTotalUnitsOnProgressEdit = maybeWarnMissingTotalUnitsOnProgressEdit;
  window.RPWarnings.captureLastValidProgress = captureLastValidProgress;
  window.RPWarnings.revertProgressToLastValid = revertProgressToLastValid;
}
