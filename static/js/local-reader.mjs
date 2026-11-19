/**
 * Background ZXing reader for browsers without a native BarcodeDetector.
 * createLocalReader() never blocks camera startup. `ready` resolves to a boolean;
 * `decode` returns null until available, on failure, or when already busy.
 * A successful decode transfers ownership of imageData.data's buffer to the
 * worker. Obtain a fresh ImageData per frame; do not reuse that buffer.
 */
export function createLocalReader({
  onStatus = () => {},
  workerFactory = url => new Worker(url),
  initTimeoutMs = 12000,
  decodeTimeoutMs = 4000,
} = {}) {
  let worker = null, available = false, stopped = false, nextId = 0;
  let initTimer = null, resolveReady;
  const pending = new Map();
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const status = value => { try { onStatus(value); } catch { /* UI callbacks cannot break the fallback. */ } };
  function finishReady(value) { resolveReady?.(value); resolveReady = null; }
  function shutdown(state = 'unavailable') {
    if (stopped) return;
    stopped = true; available = false; clearTimeout(initTimer);
    worker?.terminate(); worker = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.resolve(null); }
    pending.clear(); finishReady(false); status(state);
  }
  status('loading');
  try {
    worker = workerFactory(new URL('./barcode-worker.js?v=1', import.meta.url));
    worker.onmessage = ({data}) => {
      if (stopped || !data) return;
      if (data.type === 'ready') {
        clearTimeout(initTimer); available = true; finishReady(true); status('ready'); return;
      }
      if (data.type === 'error') { shutdown(); return; }
      if (data.type !== 'result') return;
      const item = pending.get(data.id); if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer); item.resolve(data.result ?? null);
    };
    worker.onerror = event => { event.preventDefault?.(); shutdown(); };
    worker.onmessageerror = () => shutdown();
    initTimer = setTimeout(() => shutdown(), initTimeoutMs);
  } catch { shutdown(); }
  return {
    ready,
    get available() { return available && !stopped; },
    decode(imageData) {
      if (!available || stopped || pending.size || !imageData?.data) return Promise.resolve(null);
      const {width, height, data} = imageData;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
          width * height > 8000000 || data.byteLength !== width * height * 4) return Promise.resolve(null);
      const pixels = data.byteOffset === 0 && data.buffer.byteLength === data.byteLength ? data : new Uint8ClampedArray(data);
      const id = ++nextId;
      return new Promise(resolve => {
        const timer = setTimeout(() => shutdown(), decodeTimeoutMs);
        pending.set(id, {resolve, timer});
        try { worker.postMessage({type:'decode', id, image:{width, height, data:pixels}}, [pixels.buffer]); }
        catch { shutdown(); }
      });
    },
    dispose() { shutdown('stopped'); },
  };
}
