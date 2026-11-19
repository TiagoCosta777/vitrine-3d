import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLocalReader} from './static/js/local-reader.mjs';

const vendorRoot = new URL('./static/vendor/zxing-wasm/', import.meta.url);
const workerSource = readFileSync(new URL('./static/js/barcode-worker.js', import.meta.url), 'utf8');

// A deterministic EAN-13 image, independently drawn from its module patterns.
function eanImage(code='7891234567895') {
  const left=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const parity=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  const invert=bits=>bits.replace(/[01]/g,bit=>bit==='0'?'1':'0');
  let modules='101';
  for(let i=1;i<7;i++)modules+=parity[Number(code[0])][i-1]==='L'?left[Number(code[i])]:invert([...left[Number(code[i])]].reverse().join(''));
  modules+='01010';for(let i=7;i<13;i++)modules+=invert(left[Number(code[i])]);modules+='101';
  const width=(modules.length+22)*3,height=120,data=new Uint8ClampedArray(width*height*4);data.fill(255);
  for(let y=10;y<110;y++)for(let x=0;x<modules.length*3;x++)if(modules[Math.floor(x/3)]==='1'){
    const i=(y*width+x+33)*4;data[i]=data[i+1]=data[i+2]=0;
  }
  return {width,height,data};
}
function rotate(image) {
  const data=new Uint8ClampedArray(image.data.length),width=image.height,height=image.width;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const from=(y*image.width+x)*4,to=(x*width+(image.height-y-1))*4;data.set(image.data.subarray(from,from+4),to);
  }
  return {width,height,data};
}
function combine(first,second) {
  const width=Math.max(first.width,second.width),height=first.height+second.height+60,data=new Uint8ClampedArray(width*height*4);data.fill(255);
  for(const [image,offset] of [[first,0],[second,first.height+60]])for(let y=0;y<image.height;y++)data.set(image.data.subarray(y*image.width*4,(y+1)*image.width*4),((offset+y)*width)*4);
  return {width,height,data};
}

async function realWorker() {
  const messages=[];
  let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
  const context=vm.createContext({console,WebAssembly,TextDecoder,TextEncoder,performance,URL,setTimeout,clearTimeout});
  context.self={location:{href:'http://localhost/static/js/barcode-worker.js'},postMessage(message){messages.push(message);if(message.type==='ready'||message.type==='error')readyResolve(message)}};
  context.importScripts=()=>{
    vm.runInContext(readFileSync(new URL('./dist/iife/reader/index.js',vendorRoot),'utf8'),context);
    const prepare=context.ZXingWASM.prepareZXingModule;
    context.ZXingWASM.prepareZXingModule=options=>prepare({...options,overrides:{...options.overrides,wasmBinary:new Uint8Array(readFileSync(new URL('./dist/reader/zxing_reader.wasm',vendorRoot)))}});
  };
  vm.runInContext(workerSource,context);
  assert.equal((await ready).type,'ready','The real bundled WASM must initialize.');
  return {
    context,
    async decode(image){messages.length=0;await context.self.onmessage({data:{type:'decode',id:1,image}});return messages.at(-1);},
  };
}
const actual=await realWorker();
test('local worker decodes actual EAN-13 pixels with the bundled WASM',async()=>{
  const message=await actual.decode(eanImage());
  assert.equal(message.type,'result');assert.equal(message.result.barcode,'7891234567895');assert.equal(message.result.source,'wasm');
});
test('local worker decodes a rotated barcode without canvas or network',async()=>{
  assert.equal((await actual.decode(rotate(eanImage()))).result.barcode,'7891234567895');
});
test('local worker refuses to choose between different barcodes in one frame',async()=>{
  const message=await actual.decode(combine(eanImage(),eanImage('5901234123457')));
  assert.equal(message.result.found,false);assert.equal(message.result.ambiguous,true);
});
test('local worker rejects retail checksum errors and tolerates repeated results of one code',()=>{
  const select=actual.context.selectResult;
  assert.equal(select([{isValid:true,text:'7891234567896',format:'EAN13'}]).found,false);
  assert.equal(select([{isValid:false,text:'7891234567895',format:'EAN13'}]).found,false);
  assert.equal(select([{isValid:true,text:'7891234567895',format:'EAN13'},{isValid:true,text:'7891234567895',format:'EAN13'}]).barcode,'7891234567895');
});

class FakeWorker {
  sent=[];terminated=false;
  postMessage(message,transfer){this.sent.push({message,transfer})}
  terminate(){this.terminated=true}
  emit(data){this.onmessage({data})}
}
test('local reader starts in the background and returns null until ready',async()=>{
  const worker=new FakeWorker(),states=[],reader=createLocalReader({workerFactory:()=>worker,onStatus:state=>states.push(state)});
  assert.equal(reader.available,false);assert.equal(await reader.decode(eanImage()),null);
  worker.emit({type:'ready'});assert.equal(await reader.ready,true);assert.equal(reader.available,true);
  const frame=eanImage(),pending=reader.decode(frame);assert.equal(worker.sent.length,1);assert.equal(worker.sent[0].transfer[0],frame.data.buffer);
  assert.equal(await reader.decode(eanImage()),null,'There must not be a second decode in flight.');
  worker.emit({type:'result',id:worker.sent[0].message.id,result:{found:true,barcode:'7891234567895',format:'EAN13'}});
  assert.equal((await pending).barcode,'7891234567895');reader.dispose();assert.deepEqual(states,['loading','ready','stopped']);
});
test('initialization failure or timeout leaves a usable server fallback',async()=>{
  const absent=createLocalReader({workerFactory:()=>{throw new Error('Workers unavailable')}});
  assert.equal(await absent.ready,false);assert.equal(await absent.decode(eanImage()),null);
  const worker=new FakeWorker(),reader=createLocalReader({workerFactory:()=>worker,initTimeoutMs:5});
  assert.equal(await reader.ready,false);assert.equal(reader.available,false);assert.equal(worker.terminated,true);
});
test('a timed out decode terminates the worker and resolves the frame for fallback',async()=>{
  const worker=new FakeWorker(),reader=createLocalReader({workerFactory:()=>worker,decodeTimeoutMs:5});
  worker.emit({type:'ready'});await reader.ready;
  assert.equal(await reader.decode(eanImage()),null);assert.equal(reader.available,false);assert.equal(worker.terminated,true);
});
test('disposal resolves initialization and any pending work without rejection',async()=>{
  const worker=new FakeWorker(),reader=createLocalReader({workerFactory:()=>worker});
  reader.dispose();assert.equal(await reader.ready,false);
  const worker2=new FakeWorker(),reader2=createLocalReader({workerFactory:()=>worker2});
  worker2.emit({type:'ready'});await reader2.ready;const pending=reader2.decode(eanImage());reader2.dispose();
  assert.equal(await pending,null);assert.equal(reader2.available,false);
});
test('worker errors and malformed frames resolve to fallback rather than freezing camera scanning',async()=>{
  const worker=new FakeWorker(),reader=createLocalReader({workerFactory:()=>worker});
  worker.emit({type:'ready'});await reader.ready;
  assert.equal(await reader.decode({width:0,height:10,data:new Uint8ClampedArray(0)}),null);
  const pending=reader.decode(eanImage());worker.emit({type:'error'});assert.equal(await pending,null);assert.equal(reader.available,false);
});
