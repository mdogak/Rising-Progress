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

  days.forEach((d, idx) => {
    const tr = document.createElement("tr");
    const b = baseline[idx];
    const p = planned[idx];
    const a = actual[idx];

    tr.innerHTML = `
      <td>${d}</td>
      <td class="right">${b == null ? "" : (Number(b) || 0).toFixed(1)}%</td>
      <td class="right">${p == null ? "" : (Number(p) || 0).toFixed(1)}%</td>
      <td class="right">
        <input
          class="right-input"
          type="number"
          min="0"
          max="100"
          data-day="${d}"
          value="${a == null ? "" : Number(a).toFixed(1)}"
          style="width:50px"
        />
      </td>
    `;
    tb.appendChild(tr);
  });

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
