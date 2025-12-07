async function captureRegionCanvas() {
  const region = document.getElementById('captureRegion');
  if (!region) throw new Error("captureRegion not found");

  return await html2canvas(region, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true
  });
}

window.saveChartImageJpg = async function () {
  try {
    const canvas = await captureRegionCanvas();
    const url = canvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert("Save Image failed: " + err.message);
  }
};

window.copyChartImageToClipboard = async function () {
  try {
    const originalCanvas = await captureRegionCanvas();

    const targetWidth = 700;
    const scaleFactor = targetWidth / originalCanvas.width;
    const targetHeight = originalCanvas.height * scaleFactor;

    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = targetWidth;
    resizedCanvas.height = targetHeight;

    const ctx = resizedCanvas.getContext('2d');
    ctx.drawImage(originalCanvas, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise(resolve =>
      resizedCanvas.toBlob(resolve, 'image/png', 0.99)
    );

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      alert("Image copied at email-friendly size (700px width)");
    } catch (e) {
      const fallback = resizedCanvas.toDataURL('image/jpeg', 0.85);
      const a = document.createElement('a');
      a.href = fallback;
      a.download = 'chart-email-size.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (err) {
    alert("Copy Chart failed: " + err.message);
  }
};
