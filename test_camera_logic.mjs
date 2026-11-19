import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCameras, chooseCamera, safeInitialZoom, maxUiZoom, getFocusPoint } from './static/js/camera-logic.mjs';

const camera = (deviceId, label = '') => ({ kind: 'videoinput', deviceId, label });

test('iOS main back camera ranks above ultra wide, dual, triple, telephoto, and front', () => {
  const devices = [camera('front', 'Front Camera'), camera('ultra', 'Back Ultra Wide Camera'),
    camera('dual', 'Back Dual Wide Camera'), camera('triple', 'Back Triple Camera'),
    camera('tele', 'Back Telephoto Camera'), camera('main', 'Back Camera')];
  assert.equal(chooseCamera(devices, 'ultra'), 'main');
  const ranked = rankCameras(devices, 'ultra');
  assert.equal(ranked[0].deviceId, 'main');
  assert.equal(ranked.at(-1).deviceId, 'front');
  assert.deepEqual(Object.keys(ranked[0]).sort(), ['deviceId', 'label', 'score']);
});

test('Portuguese labels and accents identify the main rear camera', () => {
  const devices = [camera('ultra', 'Câmera traseira ultragrande angular'), camera('front', 'Câmera frontal'),
    camera('triple', 'Câmera traseira tripla'), camera('main', 'Câmera traseira')];
  assert.equal(chooseCamera(devices, 'triple'), 'main');
  assert.equal(chooseCamera([camera('ultra', 'Back Ultra-Wide Camera'), camera('wide', 'Back Wide Camera')]), 'wide');
});

test('hidden labels keep the active video input and ignore audio devices', () => {
  const devices = [camera('first'), { kind: 'audioinput', deviceId: 'mic', label: 'Back Camera' }, camera('active')];
  assert.equal(chooseCamera(devices, 'active'), 'active');
  assert.equal(rankCameras(devices).length, 2);
  assert.equal(chooseCamera(devices), 'first');
  assert.equal(chooseCamera([]), '');
  assert.equal(chooseCamera([], 'active'), 'active');
});

test('camera ties favor the active input without mutating the input list', () => {
  const devices = [camera('first', 'Back Camera'), camera('active', 'Back Camera')];
  assert.equal(chooseCamera(devices, 'active'), 'active');
  assert.equal(devices[0].deviceId, 'first');
});

test('initial zoom preserves the current physical or virtual camera setting', () => {
  const range = { min: .5, max: 10 };
  assert.equal(safeInitialZoom(range, 3.1), 3.1);
  assert.equal(safeInitialZoom(range, 1), 1);
  assert.equal(safeInitialZoom(range), 1);
  assert.equal(safeInitialZoom(range, NaN), 1);
  assert.equal(safeInitialZoom(range, -1), 1);
  assert.equal(safeInitialZoom(range, 20), 10);
  assert.equal(safeInitialZoom({ min: 2, max: 10 }), 2);
  assert.equal(safeInitialZoom({ min: 1, max: 10 }, .5), 1);
  assert.equal(safeInitialZoom(undefined, 3.1), 1);
});

test('UI zoom usually stops at 4× but includes valid current zoom and hardware limits', () => {
  assert.equal(maxUiZoom({ min: .5, max: 10 }), 4);
  assert.equal(maxUiZoom({ zoom: { min: 1, max: 10 } }, 3.1), 4);
  assert.equal(maxUiZoom({ min: 1, max: 10 }, 6), 6);
  assert.equal(maxUiZoom({ min: 5, max: 10 }), 5);
  assert.equal(maxUiZoom({ min: 1, max: 2 }), 2);
  assert.equal(maxUiZoom({ min: 1, max: 10 }, 20), 10);
  assert.equal(maxUiZoom(undefined), 1);
});

test('portrait video focus coordinates exclude side letterboxing', () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 };
  assert.deepEqual(getFocusPoint(210, 170, rect, 1080, 1920), { x: .5, y: .5 });
  assert.equal(getFocusPoint(30, 170, rect, 1080, 1920), null);
  assert.equal(getFocusPoint(410, 170, rect, 1080, 1920), null);
  assert.deepEqual(getFocusPoint(125.625, 20, rect, 1080, 1920), { x: 0, y: 0 });
});

test('landscape video in a tall view excludes top and bottom letterboxing', () => {
  const rect = { left: 0, top: 0, width: 300, height: 600 };
  assert.deepEqual(getFocusPoint(150, 300, rect, 1920, 1080), { x: .5, y: .5 });
  assert.equal(getFocusPoint(150, 100, rect, 1920, 1080), null);
  assert.equal(getFocusPoint(150, 500, rect, 1920, 1080), null);
});

test('focus mapping ignores invalid dimensions and coordinates', () => {
  const rect = { left: 0, top: 0, width: 300, height: 600 };
  assert.equal(getFocusPoint(150, 300, rect, 0, 1080), null);
  assert.equal(getFocusPoint(NaN, 300, rect, 1920, 1080), null);
  assert.equal(getFocusPoint(150, 300, null, 1920, 1080), null);
});
