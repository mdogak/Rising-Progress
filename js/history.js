/*
© 2025 Rising Progress LLC. All rights reserved.
*/

// UI state for history expand/collapse toggles.
// This must persist across computeAndRender-driven re-renders.
let historyUpperExpanded = false;
let historyLowerExpanded = false;

// History and baseline helpers for Rising Progress
// This ES module works alongside progress.js and assumes that progress.js
// has already attached `model`, `setCookie`, and `COOKIE_KEY` to `window`.

export function getBaselineSeries(days, plannedCum) {
  const model = window.model || {};
  const baseline = model.baseline;

  if (baseline && Array.isArray(baseline.days) && Array.isArray(baseline.planned)) {
    // map baseline snapshot to current days
    const map = new Map();
    baseline.days.forEach((d, idx) => map.set(d, baseline.planned[idx]));
    return days.map(d => (map.has(d) ? map.get(d) : null));
  }

  // no baseline yet -> mirrors planned
  return plannedCum.slice();
}

export function takeBaseline(days, plannedCum, model, setCookie, COOKIE_KEY) {
  // Fall back to globals if dependencies weren't passed explicitly
  const effectiveModel = model || (window.model || {});

  effectiveModel.baseline = {
    days: days.slice(),
    planned: plannedCum.slice(),
    ts: Date.now()
  };

  window.model = effectiveModel;

  const effectiveSetCookie = setCookie || window.setCookie;
  const effectiveCookieKey = COOKIE_KEY || window.COOKIE_KEY;

  if (typeof effectiveSetCookie === "function" && effectiveCookieKey) {
    try {
      effectiveSetCookie(effectiveCookieKey, JSON.stringify(effectiveModel), 3650);
    } catch (e) {
      console.error("Failed to persist model after baseline capture", e);
    }
  }
}

/**
 * Render the daily history table and wire up inline edits to feed back into the model.
 *
 * @param {string[]} days
 * @param {number[]} baseline
 * @param {number[]} planned
 * @param {number[]} actual
 * @param {{ computeAndRender?: Function }} [opts]
 */
