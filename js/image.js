// Image capture and clipboard helpers for Rising Progress
// Captures the chart + watermark + custom legend (including days-rel text)
// as a white-background JPG.

function withTemporarilyHiddenElements(ids, fn) {
  const previous = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      previous[id] = el.style.display;
      el.style.display = 'none';
    }
  });
  return fn().finally(() => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = Object.prototype.hasOwnProperty.call(previous, id)
          ? previous[id]
          : '';
      }
    });
  });
}

async function captureChartRegionAsCanvas() {
  const card = document.getElementById('chartCard');
  if (!card) {
    throw new Error('Chart container not found.');
  }
  if (typeof html2canvas === 'undefined') {
    throw new Error('html2canvas is not available.');
  }

  const hideIds = ['startupControls', 'bpStats', 'planDelta'];

  return withTemporarilyHiddenElements(hideIds, async () => {
    // Use devicePixelRatio for crisp exports
    const scale = window.devicePixelRatio || 2;
    const canvas = await html2canvas(card, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true
    });
    return canvas;
  });
}

function getSuggestedImageName() {
  const input = document.getElementById('projectName');
  const raw = input && input.value ? input.value.trim() : '';
  if (!raw) return 'progress_chart';
  return raw.replace(/\s+/g, '_');
}

async function downloadJpgFromCanvas(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = getSuggestedImageName() + '.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function clipboardWriteJpgFromCanvas(canvas) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard API not supported for images in this browser.');
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (!b) {
        reject(new Error('Failed to create image blob.'));
      } else {
        resolve(b);
      }
    }, 'image/jpeg', 0.92);
  });

  const item = new ClipboardItem({ 'image/jpeg': blob });
  await navigator.clipboard.write([item]);
}

// Public helpers

window.saveChartImageJpg = async function saveChartImageJpg() {
  try {
    const canvas = await captureChartRegionAsCanvas();
    await downloadJpgFromCanvas(canvas);
    if (typeof window.showToast === 'function') {
      window.showToast('Image downloaded');
    }
  } catch (err) {
    console.error('Save Image failed', err);
    alert('Save Image failed: ' + (err && err.message ? err.message : err));
  }
};

window.copyChartImageToClipboard = async function copyChartImageToClipboard() {
  try {
    const canvas = await captureChartRegionAsCanvas();
    try {
      await clipboardWriteJpgFromCanvas(canvas);
      if (typeof window.showToast === 'function') {
        window.showToast('Image saved to clipboard');
      } else {
        alert('Image saved to clipboard');
      }
    } catch (clipErr) {
      console.error('Clipboard image write failed, falling back to download', clipErr);
      // Fallback: download instead of clipboard
      await downloadJpgFromCanvas(canvas);
      if (typeof window.showToast === 'function') {
        window.showToast('Clipboard not supported; image downloaded instead');
      } else {
        alert('Clipboard not supported; image downloaded instead');
      }
    }
  } catch (err) {
    console.error('Copy Chart failed', err);
    alert('Copy Chart failed: ' + (err && err.message ? err.message : err));
  }
};
