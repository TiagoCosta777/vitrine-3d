/* Classic worker: supports Safari without module workers or OffscreenCanvas. */
'use strict';
const READER_OPTIONS = {
  formats: ['EAN13','EAN8','UPCA','UPCE','Code128','Code39','ITF','Codabar','QRCode','DataMatrix','PDF417','Aztec'],
  tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true,
  minLineCount: 2, maxNumberOfSymbols: 8, returnErrors: false,
};
let reader = null, decoding = false;

function validRetailCode(text, format) {
  const normalized = String(format).replace(/[^a-z0-9]/gi,'').toUpperCase();
  const length = {EAN13:13, EAN8:8, UPCA:12}[normalized];
  if (!length) return true; // Other checksums are validated by ZXing itself.
  if (!new RegExp(`^\\d{${length}}$`).test(text)) return false;
  let total = 0;
  for (let i = text.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) total += Number(text[i]) * weight;
  return (10 - total % 10) % 10 === Number(text.at(-1));
}
function selectResult(results) {
  const valid = results.filter(item => item.isValid && String(item.text || '').trim() && validRetailCode(String(item.text).trim(), item.format));
  const codes = [...new Set(valid.map(item => String(item.text).trim()))];
  if (codes.length > 1) return {found:false, ambiguous:true};
  if (!codes.length) return {found:false};
  const result = valid.find(item => String(item.text).trim() === codes[0]);
  return {found:true, barcode:codes[0], format:result.format, source:'wasm'};
}
function redChannel(image) {
  const pixels = new Uint8ClampedArray(image.data.length);
  // Dark blue printing on a pale label often has more contrast in red.
  for (let i = 0; i < pixels.length; i += 4) {
    const value = image.data[i]; pixels[i] = pixels[i+1] = pixels[i+2] = value; pixels[i+3] = 255;
  }
  return {width:image.width, height:image.height, data:pixels};
}
async function decode(image) {
  const first = selectResult(await reader.readBarcodes(image, READER_OPTIONS));
  if (first.found || first.ambiguous) return first;
  return selectResult(await reader.readBarcodes(redChannel(image), READER_OPTIONS));
}
self.onmessage = async ({data}) => {
  if (data?.type !== 'decode') return;
  if (!reader || decoding) { self.postMessage({type:'result', id:data.id, result:null}); return; }
  const image = data.image;
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || image.width * image.height > 8000000 ||
      image.data?.byteLength !== image.width * image.height * 4) {
    self.postMessage({type:'result', id:data.id, result:null}); return;
  }
  decoding = true;
  try { self.postMessage({type:'result', id:data.id, result:await decode(image)}); }
  catch { self.postMessage({type:'error'}); }
  finally { decoding = false; }
};
(async () => {
  try {
    importScripts('../vendor/zxing-wasm/dist/iife/reader/index.js');
    reader = ZXingWASM;
    await reader.prepareZXingModule({
      overrides: {locateFile: path => new URL('../vendor/zxing-wasm/dist/reader/' + path, self.location.href).href},
      fireImmediately: true,
    });
    self.postMessage({type:'ready'});
  } catch { reader = null; self.postMessage({type:'error'}); }
})();
