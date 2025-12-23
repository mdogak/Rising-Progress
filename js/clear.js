export function initToolbarClear({
  calcEarliestStart,
  fmtDate,
  syncScopeRowsToModel,
  computeAndRender,
  COOKIE_KEY
}) {
  const btn = document.getElementById('toolbarClear');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!confirm('Clear scope fields and history?')) return;

    const ps = calcEarliestStart();

    model.scopes = model.scopes.map(s => ({
      ...s,
      start: '',
      end: '',
      cost: 0,
      unitsToDate: 0,
      totalUnits: '',
      actualPct: 0
    }));

    if (ps) {
      const psStr = fmtDate(ps);
      Object.keys(model.dailyActuals).forEach(k => {
        if (k >= psStr) delete model.dailyActuals[k];
      });
      model.history = model.history.filter(h => h.date < psStr);
    }

    syncScopeRowsToModel();
    computeAndRender();
    sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  });
}