export function renderDailyTable(days, baseline, planned, actual, opts = {}) {
  const tb = document.querySelector("#dailyTable tbody");
  if (!tb) return;

  tb.innerHTML = "";

  // If no days, nothing to render
  if (!Array.isArray(days) || days.length === 0) {
    return;
  }

  // Build a data model for the rows first so we can determine the
  // "latest actual" index and then band rows around it.
  const rowsData = days.map((d, idx) => {
    return {
      day: d,
      baseline: Array.isArray(baseline) ? baseline[idx] : null,
      planned: Array.isArray(planned) ? planned[idx] : null,
      actual: Array.isArray(actual) ? actual[idx] : null
    };
  });

  // Find the latest index that has an actual value (non-null, non-NaN).
  let latestActualIndex = -1;
  rowsData.forEach((row, idx) => {
    if (row.actual != null && !Number.isNaN(Number(row.actual))) {
      latestActualIndex = idx;
    }
  });

  // If nothing has an actual yet, just render a flat table like before.
  if (latestActualIndex === -1) {
    rowsData.forEach((row) => {
      const tr = document.createElement("tr");
      const b = row.baseline;
      const p = row.planned;
      const a = row.actual;
      tr.classList.add("history-row", "history-row-visible");
      tr.innerHTML = `
        <td>${row.day}</td>
        <td class="right">${b == null ? "" : (Number(b) || 0).toFixed(1)}%</td>
        <td class="right">${p == null ? "" : (Number(p) || 0).toFixed(1)}%</td>
        <td class="right">
          <input
            class="right-input"
            type="number"
            min="0"
            max="100"
            data-day="${row.day}"
            value="${a == null ? "" : Number(a).toFixed(1)}"
            style="width:50px"
          />
        </td>
      `;
      tb.appendChild(tr);
    });
  } else {
    // Oldest rows are at index 0, newest at the end.
    // We create a "window" of rows centered around the latest actual,
    // showing 6 rows above and 6 rows below (clamped to bounds).
    const WINDOW_SIZE = 6;
    const total = rowsData.length;

    const startWindow = Math.max(0, latestActualIndex - WINDOW_SIZE);
    const endWindow = Math.min(total - 1, latestActualIndex + WINDOW_SIZE);

    const hasUpperHidden = startWindow > 0;
    const hasLowerHidden = endWindow < total - 1;

    const createRow = (row, group) => {
      const tr = document.createElement("tr");
      const b = row.baseline;
      const p = row.planned;
      const a = row.actual;

      tr.classList.add("history-row");
      if (group === "upper") tr.classList.add("history-row-upper");
      if (group === "middle") tr.classList.add("history-row-visible");
      if (group === "lower") tr.classList.add("history-row-lower");

      if (group === "upper" || group === "lower") {
        // Collapsed/expanded state must persist across re-renders.
        const expanded = group === "upper" ? historyUpperExpanded : historyLowerExpanded;
        tr.style.display = expanded ? "" : "none";
      }

      tr.innerHTML = `
        <td>${row.day}</td>
        <td class="right">${b == null ? "" : (Number(b) || 0).toFixed(1)}%</td>
        <td class="right">${p == null ? "" : (Number(p) || 0).toFixed(1)}%</td>
        <td class="right">
          <input
            class="right-input"
            type="number"
            min="0"
            max="100"
            data-day="${row.day}"
            value="${a == null ? "" : Number(a).toFixed(1)}"
            style="width:50px"
          />
        </td>
      `;
      tb.appendChild(tr);
    };

    // Upper hidden band (older dates above the visible window)
    if (hasUpperHidden) {
      const upperToggleRow = document.createElement("tr");
      upperToggleRow.classList.add("history-toggle-row", "history-toggle-row-upper");
      upperToggleRow.innerHTML = `
        <td colspan="4">
          <button type="button" class="history-toggle-btn" data-target="upper" data-expanded="${historyUpperExpanded ? "true" : "false"}">
            ${historyUpperExpanded ? "– Hide older history entries" : "+ Show older history entries"}
          </button>
        </td>
      `;
      tb.appendChild(upperToggleRow);

      for (let i = 0; i < startWindow; i++) {
        createRow(rowsData[i], "upper");
      }
    }

    // Middle visible band (centered around latest actual)
    for (let i = startWindow; i <= endWindow; i++) {
      createRow(rowsData[i], "middle");
    }

    // Lower hidden band (dates below the visible window)
    if (hasLowerHidden) {
      for (let i = endWindow + 1; i < total; i++) {
        createRow(rowsData[i], "lower");
      }

      const lowerToggleRow = document.createElement("tr");
      lowerToggleRow.classList.add("history-toggle-row", "history-toggle-row-lower");
      lowerToggleRow.innerHTML = `
        <td colspan="4">
          <button type="button" class="history-toggle-btn" data-target="lower" data-expanded="${historyLowerExpanded ? "true" : "false"}">
            ${historyLowerExpanded ? "– Hide future history entries" : "+ Show more future history entries"}
          </button>
        </td>
      `;
      tb.appendChild(lowerToggleRow);
    }
  }

  const computeAndRender = opts.computeAndRender;
  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  document
    .querySelectorAll("#dailyTable input[type=number]")
    .forEach((inp) => {
      const handler = () => {
        const model = window.model || {};
        const day = inp.dataset.day;
        const raw = inp.value;
        const v = raw === "" ? undefined : clamp(Number(raw), 0, 100);

        if (!model.dailyActuals) model.dailyActuals = {};
        model.dailyActuals[day] = v;
        window.model = model;

        if (typeof computeAndRender === "function") {
          computeAndRender();
        }

        if (typeof window.setCookie === "function" && window.COOKIE_KEY) {
          try {
            window.setCookie(window.COOKIE_KEY, JSON.stringify(model), 3650);
          } catch (e) {
            console.error("Failed to persist model after daily edit", e);
          }
        }
      };

      inp.addEventListener("change", handler);
      inp.addEventListener("blur", handler);
    });

  // Wire up toggle buttons for collapsing/expanding upper/lower bands.
  const toggleButtons = tb.querySelectorAll(".history-toggle-btn");
  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      const expanded = btn.getAttribute("data-expanded") === "true";

      const rowsSelector =
        target === "upper"
          ? ".history-row-upper"
          : ".history-row-lower";

      const rows = tb.querySelectorAll(rowsSelector);
      const newExpanded = !expanded;

      rows.forEach((row) => {
        row.style.display = newExpanded ? "" : "none";
      });

      btn.setAttribute("data-expanded", newExpanded ? "true" : "false");

      // Persist UI state across subsequent re-renders.
      if (target === "upper") {
        historyUpperExpanded = newExpanded;
        btn.textContent = newExpanded
          ? "– Hide older history entries"
          : "+ Show older history entries";
      } else {
        historyLowerExpanded = newExpanded;
        btn.textContent = newExpanded
          ? "– Hide future history entries"
          : "+ Show more future history entries";
      }
    });
  });
}
/**
 * Wire up the "Add to History" snapshot button so it captures the current
 * total actual progress into the model history + dailyActuals and triggers a re-render.
 */
