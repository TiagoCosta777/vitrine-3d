import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canvasBlob, fetchWithTimeout, fileToFrame} from './static/js/capture-runtime.mjs';

function replaceGlobals(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, {configurable:true, writable:true, value});
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
}

test('fetch works without AbortSignal.timeout, copies options and clears external listeners', async t => {
  const external = new AbortController();
  let attached = 0, removed = 0, received;
  const add = external.signal.addEventListener.bind(external.signal);
  const remove = external.signal.removeEventListener.bind(external.signal);
  external.signal.addEventListener = (...args) => { attached++; return add(...args); };
  external.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  replaceGlobals(t, {AbortSignal:undefined,fetch:async (url, options) => { received = {url, options}; return {ok:true}; }});
  const options = {method:'POST', signal:external.signal};
  const response = await fetchWithTimeout('/upload', options, 50);
  assert.equal(response.ok, true);
  assert.equal(received.url, '/upload');
  assert.equal(received.options.method, 'POST');
  assert.notEqual(received.options.signal, external.signal);
  assert.equal(options.signal, external.signal);
  assert.equal(attached, 1); assert.equal(removed, 1);
});

test('fetch timeout settles even if a fetch implementation never honors abort', async t => {
  let signal;
  replaceGlobals(t, {fetch:(_url, options) => { signal = options.signal; return new Promise(() => {}); }});
  await assert.rejects(fetchWithTimeout('/slow', {}, 5), error => error.name === 'TimeoutError');
  assert.equal(signal.aborted, true);
});

test('external cancellation aborts a pending request and already-canceled work is not sent', async t => {
  let requests = 0, signal;
  replaceGlobals(t, {fetch:(_url, options) => { requests++; signal = options.signal; return new Promise(() => {}); }});
  const controller = new AbortController();
  const work = fetchWithTimeout('/upload', {signal:controller.signal}, 100);
  await Promise.resolve();controller.abort();
  await assert.rejects(work, error => error.name === 'AbortError');
  assert.equal(signal.aborted, true);
  await assert.rejects(fetchWithTimeout('/again', {signal:controller.signal}), error => error.name === 'AbortError');
  assert.equal(requests, 1);
});

test('network errors propagate without leaving external cancellation attached', async t => {
  const expected = new Error('offline');
  replaceGlobals(t, {fetch:async()=>{throw expected;}});
  await assert.rejects(fetchWithTimeout('/offline', {}, 20), error => error === expected);
});

test('canvas encoding returns a Blob and forwards requested quality', async () => {
  const expected = new Blob(['image'], {type:'image/jpeg'});let args;
  const actual = await canvasBlob({toBlob(callback, type, quality){args={type,quality};callback(expected);}}, 'image/jpeg', .82);
  assert.equal(actual, expected);assert.deepEqual(args,{type:'image/jpeg',quality:.82});
});

test('empty and thrown canvas results reject immediately', async () => {
  await assert.rejects(canvasBlob({toBlob(callback){callback(null);}}), /foto válida/);
  await assert.rejects(canvasBlob({toBlob(callback){callback(new Blob([]));}}), /foto válida/);
  const expected = new Error('canvas failed');
  await assert.rejects(canvasBlob({toBlob(){throw expected;}}), error => error === expected);
});

test('a stalled canvas callback times out and a late callback cannot change its outcome', async () => {
  let callback;
  await assert.rejects(canvasBlob({toBlob(fn){callback=fn;}}, 'image/jpeg', .9, {timeoutMs:5}), error=>error.name==='TimeoutError');
  assert.doesNotThrow(()=>callback(new Blob(['late'])));
});

function installImageEnvironment(t, {width=2000,height=1000,load='success',drawError=null,context=true,blob=null}={}) {
  const revoked=[],draws=[],images=[];
  class FakeImage {
    constructor(){this.naturalWidth=width;this.naturalHeight=height;images.push(this);}
    set src(value){this.currentSrc=value;if(!value)return;queueMicrotask(()=>{if(load==='success')this.onload?.();else if(load==='error')this.onerror?.();});}
    get src(){return this.currentSrc;}
  }
  const canvas={width:0,height:0,getContext(){return context?{drawImage(...args){if(drawError)throw drawError;draws.push(args);}}:null;},toBlob(fn){fn(blob||new Blob(['pixels'],{type:'image/jpeg'}));}};
  replaceGlobals(t,{Image:FakeImage,URL:{createObjectURL(){return 'blob:input';},revokeObjectURL(url){revoked.push(url);}},document:{createElement(tag){assert.equal(tag,'canvas');return canvas;}}});
  return {revoked,draws,images,canvas};
}

test('native photo preparation preserves aspect ratio, bounds resolution and revokes its source URL', async t => {
  const env=installImageEnvironment(t);
  const result=await fileToFrame(new Blob(['photo']),{maxSide:1400});
  assert.equal(result.width,1400);assert.equal(result.height,700);assert.ok(result.blob instanceof Blob);
  assert.deepEqual(env.revoked,['blob:input']);assert.equal(env.images[0].src,'');
  assert.deepEqual(env.draws[0].slice(1),[0,0,1400,700]);assert.equal('previewUrl' in result,false);
});

test('portrait native photos use browser-oriented dimensions without enlarging small images', async t => {
  const env=installImageEnvironment(t,{width:300,height:600});
  const result=await fileToFrame(new Blob(['photo']),{maxSide:1400});
  assert.equal(result.width,300);assert.equal(result.height,600);assert.deepEqual(env.revoked,['blob:input']);
});

test('image loading errors and timeouts revoke the source URL', async t => {
  const env=installImageEnvironment(t,{load:'error'});
  await assert.rejects(fileToFrame(new Blob(['photo'])),/abrir esta foto/);
  assert.deepEqual(env.revoked,['blob:input']);
});

test('stalled image decoders have a bounded wait and release their source', async t => {
  const env=installImageEnvironment(t,{load:'never'});
  await assert.rejects(fileToFrame(new Blob(['photo']),{timeoutMs:5}),error=>error.name==='TimeoutError');
  assert.deepEqual(env.revoked,['blob:input']);assert.equal(env.images[0].src,'');
});

test('canvas drawing errors still release object URLs', async t => {
  const expected=new Error('drawing failed'),env=installImageEnvironment(t,{drawError:expected});
  await assert.rejects(fileToFrame(new Blob(['photo'])),error=>error===expected);
  assert.deepEqual(env.revoked,['blob:input']);
});

test('invalid decoded dimensions reject and release the source URL', async t => {
  const env=installImageEnvironment(t,{width:0,height:0});
  await assert.rejects(fileToFrame(new Blob(['photo'])),/dimensões válidas/);
  assert.deepEqual(env.revoked,['blob:input']);
});

test('an unavailable canvas context rejects and releases the source URL', async t => {
  const env=installImageEnvironment(t,{context:false});
  await assert.rejects(fileToFrame(new Blob(['photo'])),/preparar a imagem/);
  assert.deepEqual(env.revoked,['blob:input']);
});

test('invalid file input is rejected without creating a source URL', async t => {
  const env=installImageEnvironment(t);
  await assert.rejects(fileToFrame(null),/foto válida/);
  await assert.rejects(fileToFrame(new Blob([])),/foto válida/);
  await assert.rejects(fileToFrame(new Blob(['photo']),{maxSide:0}),/Tamanho/);
  assert.equal(env.revoked.length,0);
});
