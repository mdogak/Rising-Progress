/*
© 2025 Rising Progress LLC. All rights reserved.

warnings.js
- Purely additive DOM warning outlines to guide daily entry fields.
- No model mutation, no persistence, no inline styles.
*/

export function applyScopeWarnings({ model, container } = {}) {
  try {
    const cont = container || document.getElementById('scopeRows');
    if (!cont || !model || !Array.isArray(model.scopes)) return;

    const hdEl = document.getElementById('historyDate');
    const hdStr = (hdEl && typeof hdEl.value === 'string') ? hdEl.value.trim() : '';
    const hd = parseDateStrict(hdStr);

    const rows = cont.querySelectorAll('.row');
    rows.forEach(row => {
      const idx = Number(row.dataset.index);
      if (!isFinite(idx)) return;

      const s = model.scopes[idx];
      if (!s) return;

      const progressEl = row.querySelector('input[data-k="progress"]');
      const totalUnitsEl = row.querySelector('input[data-k="totalUnits"]');

      // Always clear prior warning classes first (every render)
      if (progressEl) {
        progressEl.classList.remove('warn-progress-blue', 'warn-progress-orange');
      }
      if (totalUnitsEl) {
        totalUnitsEl.classList.remove('warn-totalunits-orange');
      }

      const actualPct = Number(s.actualPct);
      const isComplete = (isFinite(actualPct) && actualPct >= 100) || row.classList.contains('scope-complete');
      if (isComplete) {
        // Suppress all warnings when complete
        return;
      }

      // --- Rule 1: Progress entry field (data-k="progress") ---
      if (progressEl) {
        let useOrange = false;

        // Escalated state only if ALL conditions are true
        if (hd && isFinite(hd.getTime())) {
          const dStart = parseDateStrict(s.start);
          const dEnd = parseDateStrict(s.end);

          if (dStart && dEnd && isFinite(dStart.getTime()) && isFinite(dEnd.getTime())) {
            if (hd >= dStart && hd <= dEnd) {
              if (isFinite(actualPct) && actualPct < 100) {
                useOrange = true;
              }
            }
          }
        }

        if (useOrange) {
          progressEl.classList.add('warn-progress-orange');
        } else {
          progressEl.classList.add('warn-progress-blue');
        }
      }

      // --- Rule 2: Total Units field (data-k="totalUnits") ---
      if (totalUnitsEl) {
        const unitsLabel = (s.unitsLabel == null ? '' : String(s.unitsLabel)).trim();
        const totalUnitsVal = s.totalUnits;

        const isNonPercent = unitsLabel !== '%';
        const isZeroOrBlank = (totalUnitsVal === 0 || totalUnitsVal === '');

        if (isNonPercent && isZeroOrBlank) {
          totalUnitsEl.classList.add('warn-totalunits-orange');
        }
      }
    });
  } catch (_) {
    // Never throw from warning logic
  }
}

function parseDateStrict(val) {
  if (!val || typeof val !== 'string') return null;
  const d = new Date(val + 'T00:00:00');
  if (!d || isNaN(d.getTime())) return null;
  return d;
}
