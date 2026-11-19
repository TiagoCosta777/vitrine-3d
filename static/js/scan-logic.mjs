// Camera-independent decisions, shared by the live scanner and its tests.
export class CaptureWorkflow {
  constructor() { this.revision = 0; this.reset(); }
  reset() { this.phase = 'ready'; this.revision++; }
  get canStart() { return this.phase === 'ready'; }
  prepare() { if (!this.canStart) return false; this.phase = 'preparing'; return true; }
  start() { if (this.phase !== 'preparing') return false; this.phase = 'capturing'; return true; }
  save() { if (!['capturing', 'retry'].includes(this.phase)) return false; this.phase = 'saving'; return true; }
  complete() { if (this.phase !== 'saving') return false; this.phase = 'done'; return true; }
  fail() { if (this.phase === 'saving') this.phase = 'retry'; }
  cancel() { if (['saving','done'].includes(this.phase)) return false; this.phase = 'ready'; return true; }
}

export function validRetailBarcode(code, format = '') {
  const type = format.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const length = { EAN13: 13, EAN8: 8, UPCA: 12 }[type];
  if (!length) return null;
  if (!new RegExp(`^\\d{${length}}$`).test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(code[i]) * weight;
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}

export class BarcodeConsensus {
  constructor() { this.reset(); }
  reset() { this.code = ''; this.hits = 0; this.lastHit = 0; this.target = 3; this.frames = new Set(); }
  observe(code, now, {format = '', frameId = null} = {}) {
    // One missed frame is common while the camera adjusts its focus. Keep a
    // short window, but never combine observations of different codes.
    if (this.hits && now - this.lastHit > 8000) this.reset();
    const snapshot = () => ({code:this.code,hits:this.hits,target:this.target,confirmed:false});
    if (!code || now < this.lastHit || validRetailBarcode(code, format) === false) return snapshot();
    if (code !== this.code) { this.code = code; this.hits = 0; this.frames.clear(); }
    if (frameId !== null && this.frames.has(frameId)) return snapshot();
    if (frameId !== null) this.frames.add(frameId);
    if (this.frames.size > 8) this.frames.delete(this.frames.values().next().value);
    // Only independently captured, checksum-validated retail codes use two votes.
    this.target = validRetailBarcode(code, format) === true && frameId !== null ? 2 : 3;
    this.lastHit = now;
    this.hits = Math.min(this.target, this.hits + 1);
    return { code, hits: this.hits, target:this.target, confirmed: this.hits >= this.target };
  }
}

export function barcodeRegion(width, height) {
  return { x: width * .04, y: height * .29, width: width * .92, height: height * .42 };
}

export function measureFrame(rgba, width, previous = null, reference = null) {
  const pixels = new Uint8Array(rgba.length / 4);
  let light = 0, detail = 0, clipped = 0;
  for (let i = 0; i < pixels.length; i++) {
    const j = i * 4;
    pixels[i] = Math.round(rgba[j] * .299 + rgba[j + 1] * .587 + rgba[j + 2] * .114);
    light += pixels[i];
    if (pixels[i] > 248) clipped++;
    if (i % width) detail += Math.abs(pixels[i] - pixels[i - 1]);
    if (i >= width) detail += Math.abs(pixels[i] - pixels[i - width]);
  }
  light /= pixels.length;
  // Compensate for global exposure changes when measuring hand movement.
  function difference(other) {
    if (!other || other.length !== pixels.length) return 0;
    let shift = 0, delta = 0;
    for (let i = 0; i < pixels.length; i++) shift += pixels[i] - other[i];
    shift /= pixels.length;
    for (let i = 0; i < pixels.length; i++) delta += Math.abs(pixels[i] - other[i] - shift);
    return delta / pixels.length;
  }
  return { pixels, light, detail: detail / (pixels.length * 2),
    glare: clipped / pixels.length, motion: difference(previous), change: difference(reference) };
}

export function frameProblem(quality) {
  if (quality.light < 28) return { title: 'Ilumine o produto', hint: 'Vá para um lugar mais claro ou ligue a luz da câmera.' };
  if (quality.light > 240 && quality.glare > .8) return { title: 'Reduza a luz direta', hint: 'Incline um pouco para tirar o reflexo da embalagem.' };
  return null;
}

// Time-based stability avoids treating two quickly sampled frames, or a long
// browser pause, as enough evidence that the object is steadily positioned.
export class ObjectStability {
  constructor() { this.reset(); }
  reset() { this.since = null; this.last = null; }
  observe(quality, now, hasPrevious = true) {
    const usable = hasPrevious && Number.isFinite(now) && !frameProblem(quality) && quality.motion < 12;
    const continuous = this.last !== null && now >= this.last && now - this.last <= 650;
    if (!usable || !continuous) this.since = null;
    if (usable && this.since === null) this.since = now;
    this.last = now;
    return this.since === null ? 0 : Math.max(0, now - this.since);
  }
}

export function objectReadiness(quality, { elapsed, stableFor = 0, minimumDelay = 3000, minimumStable = 1100 }) {
  const problem = frameProblem(quality);
  if (problem) return { ...problem, ready: false, count: 0 };
  // Rotation and low texture are guidance, not proof that an object is absent.
  // Symmetric products must not remain blocked on a pixel-difference threshold.
  if (quality.motion >= 12) return { title: 'Pare de girar e mantenha firme', hint: 'Vamos esperar estabilizar antes da foto. Capturar agora continua disponível.', ready: false, count: 0 };
  const ready = elapsed >= minimumDelay && stableFor >= minimumStable;
  return { title: ready ? 'Capturando…' : elapsed < minimumDelay ? 'Posicione e aguarde o foco' : 'Mantenha o objeto parado',
    hint: 'Inclua o objeto inteiro, sem inclinar. A foto aguarda um instante de firmeza; Capturar agora fotografa manualmente.', ready,
    count: ready ? 0 : Math.max(1, Math.ceil(Math.max(minimumDelay - elapsed, minimumStable - stableFor) / 1000)) };
}

export function barcodeHint(quality, misses, hits = 0, target = 3) {
  if (hits) return { title: `Código encontrado · ${hits}/${target}`, hint: 'Só mais um instante no mesmo código. Estamos confirmando a leitura.' };
  const problem = frameProblem(quality);
  if (problem) return problem;
  if (quality.motion >= 12) return { title: 'Segure o celular', hint: 'Apoie os cotovelos e mantenha o código no centro.' };
  if (quality.zoom > 2.5 && misses >= 5) return { title: 'Experimente menos zoom', hint: 'Reduza o zoom e afaste um pouco. As barras precisam ficar nítidas, com margens dos dois lados.' };
  if (quality.detail < 1.5) return { title: 'Ajuste a distância e o foco', hint: 'Deixe as barras maiores na faixa. Se estiver borrado, afaste um pouco e toque para focar.' };
  const tips = [
    ['Mostre o código de barras', 'Enquadre todas as barras e deixe uma margem branca dos dois lados.'],
    ['Ajuste a distância', 'As barras precisam estar nítidas. Se estiver borrado, afaste o celular em vez de aumentar o zoom.'],
    ['Tire o reflexo', 'Incline levemente a embalagem e mantenha o celular parado.'],
    ['Tente outra posição', 'Gire a embalagem para mostrar o código inteiro, sem dobras.'],
    ['Use uma foto nítida', 'Toque em Foto nítida, aguarde o foco da câmera e fotografe o código inteiro.']
  ];
  const [title, hint] = tips[Math.min(tips.length - 1, Math.floor(misses / 4))];
  return { title, hint };
}

