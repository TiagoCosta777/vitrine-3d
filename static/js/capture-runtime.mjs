// Browser primitives shared by the quick camera and native-photo paths.
// Avoid AbortSignal.timeout/createImageBitmap so older mobile browsers work too.
function errorWithName(message, name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function duration(value, fallback) {
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, 2147483647)
    : fallback;
}

/** Fetch with a bounded wait, including browsers without AbortSignal.timeout. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const external = options.signal;
  if (external?.aborted) throw errorWithName('Operação cancelada.', 'AbortError');
  const controller = new AbortController();
  let timer = null;
  let rejectAbort;
  let timedOut = false;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    controller.abort();
    rejectAbort(errorWithName('Operação cancelada.', 'AbortError'));
  };
  if (external?.addEventListener) external.addEventListener('abort', cancel, {once:true});
  timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectAbort(errorWithName('Tempo de espera esgotado. Tente novamente.', 'TimeoutError'));
  }, duration(timeoutMs, 30000));
  try {
    const request = Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        throw errorWithName(timedOut ? 'Tempo de espera esgotado. Tente novamente.' : 'Operação cancelada.', timedOut ? 'TimeoutError' : 'AbortError');
      }
      return globalThis.fetch(url, {...options, signal:controller.signal});
    });
    return await Promise.race([request, aborted]);
  } catch (error) {
    if (timedOut) throw errorWithName('Tempo de espera esgotado. Tente novamente.', 'TimeoutError');
    throw error;
  } finally {
    clearTimeout(timer);
    if (external?.removeEventListener) external.removeEventListener('abort', cancel);
  }
}

/** Encode a canvas, rejecting empty results, thrown errors and stalled callbacks. */
export function canvasBlob(canvas, type = 'image/jpeg', quality = .9, {timeoutMs = 5000} = {}) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      reject(new Error('Não foi possível preparar a foto neste navegador.'));
      return;
    }
    let settled = false;
    let timer;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    timer = setTimeout(() => finish(null, errorWithName('A preparação da foto demorou demais. Tente novamente.', 'TimeoutError')), duration(timeoutMs, 5000));
    try {
      canvas.toBlob(blob => {
        if (!blob || (typeof blob.size === 'number' && blob.size === 0)) {
          finish(null, new Error('A câmera não produziu uma foto válida. Tente novamente.'));
        } else finish(blob);
      }, type, quality);
    } catch (error) {
      finish(null, error);
    }
  });
}

function imageFromUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let timer;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) {
        try { image.src = ''; } catch { /* Decoder cleanup must not hide the error. */ }
        reject(error);
      } else resolve(image);
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Não foi possível abrir esta foto. Tente fotografar novamente.'));
    timer = setTimeout(() => finish(errorWithName('A abertura da foto demorou demais. Tente novamente.', 'TimeoutError')), duration(timeoutMs, 12000));
    try { image.src = url; } catch (error) { finish(error); }
  });
}

/**
 * Prepare a photo selected/taken through a native file input.
 * HTMLImageElement lets the browser apply photo orientation before drawImage.
 * All internal object URLs are revoked; callers own only the returned Blob.
 */
export async function fileToFrame(file, {maxSide = 1400, timeoutMs = 12000, quality = .9} = {}) {
  if (!file || typeof file.size !== 'number' || file.size <= 0) throw new Error('Selecione uma foto válida.');
  if (!Number.isFinite(maxSide) || maxSide < 1) throw new Error('Tamanho de foto inválido.');
  const limit = Math.floor(maxSide);
  let url = null;
  let image = null;
  try {
    url = URL.createObjectURL(file);
    image = await imageFromUrl(url, timeoutMs);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
      throw new Error('Esta foto não tem dimensões válidas.');
    }
    const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a imagem neste navegador.');
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasBlob(canvas, 'image/jpeg', quality);
    return {blob, width, height};
  } finally {
    if (image) { try { image.src = ''; } catch { /* Release the object URL regardless. */ } }
    if (url !== null) URL.revokeObjectURL(url);
  }
}
