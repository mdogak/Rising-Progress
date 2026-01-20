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
  if (!model) return;
  if (!hasSectionTimeseries(model)) return;

  const a = (oldId == null ? '' : String(oldId));
  const b = (newId == null ? '' : String(newId));
  if (a === b) return;

  window.alert(
    "Warning: A scope has moved between sections, changing the weight of the section. Section history will still be based on the previous configuration when scopes are moved."
  );
  window._sectionWeightWarningAcknowledged = true;
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

export function registerWarningsGlobals() {
  if (typeof window === 'undefined') return;
  if (!window.RPWarnings) window.RPWarnings = {};
  window.RPWarnings.guardSaveWithTimeseries = guardSaveWithTimeseries;
  window.RPWarnings.markScopesDirtySinceLastHistory = markScopesDirtySinceLastHistory;
  window.RPWarnings.clearScopesDirtySinceLastHistory = clearScopesDirtySinceLastHistory;
  window.RPWarnings.maybeWarnOnSectionWeightChange = maybeWarnOnSectionWeightChange;
  window.RPWarnings.handleProgressVsTotalUnitsWarning = handleProgressVsTotalUnitsWarning;
}
