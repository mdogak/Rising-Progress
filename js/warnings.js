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
          historyDate >= start &&
          historyDate <= end &&
          actualPct < 100
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