export function initToolbarClear({
  syncScopeRowsToModel,
  computeAndRender,
  COOKIE_KEY,
  loadFromPresetCsv
}) {
  const btn = document.getElementById('toolbarClear');
  if (!btn) return;
 
  // Create modal once
  let modal = document.getElementById('clearModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'clearModal';
    modal.innerHTML = `
      <style>
        #clearModal {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        #clearModal .card {
          background: #fff;
          padding: 20px 24px;
          border-radius: 6px;
          width: 360px;
          max-height: 80vh;
          overflow-y: auto;
          font-family: system-ui, sans-serif;
          box-shadow: 0 10px 30px rgba(0,0,0,.25);
        }
        #clearModal h3 {
          margin: 0 0 12px 0;
          font-size: 16px;
          font-weight: 600;
        }
        #clearModal label {
          display: block;
          margin: 6px 0;
          font-size: 14px;
        }
        #clearModal .actions {
          margin-top: 16px;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      </style>
      <div class="card">
        <h3>Select the items you want to clear:</h3>
        <label><input type="checkbox" data-k="all"> All (load blank project)</label>
<label><input type="checkbox" data-k="start" > Start Dates</label>
<label><input type="checkbox" data-k="end" > End Dates</label>
<label><input type="checkbox" data-k="cost" > Scope weightings</label>
<label><input type="checkbox" data-k="totalUnits"> Total Units</label>
<label><input type="checkbox" data-k="progress"> % or Units to Date</label>
<label><input type="checkbox" data-k="units"> Units</label>
<label><input type="checkbox" data-k="baseline" > Baseline</label>
<label><input type="checkbox" data-k="history" > Actuals History</label>
<label><input type="checkbox" data-k="timeseries" > Scope History</label>

        <div class="actions">
          <button id="clearCancel">Cancel</button>
          <button id="clearOk">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  btn.addEventListener('click', () => {
    // Keep modal stateless: reset checks each time it opens
    modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });
    modal.style.display = 'flex';
  });

  modal.querySelector('#clearCancel').onclick = () => {
    modal.style.display = 'none';
  };

  modal.querySelector('#clearOk').onclick = async () => {
    const checks = {};
    modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      checks[cb.dataset.k] = cb.checked;
    });

    modal.style.display = 'none';

    if (checks.all) {
      const r = await fetch('Project_Files/default_progress_all.prgs');
      const t = await r.text();
      loadFromPresetCsv(t);
      return;
    }

    model.scopes.forEach(s => {
      if (checks.start) s.start = '';
      if (checks.end) s.end = '';
      if (checks.cost) s.cost = 0;
      if (checks.totalUnits) s.totalUnits = '';
      if (checks.progress) {
        s.unitsToDate = 0;
        s.actualPct = 0;
      }
      if (checks.units) {
        // Reset units back to default (%). Some models store this as unitsLabel.
        if ('unitsLabel' in s) s.unitsLabel = '%';
        if ('units' in s) s.units = '%';
        if ('unitslabel' in s) s.unitslabel = '%';
      }
    });
// Baseline / history / timeseries clears (kept explicit and easy to reason about)
if (checks.baseline) {
  // If the baseline structure changes in future, setting to null still guarantees
  // baseline.days[] and baseline.planned[] are cleared.
  model.baseline = null;
}

if (checks.history) {
  model.history = [];
  model.dailyActuals = {};
}

if (checks.timeseries) {
  // Clear timeseries caches only (do not modify scopes)
  model.timeSeriesScopes = [];
  model.timeSeriesProject = [];
  model.timeSeriesSections = [];
}
syncScopeRowsToModel();
    computeAndRender();
    sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  };
}