export function initHistory({ calcTotalActualProgress, fmtDate, today, computeAndRender }) {
  const snapshotBtn = document.getElementById("snapshot");
  if (!snapshotBtn) return;

  snapshotBtn.addEventListener("click", () => {
    const model = window.model || {};
    const dateInput = document.getElementById("historyDate");

    const d =
      (dateInput && dateInput.value)
        ? dateInput.value
        : (typeof fmtDate === "function" && today ? fmtDate(today) : "");

    if (!d) return;

    const pct = typeof calcTotalActualProgress === "function"
      ? calcTotalActualProgress()
      : 0;

    if (!Array.isArray(model.history)) model.history = [];

    const idx = model.history.findIndex((h) => h.date === d);
    if (idx >= 0) {
      model.history[idx].actualPct = pct;
    } else {
      model.history.push({ date: d, actualPct: pct });
    }

    if (!model.dailyActuals) model.dailyActuals = {};
    model.dailyActuals[d] = pct;

    // vNext TIMESERIES snapshot (authoritative; overwrite by historyDate)
    model.timeSeriesProject = model.timeSeriesProject || {};
    model.timeSeriesScopes = model.timeSeriesScopes || {};
    model.timeSeriesSections = model.timeSeriesSections || {};

    // PROJECT snapshot (no toggles)
    model.timeSeriesProject[d] = [
      { historyDate: d, key: 'name', value: (model.project && model.project.name) || '' },
      { historyDate: d, key: 'startup', value: (model.project && model.project.startup) || '' },
      { historyDate: d, key: 'markerLabel', value: (model.project && model.project.markerLabel) || '' }
    ];

    // Planned-to-date helper (historyDate-driven; avoids UI timing issues)
    const __clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
    const __parseDate = (val) => val ? new Date(val + 'T00:00:00') : null;
    const __daysBetween = (aStr, bStr) => {
      const da = __parseDate(aStr);
      const db = __parseDate(bStr);
      if(!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
      return Math.floor((db - da) / 86400000) + 1; // inclusive
    };
    // Matches progress.js planned semantics but uses explicit historyDate (no system-date fallback)
    const __plannedPctToDate = (scope, historyDateStr) => {
      if(!scope || !scope.start || !scope.end) return 0;
      const dStart = __parseDate(scope.start);
      const dEnd   = __parseDate(scope.end);
      const t      = __parseDate(historyDateStr);
      if(!dStart || !dEnd || !t || isNaN(dStart.getTime()) || isNaN(dEnd.getTime()) || isNaN(t.getTime())) return 0;

      // Invalid range: end before start => treat as 100%
      if(dEnd < dStart) return 100;

      if(t < dStart) return 0;
      if(t > dEnd) return 100;

      const durationDays = __daysBetween(scope.start, scope.end);
      const elapsedDays  = __daysBetween(scope.start, historyDateStr);

      if(durationDays <= 0) return 100;

      return __clamp((elapsedDays / durationDays) * 100, 0, 100);
    };

    // SCOPES snapshot
    model.timeSeriesScopes[d] = (model.scopes || []).map(s => ({
      historyDate: d,
      scopeId: s.scopeId,
      label: s.label,
      start: s.start,
      end: s.end,
      cost: s.cost,
      perDay: s.perDay,
      actualPct: s.actualPct,
      unitsToDate: (s.totalUnits ? s.unitsToDate : ''),
      totalUnits: s.totalUnits,
      unitsLabel: s.unitsLabel,
      plannedtodate: (s && s.totalUnits && Number(s.totalUnits) > 0)
        ? (__plannedPctToDate(s, d) / 100) * Number(s.totalUnits)
        : __plannedPctToDate(s, d),
      sectionName: s.sectionName,
      sectionID: s.sectionID
    }));

    // SECTIONS snapshot (contiguous nonblank segments; UI order)
    // Rules:
    // - Build from the model (not DOM)
    // - Ignore unsectioned scopes (blank sectionName)
    // - Preserve UI order (no sorting)
    // - sectionID is authoritative; sectionTitle is descriptive only
    (function captureSectionSnapshots(){
      const scopes = Array.isArray(model.scopes) ? model.scopes : [];
      const totalCost = scopes.reduce((sum, s)=> sum + (Number(s && s.cost) || 0), 0);
      const weights = scopes.map(s => totalCost > 0 ? ((Number(s && s.cost) || 0) / totalCost) : 0);

      const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
      const parseDate = (val) => val ? new Date(val + 'T00:00:00') : null;
      const daysBetween = (aStr, bStr) => {
        const da = parseDate(aStr);
        const db = parseDate(bStr);
        if(!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
        return Math.floor((db - da) / 86400000) + 1; // inclusive
      };

      // Local planned% helper: matches progress.js behavior (planned uses historyDate only; no system-date fallback)
      const plannedPctToDate = (scope, historyDateStr) => {
        if(!scope || !scope.start || !scope.end) return 0;
        const dStart = parseDate(scope.start);
        const dEnd   = parseDate(scope.end);
        const t      = parseDate(historyDateStr);
        if(!dStart || !dEnd || !t || isNaN(dStart.getTime()) || isNaN(dEnd.getTime()) || isNaN(t.getTime())) return 0;

        // Invalid range: end before start => treat as 100%
        if(dEnd < dStart) return 100;

        if(t < dStart) return 0;
        if(t > dEnd) return 100;

        const durationDays = daysBetween(scope.start, scope.end);
        const elapsedDays  = daysBetween(scope.start, historyDateStr);

        if(durationDays <= 0) return 100;

        return clamp((elapsedDays / durationDays) * 100, 0, 100);
      };

      const rows = [];
      let i = 0;

      while(i < scopes.length){
        const s0 = scopes[i] || {};
        const name = String(s0.sectionName || '');
        const sid  = String(s0.sectionID || '');

        // Ignore unsectioned scopes
        if(!name){
          i++;
          continue;
        }

        // Determine contiguous segment bounds (same sectionName + sectionID)
        const start = i;
        let end = i;
        while(end + 1 < scopes.length){
          const sN = scopes[end + 1] || {};
          const name2 = String(sN.sectionName || '');
          const sid2  = String(sN.sectionID || '');
          if(!name2) break;
          if(name2 !== name) break;
          if(sid2 !== sid) break;
          end++;
        }

        // Compute rollups using the same weighting logic as section headers:
        // - Scope weights are derived from cost/totalCost (fractions)
        // - Section weight is sum of those weights (no re-scaling), displayed as percent points
        let wSum = 0;
        let accActual = 0;
        let accPlanned = 0;

        for(let k = start; k <= end; k++){
          const wi = Number(weights[k]) || 0;
          wSum += wi;

          const a = Number((scopes[k] && scopes[k].actualPct) || 0) || 0;
          accActual += wi * a;

          const p = Number(plannedPctToDate(scopes[k], d) || 0) || 0;
          accPlanned += wi * p;
        }

        const sectionWeight = (Number(wSum) || 0) * 100;
        const sectionPct = wSum > 0 ? clamp(accActual / wSum, 0, 100) : 0;
        const sectionPlannedPct = wSum > 0 ? clamp(accPlanned / wSum, 0, 100) : 0;

        rows.push({
          historyDate: d,
          sectionID: sid,
          sectionTitle: name,
          sectionWeight,
          sectionPct,
          sectionPlannedPct
        });

        i = end + 1;
      }

      model.timeSeriesSections[d] = rows;
    })();


    window.model = model;

    if (typeof computeAndRender === "function") {
      computeAndRender();
    }

    if (typeof window.setCookie === "function" && window.COOKIE_KEY) {
      try {
        window.setCookie(window.COOKIE_KEY, JSON.stringify(model), 3650);
      } catch (e) {
        console.error("Failed to persist model after snapshot", e);
      }
    }
  });
}
