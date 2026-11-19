import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildObjectShape} from './static/js/object-shape.mjs';

function image(width, height, foreground, padding = 0) {
  const data = new Uint8ClampedArray((width + 2 * padding) * (height + 2 * padding) * 4);
  const fullWidth = width + 2 * padding, fullHeight = height + 2 * padding;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (foreground(x, y, width, height)) {
    const index = ((y + padding) * fullWidth + x + padding) * 4;
    data[index] = 40; data[index + 1] = 120; data[index + 2] = 80; data[index + 3] = 255;
  }
  return {width:fullWidth, height:fullHeight, data};
}
const solid = (width, height, padding = 0) => image(width, height, () => true, padding);
const circle = (diameter, padding = 0) => image(diameter, diameter, (x, y, w) => (x + .5 - w / 2) ** 2 + (y + .5 - w / 2) ** 2 <= (w / 2) ** 2, padding);
function boxViews({width = 80, height = 200, depth = 40, padding = 0} = {}) {
  return {front:solid(width,height,padding),back:solid(width,height,padding),right:solid(depth,height,padding),left:solid(depth,height,padding),top:solid(width,depth,padding),bottom:solid(width,depth,padding)};
}
function bottleViews(padding = 0) {
  const profile = (x,y,w,h) => {
    const halfWidth = y < h * .3 ? w * .2 : w * .5;
    return Math.abs(x + .5 - w / 2) <= halfWidth;
  };
  return {front:image(80,200,profile,padding),back:image(80,200,profile,padding),right:image(56,200,profile,padding),left:image(56,200,profile,padding),top:circle(70,padding),bottom:circle(70,padding)};
}
function extentAtRow(shape, row, axis) {
  const segments = shape.diagnostics.segments;
  const values = Array.from({length:segments}, (_,segment) => shape.positions[(row * segments + segment) * 3 + axis]);
  return Math.max(...values) - Math.min(...values);
}
function centerAtRow(shape, row, axis) {
  const segments = shape.diagnostics.segments;
  const values = Array.from({length:segments}, (_,segment) => shape.positions[(row * segments + segment) * 3 + axis]);
  return (Math.max(...values) + Math.min(...values)) / 2;
}
function coordinateKey(shape, index) {
  return Array.from(shape.positions.subarray(index * 3,index * 3 + 3)).map(value=>value.toFixed(5)).join(',');
}
function assertClosedOutward(shape) {
  const edges = new Map();
  for (let index = 0; index < shape.indices.length; index += 3) {
    const triangle = Array.from(shape.indices.subarray(index, index + 3));
    assert.ok(triangle.every(vertex => vertex >= 0 && vertex < shape.positions.length / 3));
    const [a,b,c] = triangle.map(vertex => Array.from(shape.positions.subarray(vertex * 3, vertex * 3 + 3)));
    const ab = b.map((value,axis) => value - a[axis]), ac = c.map((value,axis) => value - a[axis]);
    const normal = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
    const centroid = a.map((value,axis) => (value + b[axis] + c[axis]) / 3);
    assert.ok(Math.hypot(...normal) > 1e-10, 'Every triangle has nonzero area');
    assert.ok(normal.reduce((dot,value,axis) => dot + value * centroid[axis],0) > 0, 'Convex primitive faces point outward');
    for (let side = 0; side < 3; side++) {
      const from = coordinateKey(shape,triangle[side]), to = coordinateKey(shape,triangle[(side+1)%3]);
      const key = [from,to].sort().join('|'), edge = edges.get(key) || {count:0,balance:0};
      edge.count++; edge.balance += from < to ? 1 : -1; edges.set(key,edge);
    }
  }
  for (const edge of edges.values()) { assert.equal(edge.count,2); assert.equal(edge.balance,0); }
}

