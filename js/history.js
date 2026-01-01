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
