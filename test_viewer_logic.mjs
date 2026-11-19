import {test} from 'node:test';
import assert from 'node:assert/strict';
import {faceForDirection, cutoutPlaneSize, normalizeShapeOptions, fitModelCamera} from './static/js/viewer-logic.mjs';

test('orbit directions choose the corresponding captured face', () => {
  for (const [face, direction] of [
    ['front', {z: 5}], ['right', {x: 5}], ['back', {z: -5}],
    ['left', {x: -5}], ['top', {y: 5}], ['bottom', {y: -5}],
  ]) assert.equal(faceForDirection(direction), face);
});

test('normalization makes face selection independent from zoom distance', () => {
  assert.equal(faceForDirection({x: 4.5, y: 2.8, z: 6.8}), 'front');
  assert.equal(faceForDirection({x: 45, y: 28, z: 68}), 'front');
});

test('a small angular dead band prevents flicker between adjacent photos', () => {
  assert.equal(faceForDirection({x: 1.03, z: 1}, 'front'), 'front');
  assert.equal(faceForDirection({x: 1.4, z: 1}, 'front'), 'right');
  assert.equal(faceForDirection({y: 1.03, z: 1}, 'front'), 'front');
  assert.equal(faceForDirection({y: 1.4, z: 1}, 'front'), 'top');
});

test('bad or zero directions preserve a usable photograph', () => {
  assert.equal(faceForDirection({}, 'back'), 'back');
  assert.equal(faceForDirection({x: NaN}, 'left'), 'left');
  assert.equal(faceForDirection({}), 'front');
});

test('portrait and landscape cutouts retain their original proportions', () => {
  const portrait = cutoutPlaneSize(100, 200);
  assert.equal(portrait.height, 2.9); assert.equal(portrait.width, 1.45);
  const landscape = cutoutPlaneSize(200, 100);
  assert.equal(landscape.width, 2.9); assert.equal(landscape.height, 1.45);
  assert.deepEqual(cutoutPlaneSize(0, 0), {width: 2.9, height: 2.9});
});

test('shape options accept known forms and bound live proportion controls', () => {
  const input = Object.freeze({form:'round', widthScale:10, depthScale:-3});
  assert.deepEqual(normalizeShapeOptions(input), {form:'round',widthScale:1.75,depthScale:.25});
  assert.deepEqual(normalizeShapeOptions({form:'box',widthScale:.2,depthScale:5}), {form:'box',widthScale:.5,depthScale:2.5});
  assert.equal(input.widthScale,10);
  for(const form of ['cylinder','ellipsoid'])assert.deepEqual(normalizeShapeOptions({form,widthScale:1.2,depthScale:.8}),{form,widthScale:1.2,depthScale:.8});
});

test('invalid shape data cannot introduce NaN or Infinity into a mesh transform', () => {
  for (const input of [undefined,null,{}, {form:'unknown',widthScale:NaN,depthScale:Infinity}, {widthScale:'1.2',depthScale:false}]) {
    assert.deepEqual(normalizeShapeOptions(input), {form:'auto',widthScale:1,depthScale:1});
  }
});

test('a bounding sphere fits both FOVs for portrait and landscape at every orbit angle', () => {
  for (const aspect of [.5,1,2]) {
    for (const dimensions of [
      {width:2.9,height:2.9,depth:2.9}, {width:.5,height:2.9,depth:.4},
      {width:7,height:.4,depth:2}, {width:2,height:1,depth:6},
    ]) {
      const camera = fitModelCamera(dimensions,aspect);
      const vertical = 36*Math.PI/360;
      const horizontal = Math.atan(Math.tan(vertical)*aspect);
      const angularRadius = Math.asin(camera.radius/camera.distance);
      assert.ok(angularRadius<vertical && angularRadius<horizontal, JSON.stringify({aspect,dimensions}));
      assert.ok(Math.abs(Math.hypot(...Object.values(camera.position))-camera.distance)<1e-10);
      assert.ok(camera.minDistance>camera.radius);
      assert.ok(camera.maxDistance>camera.distance);
    }
  }
});

test('portrait framing pulls back when horizontal space is the limiting field', () => {
  const size={width:1.8,height:2.9,depth:1.2};
  const portrait=fitModelCamera(size,.5), landscape=fitModelCamera(size,2);
  assert.ok(portrait.distance>landscape.distance);
  assert.ok(portrait.minDistance<3.7);
  assert.deepEqual(fitModelCamera(size,1,{direction:{x:0,y:0,z:1}}).position,{x:0,y:0,z:fitModelCamera(size,1).distance});
});

test('camera fitting returns safe finite values for malformed dimensions and options', () => {
  for (const fit of [
    fitModelCamera(null,0),
    fitModelCamera({width:NaN,height:-3,depth:Infinity},NaN,{fov:Infinity,padding:NaN,direction:{x:0,y:0,z:0}}),
    fitModelCamera({width:1e308,height:.00001,depth:2},1e308,{fov:180,padding:.1,direction:{x:Infinity}}),
  ]) {
    for(const value of [fit.radius,fit.distance,fit.minDistance,fit.maxDistance,...Object.values(fit.position)])assert.ok(Number.isFinite(value));
    assert.ok(fit.distance>fit.minDistance);
    assert.ok(fit.minDistance>fit.radius);
  }
});

test('bounds framing shows a tall product larger while keeping all corners inside the starting view', () => {
  const dimensions={width:1.3,height:2.9,depth:1.2};
  for(const aspect of [.55,.8,1.8]){
    const options={padding:1.13,direction:{x:3.1,y:1.8,z:7.8}};
    const fit=fitModelCamera(dimensions,aspect,{...options,framing:'bounds'});
    const sphere=fitModelCamera(dimensions,aspect,options);
    assert.ok(fit.distance<sphere.distance);
    if(aspect<1)assert.ok(fit.distance<sphere.distance*.8);
    const d=[fit.position.x/fit.distance,fit.position.y/fit.distance,fit.position.z/fit.distance];
    const length=Math.hypot(d[0],d[2]),r=[d[2]/length,0,-d[0]/length];
    const u=[d[1]*r[2],d[2]*r[0]-d[0]*r[2],-d[1]*r[0]];
    for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
      const p=[sx*dimensions.width/2,sy*dimensions.height/2,sz*dimensions.depth/2];
      const dot=axis=>p.reduce((sum,v,i)=>sum+v*axis[i],0),depth=fit.distance-dot(d);
      assert.ok(Math.abs(dot(u))/depth<Math.tan(Math.PI/10));
      assert.ok(Math.abs(dot(r))/depth<Math.tan(Math.PI/10)*aspect);
    }
    assert.ok(fit.minDistance>fit.radius);
  }
});

test('bounds framing handles polar views and extreme proportions without clipping corners',()=>{
  for(const direction of [{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:1,y:0,z:0}]){
    const fit=fitModelCamera({width:7,height:.3,depth:2},.6,{framing:'bounds',direction});
    assert.ok(Number.isFinite(fit.distance));assert.ok(fit.distance>fit.minDistance);
    assert.ok(Math.abs(Math.hypot(...Object.values(fit.position))-fit.distance)<1e-10);
  }
});