test('side silhouettes determine actual mesh depth rather than a fixed cardboard thickness',()=>{
  const shallow=buildObjectShape(boxViews({depth:30})),deep=buildObjectShape(boxViews({depth:90}));
  assert.ok(Math.abs(shallow.dimensions.width / shallow.dimensions.height - .4) < 1e-6);
  assert.ok(Math.abs(shallow.dimensions.depth / shallow.dimensions.height - .15) < 1e-6);
  assert.ok(deep.dimensions.depth > shallow.dimensions.depth * 2.9);
  assert.ok(extentAtRow(deep,30,2) > extentAtRow(shallow,30,2) * 2.9);
});
test('bottle contour produces a narrow neck and a wider body in a closed 3D volume',()=>{
  const shape=buildObjectShape(bottleViews());
  assert.equal(shape.form,'round');assert.equal(shape.exponent,2);
  assert.ok(extentAtRow(shape,8,0)<extentAtRow(shape,45,0)*.5);
  assert.ok(extentAtRow(shape,8,2)<extentAtRow(shape,45,2)*.5);
  assert.equal(shape.positions.length/3,shape.diagnostics.vertexCount);
  assert.equal(shape.indices.length/3,shape.diagnostics.triangleCount);
});
test('transparent padding does not change object proportions or shape',()=>{
  const plain=buildObjectShape(bottleViews(0)),padded=buildObjectShape(bottleViews(35));
  assert.deepEqual(plain.dimensions,padded.dimensions);
  assert.deepEqual(plain.positions,padded.positions);
  assert.equal(padded.bounds.front.x,35);assert.equal(padded.bounds.front.y,35);
  assert.equal(padded.bounds.front.width,80);assert.equal(padded.bounds.front.height,200);
  const uv=padded.bounds.front.uv;
  assert.ok(Math.abs(uv[0]-35/150)<1e-8);assert.ok(Math.abs(uv[1]-(1-235/270))<1e-8);
});
test('top silhouette distinguishes round and box sections, with explicit overrides',()=>{
  const box=buildObjectShape(boxViews()),round=buildObjectShape(bottleViews());
  assert.equal(box.form,'box');assert.equal(box.exponent,8);assert.equal(round.form,'round');
  assert.equal(buildObjectShape(boxViews(),{form:'round'}).exponent,2);
  assert.equal(buildObjectShape(bottleViews(),{form:'box'}).exponent,8);
  // A rounded box fills its diagonal more than an ellipse with the same widths.
  assert.ok(box.positions[8*3]>buildObjectShape(boxViews(),{form:'round'}).positions[8*3]);
});
test('a sustained neck in three views prevents contaminated rectangular top masks from boxing a bottle',()=>{
  const views=bottleViews();views.top=solid(70,70);views.bottom=solid(70,70);
  const shape=buildObjectShape(views);
  assert.equal(shape.diagnostics.topFillRatio,1);assert.equal(shape.diagnostics.neckViews,4);
  assert.equal(shape.form,'round');assert.equal(buildObjectShape(views,{form:'box'}).form,'box');
  const straight=buildObjectShape(boxViews());assert.equal(straight.diagnostics.neckViews,0);assert.equal(straight.form,'box');
});
test('short contour spikes do not become protruding rings or center kinks in the volume',()=>{
  const body=(x,y)=>x>=20&&x<80;
  const views={front:image(100,320,(x,y)=>x>=20&&x<(y>=154&&y<162?92:80)),
    back:image(100,320,(x,y)=>x>=(y>=154&&y<162?8:20)&&x<80),
    right:image(100,320,body),left:image(100,320,body),top:circle(60),bottom:circle(60)};
  const shape=buildObjectShape(views),row=Math.round(158/319*(shape.diagnostics.rows-1));
  const reference=extentAtRow(shape,row-8,0),referenceCenter=centerAtRow(shape,row-8,0);
  for(let offset=-3;offset<=3;offset++){
    assert.ok(Math.abs(extentAtRow(shape,row+offset,0)-reference)<reference*.025);
    assert.ok(Math.abs(centerAtRow(shape,row+offset,0)-referenceCenter)<reference*.015);
  }
});
test('profile refinement retains a narrow neck, a shoulder ledge and straight box walls',()=>{
  const outline=(x,y,w,h)=>Math.abs(x+.5-w/2)<(y<h*.24?w*.2:y<h*.43?w*.35:w*.5);
  const views={front:image(120,320,outline),back:image(120,320,outline),right:image(80,320,outline),left:image(80,320,outline),top:circle(80),bottom:circle(80)};
  const shape=buildObjectShape(views),last=shape.diagnostics.rows-1;
  const neck=extentAtRow(shape,Math.round(last*.12),0),shoulder=extentAtRow(shape,Math.round(last*.33),0),body=extentAtRow(shape,Math.round(last*.7),0);
  assert.ok(Math.abs(neck/body-.4)<.02);assert.ok(Math.abs(shoulder/body-.7)<.02);
  const box=buildObjectShape(boxViews());
  for(let row=0;row<box.diagnostics.rows;row++)assert.ok(Math.abs(extentAtRow(box,row,0)-box.dimensions.width)<1e-6);
});
test('top image orientation never changes the inferred side dimensions',()=>{
  const first=boxViews();const rotated={...first,top:solid(40,80),bottom:solid(40,80)};
  assert.deepEqual(buildObjectShape(first).dimensions,buildObjectShape(rotated).dimensions);
});

