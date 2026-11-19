import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClippingOptions,clippingPlaneForBounds} from './static/js/clipping-logic.mjs';

const distance=(point,plane)=>['x','y','z'].reduce((sum,axis)=>sum+point[axis]*plane.normal[axis],plane.constant);

test('clipping starts disabled, with a centered X plane and bounded controls',()=>{
  assert.deepEqual(normalizeClippingOptions(),{enabled:false,axis:'x',position:.5,inverted:false});
  assert.equal(normalizeClippingOptions({position:-10}).position,0);
  assert.equal(normalizeClippingOptions({position:4}).position,1);
  for(const input of [null,[],{axis:'bad',position:NaN,enabled:'true',inverted:1}]){
    assert.deepEqual(normalizeClippingOptions(input),{enabled:false,axis:'x',position:.5,inverted:false});
  }
});

test('an offset model is clipped against its world bounds, and inversion keeps the opposite half',()=>{
  const bounds={min:{x:10,y:-4,z:1},max:{x:30,y:2,z:5}};
  const normal=clippingPlaneForBounds(bounds,{enabled:true,axis:'x',position:.25});
  const inverse=clippingPlaneForBounds(bounds,{enabled:true,axis:'x',position:.25,inverted:true});
  assert.equal(normal.coordinate,15);assert.equal(normal.constant,-15);
  assert.ok(distance({x:12,y:0,z:2},normal)<0);assert.ok(distance({x:20,y:0,z:2},normal)>0);
  for(const x of [12,15,20]){
    assert.ok(Math.abs(distance({x,y:0,z:2},normal)+distance({x,y:0,z:2},inverse))<1e-12);
  }
});

test('plane axes and endpoints follow changed model proportions without changing input data',()=>{
  const bounds={min:{x:-2,y:-4,z:1},max:{x:2,y:2,z:5}},before=JSON.stringify(bounds);
  for(const axis of ['x','y','z']){
    const minimum=clippingPlaneForBounds(bounds,{axis,position:0});
    const maximum=clippingPlaneForBounds(bounds,{axis,position:1});
    assert.equal(minimum.coordinate,bounds.min[axis]);assert.equal(maximum.coordinate,bounds.max[axis]);
    assert.equal(Math.hypot(...Object.values(minimum.normal)),1);
  }
  assert.equal(clippingPlaneForBounds(bounds,{axis:'y',position:.75}).coordinate,.5);
  assert.equal(JSON.stringify(bounds),before);
});

test('empty or reversed bounds produce a finite plane instead of invalid GPU uniforms',()=>{
  for(const bounds of [null,{}, {min:{x:Infinity},max:{x:-Infinity}}, {min:{x:-1e308},max:{x:1e308}}, {min:{x:3,y:3,z:3},max:{x:-3,y:-3,z:-3}}]){
    const plane=clippingPlaneForBounds(bounds,{enabled:true,position:.5});
    assert.ok([plane.coordinate,plane.constant,plane.helperSize,...Object.values(plane.normal)].every(Number.isFinite));
    assert.ok(plane.helperSize>0);
  }
});
