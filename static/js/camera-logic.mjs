// Pure camera decisions. Labels are hints, so keep a manual camera selector.
const positive = value => Number.isFinite(value) && value > 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function zoomRange(capabilities) {
  const caps = capabilities?.zoom ?? capabilities;
  const min = positive(caps?.min) ? caps.min : 1;
  const max = positive(caps?.max) ? Math.max(min, caps.max) : min;
  return { min, max };
}

/** Return video inputs, best first; prefer a named main rear camera. */
export function rankCameras(devices = [], currentDeviceId = '') {
  return devices.filter(device => device.kind === 'videoinput').map(device => {
    const label = String(device.label || '');
    const name = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]/g, ' ');
    const rear = /\b(back|rear|environment|traseir[ao]|posterior)\b/.test(name);
    const front = /\b(front|frontal|frente|facetime|user)\b/.test(name);
    const ultra = /ultra\s*(wide|grande|angular)/.test(name);
    const virtual = /\b(triple|tripla|triplo|dual|dupla|duplo)\b/.test(name);
    const tele = /\btele(photo|foto|objetiva|objetivo)?\b/.test(name);
    const main = /^(back|rear)( camera)?$|^camera (traseira|posterior)$/.test(name.trim()) || /\b(main|principal)\b/.test(name);
    let score = rear ? 200 : 0;
    if (main && !ultra && !virtual && !tele) score += 100;
    if (/\bwide\b|grande angular/.test(name) && !ultra && !virtual) score += 30;
    if (ultra) score -= 110;
    if (virtual) score -= 80;
    if (tele) score -= 120;
    if (front) score -= 500;
    // Prefer the active device when labels are hidden or two cameras tie.
    if (device.deviceId === currentDeviceId) score += 1;
    return { deviceId: device.deviceId || '', label, score };
  }).sort((first, second) => second.score - first.score);
}

/** Return a deviceId, retaining the active camera when labels are hidden. */
export function chooseCamera(devices = [], currentDeviceId = '') {
  return rankCameras(devices, currentDeviceId).find(device => device.deviceId)?.deviceId || currentDeviceId || '';
}

/** Preserve a valid reported zoom: a virtual camera's 1× need not be its min. */
export function safeInitialZoom(capsZoom, currentSettingsZoom) {
  const { min, max } = zoomRange(capsZoom);
  return clamp(positive(currentSettingsZoom) ? currentSettingsZoom : 1, min, max);
}

/** Usually cap the slider at 4×, without excluding its minimum or active zoom. */
export function maxUiZoom(caps, currentSettingsZoom) {
  const { min, max } = zoomRange(caps);
  const current = positive(currentSettingsZoom) ? clamp(currentSettingsZoom, min, max) : min;
  return Math.min(max, Math.max(min, 4, current));
}

/** Map an object-fit:contain click to [0,1] video coordinates; ignore letterbox. */
export function getFocusPoint(clientX, clientY, rect, videoWidth, videoHeight) {
  if (!rect || ![clientX, clientY, rect.left, rect.top].every(Number.isFinite) ||
      ![rect.width, rect.height, videoWidth, videoHeight].every(positive)) return null;
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale, height = videoHeight * scale;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  const x = (clientX - left) / width, y = (clientY - top) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