test('cylinder override regularizes a necked silhouette into a constant elliptical section with flat ends',()=>{
  const views=bottleViews(),profile=buildObjectShape(views),shape=buildObjectShape(views,{form:'cylinder'});
  assert.equal(shape.form,'cylinder');assert.equal(shape.diagnostics.method,'parametric-cylinder');
  assert.deepEqual(shape.dimensions,profile.dimensions);
  for(let row=0;row<shape.diagnostics.rings;row++){
    assert.ok(Math.abs(extentAtRow(shape,row,0)-shape.dimensions.width)<1e-6);
    assert.ok(Math.abs(extentAtRow(shape,row,2)-shape.dimensions.depth)<1e-6);
    assert.ok(Math.abs(centerAtRow(shape,row,0))<1e-7);assert.ok(Math.abs(centerAtRow(shape,row,2))<1e-7);
  }
  const ringVertices=shape.diagnostics.rings*shape.diagnostics.segments;
  for(let vertex=0;vertex<ringVertices;vertex++){
    const x=shape.positions[vertex*3]/(shape.dimensions.width/2),z=shape.positions[vertex*3+2]/(shape.dimensions.depth/2);
    assert.ok(Math.abs(x*x+z*z-1)<1e-6);
  }
  assert.ok(Math.abs(shape.positions[1]-shape.dimensions.height/2)<1e-6);
});

test('ellipsoid override has curved sides and unique poles on the fitted analytic surface',()=>{
  const views=boxViews({width:110,height:180,depth:75}),before=new Uint8ClampedArray(views.front.data);
  const shape=buildObjectShape(views,{form:'ellipsoid'}),[rx,ry,rz]=[shape.dimensions.width/2,shape.dimensions.height/2,shape.dimensions.depth/2];
  assert.equal(shape.form,'ellipsoid');assert.equal(shape.diagnostics.method,'parametric-ellipsoid');
  for(let vertex=0;vertex<shape.positions.length/3;vertex++){
    const x=shape.positions[vertex*3]/rx,y=shape.positions[vertex*3+1]/ry,z=shape.positions[vertex*3+2]/rz;
    assert.ok(Math.abs(x*x+y*y+z*z-1)<1e-6);
  }
  const poles=[];
  for(let vertex=0;vertex<shape.positions.length/3;vertex++)if(Math.abs(Math.abs(shape.positions[vertex*3+1])-ry)<1e-6)poles.push(vertex);
  assert.equal(poles.length,2);
  assert.ok(extentAtRow(shape,0,0)<shape.dimensions.width*.05);
  assert.ok(extentAtRow(shape,39,0)>shape.dimensions.width*.999);
  assert.deepEqual(views.front.data,before);
});

test('new round primitives remain finite closed outward manifolds at coarse and dense mobile resolutions',()=>{
  for(const form of ['cylinder','ellipsoid'])for(const resolution of [{rows:8,segments:12},{rows:80,segments:80},{rows:10000,segments:10000}]){
    const shape=buildObjectShape(boxViews(),{form,...resolution});
    assert.ok([...shape.positions].every(Number.isFinite));
    assert.ok(shape.diagnostics.vertexCount<10000);assert.ok(shape.diagnostics.triangleCount<20000);
    assert.equal(shape.diagnostics.approximate,true);assertClosedOutward(shape);
  }
});
test('indices, winding and cap geometry form a finite closed manifold after welding cap rims',()=>{
  const shape=buildObjectShape(bottleViews()),edges=new Map();
  assert.ok([...shape.positions].every(Number.isFinite));
  for(let i=0;i<shape.indices.length;i+=3){
    const triangle=Array.from(shape.indices.subarray(i,i+3));
    assert.ok(triangle.every(index=>index>=0&&index<shape.positions.length/3));
    const [a,b,c]=triangle.map(index=>Array.from(shape.positions.subarray(index*3,index*3+3)));
    const ab=b.map((value,j)=>value-a[j]),ac=c.map((value,j)=>value-a[j]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    assert.ok(Math.hypot(...cross)>1e-10);
    for(let side=0;side<3;side++){
      const from=coordinateKey(shape,triangle[side]),to=coordinateKey(shape,triangle[(side+1)%3]);
      const key=[from,to].sort().join('|');const entry=edges.get(key)||{count:0,balance:0};
      entry.count++;entry.balance+=from<to?1:-1;edges.set(key,entry);
    }
  }
  for(const edge of edges.values()){assert.equal(edge.count,2);assert.equal(edge.balance,0)}
});
test('mesh resolution stays within mobile-friendly limits and source buffers are not mutated',()=>{
  const views=bottleViews(),before=new Uint8ClampedArray(views.front.data);
  const shape=buildObjectShape(views,{rows:10000,segments:10000});
  assert.ok(shape.diagnostics.vertexCount<10000);assert.ok(shape.diagnostics.triangleCount<20000);
  assert.deepEqual(views.front.data,before);assert.equal(shape.diagnostics.approximate,true);
  const normal=buildObjectShape(views);assert.equal(normal.diagnostics.rows,80);assert.equal(normal.diagnostics.segments,80);
  assert.equal(normal.diagnostics.vertexCount,6562);assert.equal(normal.diagnostics.triangleCount,12800);
});
test('missing and empty silhouettes fail instead of inventing a mesh',()=>{
  assert.throws(()=>buildObjectShape({}),/vista/);
  const views=boxViews();views.front=image(20,20,()=>false);
  assert.throws(()=>buildObjectShape(views),/vazio/);
  assert.throws(()=>buildObjectShape(boxViews(),{form:'unknown'}),/inválido/);
});
