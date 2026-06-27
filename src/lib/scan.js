// src/lib/scan.js
// On-device boarding-pass (PDF417) decoder. Uses native BarcodeDetector when it
// supports pdf417 (Android Chrome); otherwise lazy-imports @zxing/library (the
// iOS path — Safari has no BarcodeDetector). Decoding NEVER leaves the device.
// This whole module is dynamically imported only when the scan sheet opens.

function hasCamera() {
  return typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function scanBarcode(videoEl, signal) {
  if (!hasCamera()) throw new Error('no-camera');
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('pdf417')) return await scanNative(videoEl, signal);
    } catch (e) { /* fall through to zxing */ }
  }
  return await scanZxing(videoEl, signal);
}

// Native path: we own the camera stream and poll the detector each frame.
async function scanNative(videoEl, signal) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const stop = () => stream.getTracks().forEach((t) => t.stop());
  if (signal.aborted) { stop(); throw new Error('aborted'); }
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  await videoEl.play();
  const detector = new window.BarcodeDetector({ formats: ['pdf417'] });
  return await new Promise((resolve, reject) => {
    let raf = 0;
    const onAbort = () => { cancelAnimationFrame(raf); stop(); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
    const tick = async () => {
      if (signal.aborted) return;
      try {
        const codes = await detector.detect(videoEl);
        if (codes && codes.length) {
          signal.removeEventListener('abort', onAbort);
          stop();
          resolve(codes[0].rawValue);
          return;
        }
      } catch (e) { /* transient frame error — keep trying */ }
      raf = requestAnimationFrame(tick);
    };
    tick();
  });
}

// zxing path: the library owns the camera stream; reset() stops it.
async function scanZxing(videoEl, signal) {
  const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library');
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
  const reader = new BrowserMultiFormatReader(hints);
  const stop = () => { try { reader.reset(); } catch (e) {} };
  if (signal.aborted) throw new Error('aborted');
  const onAbort = () => stop();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await reader.decodeOnceFromConstraints(
      { video: { facingMode: 'environment' } }, videoEl);
    return result.getText();
  } finally {
    signal.removeEventListener('abort', onAbort);
    stop();
  }
}
