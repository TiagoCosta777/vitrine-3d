import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chooseCamera,rankCameras,safeInitialZoom,maxUiZoom} from './static/js/camera-logic.mjs';

const source=readFileSync(new URL('./static/js/app.js',import.meta.url),'utf8');
const opening=source.slice(source.indexOf('async function startCamera('),source.indexOf('function stopCamera('));
function cameraHarness({acquire,enumerate=async()=>[],apply=async()=>{},caps={}}={}){
  let stopped=0;
  const track={getSettings:()=>({deviceId:'previous',zoom:1}),getCapabilities:()=>caps,applyConstraints:apply,stop(){stopped++}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const nodes={};
  const $=id=>nodes[id]??=( {hidden:true,disabled:true,options:[],replaceChildren(){this.options=[]},append(option){this.options.push(option)}} );
  const classes=new Set();
  const context=vm.createContext({chooseCamera,rankCameras,safeInitialZoom,maxUiZoom,$,
    navigator:{mediaDevices:{getUserMedia:acquire||(async()=>stream),enumerateDevices:enumerate}},
    createLocalReader:()=>({dispose(){}}),
    document:{createElement:()=>({})},
  });
  context.wrap={classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}};
  vm.runInContext(`
    var stream=null,cameraPending=false,cameraSession=0,localReader=null;
    var startBtn=$('startBtn'),stopBtn=$('stopBtn'),torchBtn=$('torchBtn');
    var video={srcObject:null,play:async()=>{}},scanning=false,misses=0,barcodePrevious=null,lastServerSent=0,torchOn=false;
    var consensus={reset(){}},workflow={reading:true},spoken=false,statuses=[];
    function setStatus(text){statuses.push(text)};function speak(){};function coach(){};function fitGuide(){};function renderWorkflow(){};
    async function prepareNativeDecoder(){};
    ${opening}
  `,context);
  return {context,nodes,stream,stopped:()=>stopped};
}

test('a failed explicit camera choice reopens the previously working device',async()=>{
  const attempts=[];let stream;
  const harness=cameraHarness({acquire:async constraints=>{
    const device=constraints.video.deviceId?.exact||'';attempts.push(device);
    if(device==='unavailable')throw new Error('NotReadableError');return stream;
  }});stream=harness.stream;
  await harness.context.startCamera('unavailable','previous');
  assert.deepEqual(attempts,['unavailable','previous']);assert.equal(harness.context.scanning,true);
  assert.equal(harness.context.stream,stream);
});

test('stopping during device enumeration does not reopen a preferred camera',async()=>{
  let release,enumerating=false,requests=0;
  const harness=cameraHarness({enumerate:()=>{enumerating=true;return new Promise(resolve=>{release=resolve})}});
  harness.context.navigator.mediaDevices.getUserMedia=async()=>{requests++;return harness.stream};
  const opening=harness.context.startCamera();
  for(let i=0;i<10&&!enumerating;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(enumerating,true);harness.context.cameraSession++;harness.stream.getTracks().forEach(track=>track.stop());
  release([{kind:'videoinput',deviceId:'main',label:'Back Camera'}]);await opening;
  assert.equal(requests,1);assert.equal(harness.context.scanning,false);assert.equal(harness.stopped(),1);
});

test('stopping during focus configuration cannot show controls from an ended session',async()=>{
  let release,applying=false;
  const harness=cameraHarness({caps:{focusMode:['continuous']},apply:()=>{applying=true;return new Promise(resolve=>{release=resolve})}});
  const opening=harness.context.startCamera();
  for(let i=0;i<10&&!applying;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(applying,true);harness.context.cameraSession++;release();await opening;
  assert.equal(harness.context.scanning,false);assert.equal(harness.nodes.cameraTools?.hidden??true,true);
  assert.equal(harness.nodes.readNow?.disabled??true,true);
});
