import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {CaptureWorkflow,ObjectStability,BarcodeConsensus,validRetailBarcode,barcodeRegion,measureFrame,frameProblem,barcodeHint,objectReadiness} from './static/js/scan-logic.mjs';
import {canvasBlob} from './static/js/capture-runtime.mjs';
import {filterAndSortScans} from './static/js/library-logic.mjs';

const source=readFileSync(new URL('./static/js/app.js',import.meta.url),'utf8');
test('object capture starts directly without identifying a barcode',()=>{
  const flow=new CaptureWorkflow();assert.equal(flow.phase,'ready');assert.equal(flow.canStart,true);
  assert.equal(flow.prepare(),true);assert.equal(flow.start(),true);assert.equal(flow.save(),true);assert.equal(flow.complete(),true);
  assert.equal(flow.phase,'done');assert.equal(flow.prepare(),false);const revision=flow.revision;flow.reset();assert.ok(flow.revision>revision);assert.equal(flow.canStart,true);
});
test('cancellation permits retaking photos while upload failure retains a retry phase',()=>{
  const flow=new CaptureWorkflow();flow.prepare();flow.start();assert.equal(flow.cancel(),true);assert.equal(flow.canStart,true);
  flow.prepare();flow.start();flow.save();assert.equal(flow.cancel(),false);flow.fail();assert.equal(flow.phase,'retry');assert.equal(flow.save(),true);flow.complete();
  assert.equal(flow.phase,'done');assert.equal(flow.cancel(),false);
});
test('the object-only application never starts barcode processing',()=>{
  assert.doesNotMatch(source,/createLocalReader|BarcodeDetector|\/api\/scan-frame|confirm-barcode/);
  const template=readFileSync(new URL('./templates/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(template,/id="barcodePhoto"|id="manualCode"|id="registerForm"/);
  assert.match(template,/id="objectStart" class="primary wide"/);assert.match(template,/Objeto sem fundo/);
});
test('legacy barcode utility keeps checksum and independent-frame safeguards',()=>{
  const votes=new BarcodeConsensus(),code='7898446731458';assert.equal(validRetailBarcode(code,'EAN13'),true);
  assert.equal(votes.observe(code,0,{format:'EAN13',frameId:'a'}).confirmed,false);
  assert.equal(votes.observe(code,100,{format:'EAN13',frameId:'a'}).hits,1);
  assert.equal(votes.observe(code,200,{format:'EAN13',frameId:'b'}).confirmed,true);
  assert.equal(validRetailBarcode('7898446731459','EAN13'),false);
});
function pixels({width=128,height=128,base=80,pattern=true}={}){
  const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++){const v=base+(pattern&&i%2?80:0);data[i*4]=data[i*4+1]=data[i*4+2]=v;data[i*4+3]=255}return data;
}
test('stability measurement tolerates exposure adjustments but detects movement',()=>{
  const first=measureFrame(pixels(),128);assert.equal(measureFrame(pixels({base:110}),128,first.pixels).motion,0);
  assert.ok(measureFrame(pixels({pattern:false}),128,first.pixels,first.pixels).change>5);
});
test('guided photos wait for preparation and sustained stability with usable light',()=>{
  const quality={light:120,glare:0,motion:0,detail:5};
  assert.equal(objectReadiness(quality,{elapsed:1800,stableFor:1500}).ready,false);
  assert.equal(objectReadiness(quality,{elapsed:3000,stableFor:1099}).ready,false);
  assert.equal(objectReadiness(quality,{elapsed:3000,stableFor:1100}).ready,true);
  assert.equal(objectReadiness(quality,{elapsed:4499,stableFor:2000,minimumDelay:4500}).ready,false);
  assert.equal(objectReadiness(quality,{elapsed:4500,stableFor:2000,minimumDelay:4500}).ready,true);
  assert.equal(objectReadiness({...quality,light:10},{elapsed:5000,stableFor:2000}).ready,false);
  assert.equal(objectReadiness({...quality,motion:18},{elapsed:5000,stableFor:2000}).ready,false);
});
test('plain and symmetric objects are captured without a texture or rotation lock',()=>{
  const quality={light:120,glare:0,motion:0,detail:.1};
  assert.equal(objectReadiness(quality,{elapsed:3200,stableFor:1200,moved:false}).ready,true);
});
test('movement restarts the continuous hold instead of reusing earlier stable time',()=>{
  const tracker=new ObjectStability(),quality={light:120,glare:0,motion:0};
  tracker.observe(quality,0,false);tracker.observe(quality,200);
  assert.equal(tracker.observe(quality,600),400);
  assert.equal(tracker.observe({...quality,motion:15},800),0);
  assert.equal(tracker.observe(quality,1000),0);
  assert.equal(tracker.observe(quality,1500),500);
  assert.equal(tracker.observe(quality,2100),1100);
});
test('unavailable frames, lighting changes and browser pauses cannot complete a stable hold',()=>{
  const tracker=new ObjectStability(),quality={light:120,glare:0,motion:0};
  tracker.observe(quality,0);tracker.observe(quality,500);
  assert.equal(tracker.observe(quality,3000),0);
  assert.equal(tracker.observe(quality,3200),200);
  assert.equal(tracker.observe({...quality,light:10},3400),0);
  assert.equal(tracker.observe(quality,3600),0);
  assert.equal(tracker.observe(quality,3800,false),0);
  tracker.reset();assert.equal(tracker.observe(quality,4000),0);
});

const startObject=source.slice(source.indexOf('async function startObjectScan('),source.indexOf('async function analyzeObjectFrame('));
const controlSource=source.slice(source.indexOf('function resetObjectControls('),source.indexOf('function beginObjectStep('));
const resetSource=source.slice(source.indexOf('function resetCaptureWorkflow('),source.indexOf('function objectRegion('));
const capture=source.slice(source.indexOf('async function captureObjectView('),source.indexOf('async function uploadObjectScan('));
const upload=source.slice(source.indexOf('async function uploadObjectScan('),source.indexOf('function showObjectScan('));
const show=source.slice(source.indexOf('function showObjectScan('),source.indexOf('async function removeSavedBackground('));
const removeSaved=source.slice(source.indexOf('async function removeSavedBackground('),source.indexOf('const emptyLibrary='));
const stopping=source.slice(source.indexOf('function stopCamera('),source.indexOf('async function toggleTorch('));
const analyze=source.slice(source.indexOf('async function analyzeObjectFrame('),source.indexOf('async function captureObjectView('));
const beginStep=source.slice(source.indexOf('function beginObjectStep('),source.indexOf('async function startObjectScan('));
const storing=source.slice(source.indexOf('async function storeObjectView('),source.indexOf('function prepareNativePhoto('));
const nativeAcceptance=source.slice(source.indexOf('async function acceptNativePhoto('),source.indexOf('async function uploadObjectScan('));
const management=source.slice(source.indexOf('function libraryScope('),source.indexOf('const emptyLibrary='));
const library=source.slice(source.indexOf('function renderLibrary('),source.indexOf('async function startOrResumeCapture('));

function harness({camera=true,sourceParts=[]}={}){
  const context=vm.createContext({CaptureWorkflow,ObjectStability,Blob,FormData,AbortSignal,Date,camera,canvasBlob,measureFrame,frameProblem,objectReadiness,filterAndSortScans});
  vm.runInContext(`
    var workflow=new CaptureWorkflow(),clock=0,jobs=[],statuses=[],coaches=[],begun=0,cameraRequests=0,phases=[];
    var stream=camera?{getTracks(){return []}}:null,video={readyState:2,videoWidth:1920,videoHeight:1080};
    var cameraSession=0,cameraPending=false,scanning=false,objectActive=false,objectBusy=false,removingSaved=false;
    var objectRun=0,objectFrames={},objectStep=0,objectTimer=null,previewUrls=[],previousPixels=null,stepReference=null;
    var captureSource='video',frameFailures=0,stepStarted=0,stepPreparationMs=3000,stability=new ObjectStability(),autoCaptures=0;
    var selectedScanId=null,pendingVisual=null,shown=[],viewerCalls=[],revoked=[];
    var shapeSaveTimer=null,shapeRevision=0,shapeSaving=false,shapeOptions={form:'auto',widthScale:1,depthScale:1},appliedShapes=[];
    var pendingShapeSave=null,shapeSaveQueues=new Map();
    var managementBusy=false,managementRequest=0,libraryScans=[],libraryDataScope='active',libraryLoaded=false,libraryLoading=false,libraryNotice='',libraryRequest=0,viewerResets=0;
    var objectSteps=[['front','Frente'],['right','Direita'],['back','Verso'],['left','Esquerda'],['top','Topo'],['bottom','Base']];
    function element(){return {children:[],hidden:false,disabled:false,value:'Objeto',textContent:'',dataset:{},events:{},classList:{add(){},remove(){},toggle(){}},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},setAttribute(){},addEventListener(name,callback){this.events[name]=callback},cloneNode(){return element()}}}
    var nodes={};function $(id){return nodes[id]||(nodes[id]=element())};
    $('libraryScope').value='active';$('librarySearch').value='';$('librarySort').value='newest';
    var emptyLibrary={cloneNode(){return element()}};
    var gallery=element(),progress={value:0},wrap={classList:{add(){},remove(){}}},instruction=$('objectInstruction');
    var startBtn=$('startBtn'),stopBtn=$('stopBtn'),torchBtn=$('torchBtn');
    var navigator={vibrate(){}},window={speechSynthesis:{cancel(){}}},URL={createObjectURL(){return 'blob:test'},revokeObjectURL(url){revoked.push(url)}};
    var performance={now(){return clock}},document={createElement(){const el=element();el.getContext=()=>({drawImage(){}});el.toBlob=cb=>cb(new Blob(['photo']));return el},querySelectorAll(){return []}};
    var analysisCtx={drawImage(){},getImageData(){return {data:new Uint8ClampedArray(128*128*4).fill(128)}}};
    var productViewer={showScan(...args){viewerCalls.push(args)},setShapeOptions(options){appliedShapes.push(options)},showProduct(){viewerResets++}};
    function setTimeout(fn){jobs.push(fn);return jobs.length};function clearTimeout(){};
    function setStatus(text){statuses.push(text)};function coach(...args){coaches.push(args)};function speak(){};
    function renderWorkflow(){phases.push(workflow.phase)};function fitGuide(){};function updateCaptureViews(){};function loadLibrary(){};function renderObjectManager(){};
    function objectRegion(){return {x:0,y:0,width:900,height:900}};
    function beginObjectStep(){begun++;objectBusy=false};async function startCamera(){cameraRequests++;stream={}};
    async function analyzeObjectFrame(){};async function captureObjectView(){autoCaptures++};async function fileToFrame(){return {blob:new Blob(['native photo']),width:100,height:100}};
    async function fetchWithTimeout(url,options){return fetch(url,options)};
    function showObjectScan(data,options){shown.push([data,options])};async function uploadObjectScan(){};
    ${sourceParts.join('\n')}
  `,context);return context;
}
test('starting the object flow opens a camera and counts down without a code',async()=>{
  const context=harness({camera:false,sourceParts:[startObject]});await context.startObjectScan();
  assert.equal(context.cameraRequests,1);assert.equal(context.workflow.phase,'preparing');assert.equal(context.begun,0);
  context.clock=600;context.jobs.shift()();assert.equal(context.workflow.phase,'capturing');assert.equal(context.begun,1);
});
test('canceling preparation prevents a stale automatic photo',async()=>{
  const context=harness({sourceParts:[controlSource,startObject]});await context.startObjectScan();
  const oldTimer=context.jobs.shift();context.cancelObjectScan();context.clock=5000;oldTimer();
  assert.equal(context.begun,0);assert.equal(context.workflow.canStart,true);
});
test('a new object invalidates pending preparation and clears unsaved views',async()=>{
  const context=harness({sourceParts:[controlSource,resetSource,startObject]});await context.startObjectScan();
  const oldTimer=context.jobs.shift();context.resetCaptureWorkflow();context.clock=5000;oldTimer();
  assert.equal(context.begun,0);assert.equal(context.workflow.canStart,true);assert.equal(Object.keys(context.objectFrames).length,0);
});
test('manual capture advances the requested view and prevents duplicate photos',async()=>{
  const context=harness({sourceParts:[capture]});context.workflow.prepare();context.workflow.start();context.objectActive=true;
  await Promise.all([context.captureObjectView(true),context.captureObjectView()]);
  assert.equal(context.gallery.children.length,1);assert.equal(context.objectStep,1);assert.ok(context.objectFrames.front instanceof Blob);
});
test('manual photo is immediately available during the short preparation',async()=>{
  const context=harness({sourceParts:[capture]});context.workflow.prepare();context.objectActive=true;await context.captureObjectView(true);
  assert.equal(context.gallery.children.length,1);assert.equal(context.objectStep,1);
});
test('all six photos upload without barcode and processing completes with cutout results',async()=>{
  const context=harness({sourceParts:[controlSource,upload]});context.workflow.prepare();context.workflow.start();
  context.objectFrames=Object.fromEntries(['front','right','back','left','top','bottom'].map(face=>[face,new Blob(['photo'])]));
  let posted;
  const response={ok:true,id:'saved',background_removed:true,views:{front:'/front.png'}};
  context.fetch=async(url,options)=>{posted={url,options};return {ok:true,json:async()=>response}};
  await context.uploadObjectScan();
  assert.equal(posted.url,'/api/object-scan');assert.equal(posted.options.body.has('barcode'),false);assert.equal(posted.options.body.get('name'),'Objeto');
  assert.equal(context.workflow.phase,'done');assert.equal(context.shown[0][0],response);assert.equal(context.shown[0][1].captureResult,true);
});
test('failed background processing preserves six images for retry',async()=>{
  const context=harness({sourceParts:[controlSource,upload]});context.workflow.prepare();context.workflow.start();
  context.objectFrames=Object.fromEntries(['front','right','back','left','top','bottom'].map(face=>[face,new Blob(['photo'])]));
  context.fetch=async()=>({ok:false,json:async()=>({error:'Falha no recorte'})});await context.uploadObjectScan();
  assert.equal(context.workflow.phase,'retry');assert.equal(Object.keys(context.objectFrames).length,6);assert.match(context.instruction.textContent,/mantidas/);
});
test('processed PNGs replace camera previews and enable transparent viewer mode',()=>{
  const context=harness({sourceParts:[show]});context.previewUrls=['blob:old'];
  const views=Object.fromEntries(['front','right','back','left','top','bottom'].map(face=>[face,'/'+face+'.png']));
  context.showObjectScan({id:'saved',name:'Vaso',views,background_removed:true},{captureResult:true});
  assert.equal(context.viewerCalls[0][1].backgroundRemoved,true);assert.equal(context.gallery.children.length,6);
  assert.equal(context.gallery.children[0].children[0].src,'/front.png');assert.deepEqual(Array.from(context.revoked),['blob:old']);
  assert.equal(context.nodes.removeSavedBackground.hidden,true);
});
test('saved 3D proportions are restored with the selected capture',()=>{
  const context=harness({sourceParts:[show]});
  context.showObjectScan({id:'shape',views:{front:'/front.png'},background_removed:true,shape_options:{form:'box',widthScale:1.2,depthScale:.7}});
  assert.equal(context.viewerCalls[0][1].shapeOptions.form,'box');
  assert.equal(context.viewerCalls[0][1].shapeOptions.widthScale,1.2);
  assert.equal(context.nodes.shapeWidth.value,120);assert.equal(context.nodes.shapeDepth.value,70);
  assert.equal(context.nodes.shapeControls.hidden,false);
});
test('shape controls update the volume immediately and save the selected capture after debounce',async()=>{
  const context=harness({sourceParts:[show]});
  context.showObjectScan({id:'shape',views:{front:'/front.png'},background_removed:true});
  context.nodes.shapeForm.value='round';context.nodes.shapeWidth.value=125;context.nodes.shapeDepth.value=85;
  let posted;
  context.fetch=async(url,options)=>{posted={url,options};return {ok:true,json:async()=>({ok:true,shape_options:JSON.parse(options.body)})}};
  context.applyShapeControls();
  assert.equal(context.appliedShapes.length,1);assert.equal(context.appliedShapes[0].depthScale,.85);
  assert.equal(posted,undefined);
  await context.jobs.shift()();
  assert.equal(posted.url,'/api/scans/shape/shape-options');assert.equal(posted.options.method,'POST');
  assert.equal(JSON.parse(posted.options.body).form,'round');assert.equal(context.pendingVisual.shape_options.widthScale,1.25);
  assert.match(context.nodes.shapeSaveStatus.textContent,/salvos/);
});
test('switching objects flushes the previous adjustment without changing the newly selected controls',async()=>{
  const context=harness({sourceParts:[show]});
  context.showObjectScan({id:'old',views:{front:'/old.png'},background_removed:true});
  context.nodes.shapeWidth.value=140;context.applyShapeControls();const oldTimer=context.jobs.shift();
  const requests=[];context.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>({ok:true})}};
  context.showObjectScan({id:'new',views:{front:'/new.png'},background_removed:true});
  await oldTimer();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,['/api/scans/old/shape-options']);assert.equal(context.nodes.shapeWidth.value,100);assert.equal(context.shapeSaving,false);
});
test('an old shape response cannot overwrite another selected object',async()=>{
  const context=harness({sourceParts:[show]});
  context.showObjectScan({id:'old',views:{front:'/old.png'},background_removed:true});
  context.nodes.shapeWidth.value=145;context.applyShapeControls();
  let release;context.fetch=()=>new Promise(resolve=>{release=resolve});const saving=context.jobs.shift()();
  for(let i=0;i<10&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
  context.showObjectScan({id:'new',views:{front:'/new.png'},background_removed:true,shape_options:{form:'box',widthScale:.9,depthScale:1.1}});
  release({ok:true,json:async()=>({ok:true,shape_options:{form:'round',widthScale:1.45,depthScale:1}})});await saving;
  assert.equal(context.pendingVisual.id,'new');assert.equal(context.nodes.shapeWidth.value,90);assert.equal(context.nodes.shapeForm.value,'box');
  assert.equal(context.shapeSaving,false);
});
test('shape writes are serialized so a slow older request cannot overwrite the latest proportions',async()=>{
  const context=harness({sourceParts:[show]});context.showObjectScan({id:'shape',views:{front:'/front.png'},background_removed:true});
  const sent=[],releases=[];let stored;
  context.fetch=(url,options)=>new Promise(resolve=>{const value=JSON.parse(options.body);sent.push(value);releases.push(()=>{stored=value;resolve({ok:true,json:async()=>({ok:true,shape_options:value})})})});
  context.nodes.shapeWidth.value=120;context.applyShapeControls();const first=context.jobs.shift()();
  for(let i=0;i<10&&!sent.length;i++)await new Promise(resolve=>setImmediate(resolve));
  context.nodes.shapeWidth.value=155;context.applyShapeControls();const second=context.jobs.shift()();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);
  releases[0]();await first;
  for(let i=0;i<10&&sent.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,2);assert.equal(sent[1].widthScale,1.55);
  releases[1]();await second;assert.equal(stored.widthScale,1.55);assert.equal(context.pendingVisual.shape_options.widthScale,1.55);
  assert.equal(context.shapeSaving,false);
});
test('legacy capture can request background removal and update the same saved ID',async()=>{
  const context=harness({sourceParts:[removeSaved]});context.selectedScanId='legacy';context.pendingVisual={id:'legacy',background_removed:false};
  let requested='';context.fetch=async url=>{requested=url;return {ok:true,json:async()=>({ok:true,id:'legacy',background_removed:true,views:{front:'/cut.png'}})}};
  await context.removeSavedBackground();assert.equal(requested,'/api/scans/legacy/remove-background');assert.equal(context.shown[0][0].id,'legacy');assert.equal(context.removingSaved,false);
});

test('the two additional object forms are restored without dropping saved options',()=>{
  for(const form of ['cylinder','ellipsoid']){
    const context=harness({sourceParts:[show]});
    context.showObjectScan({id:'form',name:'Forma',views:{front:'/front.png'},background_removed:true,shape_options:{form,widthScale:.9,depthScale:1.3}});
    assert.equal(context.nodes.shapeForm.value,form);assert.equal(context.viewerCalls[0][1].shapeOptions.form,form);
  }
});

test('renaming persists metadata without reloading the texture or replacing saved proportions',async()=>{
  const context=harness({sourceParts:[show,management]});
  const saved={id:'rename',name:'Antes',views:{front:'/front.png'},background_removed:true,shape_options:{form:'cylinder',widthScale:.8,depthScale:1.1}};
  context.showObjectScan(saved);context.nodes.savedObjectName.value='  Garrafa azul  ';
  let posted;context.fetch=async(url,options)=>{posted={url,options};return {ok:true,json:async()=>({...saved,name:'Garrafa azul',ok:true})}};
  await context.manageSelectedObject('rename');
  assert.equal(posted.url,'/api/scans/rename');assert.equal(posted.options.method,'PATCH');assert.equal(JSON.parse(posted.options.body).name,'Garrafa azul');
  assert.equal(context.pendingVisual.name,'Garrafa azul');assert.equal(context.pendingVisual.shape_options.form,'cylinder');assert.equal(context.viewerCalls.length,1);
  assert.equal(context.nodes.productName.textContent,'Garrafa azul');assert.equal(context.managementBusy,false);assert.match(context.nodes.objectManageStatus.textContent,/Nome salvo/);
});

test('invalid names and active capture cannot start a management request',async()=>{
  const context=harness({sourceParts:[show,management]});context.showObjectScan({id:'safe',name:'Original',views:{front:'/front.png'}});
  let requests=0;context.fetch=async()=>{requests++;throw new Error('unexpected')};
  context.nodes.savedObjectName.value='   ';await context.manageSelectedObject('rename');assert.match(context.nodes.objectManageStatus.textContent,/1 a 120/);
  context.nodes.savedObjectName.value='Novo';context.objectActive=true;await context.manageSelectedObject('archive');
  assert.equal(requests,0);assert.equal(context.pendingVisual.name,'Original');assert.equal(context.selectedScanId,'safe');
});

test('archiving clears only the selected preview and preserves local capture frames',async()=>{
  const context=harness({sourceParts:[show,management]});const saved={id:'archive',name:'Objeto',views:{front:'/front.png'},archived:false};
  context.showObjectScan(saved);context.objectFrames={front:new Blob(['kept'])};
  let posted;context.fetch=async(url,options)=>{posted={url,options};return {ok:true,json:async()=>({...saved,archived:true,ok:true})}};
  await context.manageSelectedObject('archive');
  assert.equal(posted.url,'/api/scans/archive/archive');assert.equal(posted.options.method,'POST');
  assert.equal(context.selectedScanId,null);assert.equal(context.pendingVisual,null);assert.equal(context.viewerResets,1);assert.ok(context.objectFrames.front instanceof Blob);
  assert.equal(context.nodes.objectManager.hidden,true);assert.match(context.libraryNotice,/preservados/);
});

test('restoring an archived item keeps its data and removes it from the archived scope',async()=>{
  const context=harness({sourceParts:[show,management]});context.nodes.libraryScope.value='archived';context.libraryDataScope='archived';
  const saved={id:'restore',name:'Lata',views:{front:'/front.png'},shape_options:{form:'cylinder'},archived:true};
  context.libraryScans=[saved];context.showObjectScan(saved);
  context.fetch=async()=>({ok:true,json:async()=>({...saved,archived:false,ok:true})});await context.manageSelectedObject('restore');
  assert.equal(context.selectedScanId,null);assert.equal(context.libraryScans.length,0);assert.match(context.libraryNotice,/restaurado/);
});

test('a slow rename response never overwrites a different selected object',async()=>{
  const context=harness({sourceParts:[show,management]});const saved={id:'old',name:'Antigo',views:{front:'/old.png'}};
  context.showObjectScan(saved);context.nodes.savedObjectName.value='Nome novo';let release;
  context.fetch=()=>new Promise(resolve=>{release=resolve});const pending=context.manageSelectedObject('rename');
  assert.equal(context.managementBusy,true);
  context.showObjectScan({id:'new',name:'Outro objeto',views:{front:'/new.png'}});
  release({ok:true,json:async()=>({...saved,name:'Nome novo',ok:true})});await pending;
  assert.equal(context.selectedScanId,'new');assert.equal(context.pendingVisual.name,'Outro objeto');assert.equal(context.nodes.savedObjectName.value,'Outro objeto');assert.equal(context.managementBusy,false);
});

test('remote updates preserve an unsaved name draft and never clear an active capture',()=>{
  const context=harness({sourceParts:[show,management]});const saved={id:'same',name:'Original',views:{front:'/front.png'},archived:false};context.showObjectScan(saved);
  context.nodes.savedObjectName.value='Meu rascunho';context.handleScanUpdated({...saved,name:'Nome remoto'});
  assert.equal(context.pendingVisual.name,'Nome remoto');assert.equal(context.nodes.savedObjectName.value,'Meu rascunho');
  context.objectActive=true;context.handleScanUpdated({...saved,archived:true});assert.equal(context.selectedScanId,'same');assert.equal(context.objectActive,true);assert.equal(context.viewerResets,0);
});

test('a library search with no result shows a filter message instead of an unrelated capture',()=>{
  const context=harness({sourceParts:[management,library]});context.libraryLoaded=true;context.libraryScans=[{id:'one',name:'Sabonete',views:{front:'/front.png'}}];
  context.nodes.librarySearch.value='café';const visible=context.renderLibrary();assert.equal(visible.length,0);
  assert.match(context.nodes.scanLibrary.children[0].textContent,/corresponde à busca/);assert.equal(context.nodes.libraryResultCount.textContent,'0 de 1 objetos ativos.');
});

test('switching library scope ignores a slower response from the previous list',async()=>{
  const context=harness({sourceParts:[management,library]});const pending=[];
  context.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));const active=context.loadLibrary(false);
  context.nodes.libraryScope.value='archived';const archived=context.loadLibrary(false);
  assert.equal(pending[0].url,'/api/scans');assert.equal(pending[1].url,'/api/scans?archived=1');
  pending[1].resolve({ok:true,json:async()=>({ok:true,scans:[{id:'archived',name:'Guardado',views:{front:'/saved.png'},archived:true}]})});await archived;
  pending[0].resolve({ok:true,json:async()=>({ok:true,scans:[{id:'active',name:'Ativo',views:{front:'/active.png'}}]})});await active;
  assert.equal(context.libraryScans[0].id,'archived');assert.equal(context.libraryDataScope,'archived');assert.equal(context.nodes.scanLibrary.children[0].dataset.id,'archived');
});

test('scope selection is cleared only when capture and persistence are idle',()=>{
  const context=harness({sourceParts:[show,management]});context.showObjectScan({id:'active',name:'Ativo',views:{front:'/front.png'},archived:false});
  context.objectActive=true;context.nodes.libraryScope.value='archived';context.renderObjectManager();
  assert.equal(context.selectedScanId,'active');assert.equal(context.nodes.saveObjectName.disabled,true);assert.equal(context.viewerResets,0);
  context.objectActive=false;context.shapeSaving=true;context.renderObjectManager();assert.equal(context.selectedScanId,'active');
  context.shapeSaving=false;context.renderObjectManager();assert.equal(context.selectedScanId,null);assert.equal(context.viewerResets,1);
});
test('stopping the camera during background processing leaves the upload intact',()=>{
  const context=harness({sourceParts:[controlSource,stopping]});context.workflow.prepare();context.workflow.start();context.workflow.save();context.objectActive=true;
  const run=context.objectRun;context.stopCamera();assert.equal(context.workflow.phase,'saving');assert.equal(context.objectRun,run);assert.equal(context.objectActive,true);assert.equal(context.stream,null);
});
test('a transient canvas error reschedules analysis and a symmetric object still captures',async()=>{
  const context=harness({sourceParts:[analyze]});context.workflow.prepare();context.workflow.start();context.objectActive=true;context.clock=1000;
  let calls=0;context.analysisCtx.drawImage=()=>{if(!calls++)throw new Error('InvalidStateError')};
  await context.analyzeObjectFrame();assert.equal(context.objectBusy,false);assert.ok(context.jobs.length>0);
  for(let i=0;i<20&&!context.autoCaptures;i++){context.clock+=200;await context.analyzeObjectFrame()}
  assert.equal(context.autoCaptures,1);
});

test('two snapshots after a browser pause are not enough to trigger an automatic photo',async()=>{
  const context=harness({sourceParts:[analyze]});context.workflow.prepare();context.workflow.start();context.objectActive=true;
  for(const time of [0,200,400,600,800,1000,3000,3200]){context.clock=time;await context.analyzeObjectFrame()}
  assert.equal(context.autoCaptures,0);
  for(const time of [3400,3600,3800,4000,4200]){context.clock=time;await context.analyzeObjectFrame()}
  assert.equal(context.autoCaptures,1);
});

test('automatic scanning gives the first view three seconds and the next side four and a half seconds',async()=>{
  const context=harness({sourceParts:[beginStep,analyze]});context.workflow.prepare();context.workflow.start();context.objectActive=true;
  context.beginObjectStep();
  for(let time=200;time<=2800;time+=200){context.clock=time;await context.analyzeObjectFrame()}
  assert.equal(context.autoCaptures,0);context.clock=3000;await context.analyzeObjectFrame();assert.equal(context.autoCaptures,1);
  context.objectStep=1;context.beginObjectStep();
  for(let time=3200;time<=7400;time+=200){context.clock=time;await context.analyzeObjectFrame()}
  assert.equal(context.autoCaptures,1);context.clock=7500;await context.analyzeObjectFrame();assert.equal(context.autoCaptures,2);
});
test('a failed snapshot releases the capture lock and a manual retry succeeds',async()=>{
  const context=harness({sourceParts:[capture]});context.workflow.prepare();context.workflow.start();context.objectActive=true;
  const create=context.document.createElement;let fail=true;
  context.document.createElement=tag=>{const el=create(tag);if(tag==='canvas'&&fail)el.getContext=()=>({drawImage(){throw new Error('InvalidStateError')}});return el};
  await context.captureObjectView(true);assert.equal(context.objectBusy,false);assert.equal(context.objectStep,0);
  fail=false;await context.captureObjectView(true);assert.equal(context.objectStep,1);
});
test('manual capture refuses a paused video instead of saving a frozen frame',async()=>{
  const context=harness({sourceParts:[capture]});context.workflow.prepare();context.workflow.start();context.objectActive=true;context.video.paused=true;
  await context.captureObjectView(true);assert.equal(context.objectStep,0);assert.equal(context.objectBusy,false);assert.equal(context.startBtn.disabled,false);
  assert.match(context.statuses.at(-1),/retomar/);
});
test('the native phone camera can supply all six views without getUserMedia',async()=>{
  const context=harness({camera:false,sourceParts:[controlSource,startObject,storing,nativeAcceptance,upload]});let posted;
  context.fetch=async(url,options)=>{posted=options.body;return {ok:true,json:async()=>({ok:true,id:'native',background_removed:true,views:{}})}};
  for(let i=0;i<6;i++)await context.acceptNativePhoto(new Blob(['file']));
  assert.equal(context.cameraRequests,0);assert.equal(context.workflow.phase,'done');
  assert.equal(posted.has('barcode'),false);for(const face of ['front','right','back','left','top','bottom'])assert.ok(posted.has(face));
});
test('mobile capture does not rely on AbortSignal.timeout or createImageBitmap',()=>{
  assert.doesNotMatch(source,/AbortSignal\.timeout|createImageBitmap/);
  const template=readFileSync(new URL('./templates/index.html',import.meta.url),'utf8');
  assert.match(template,/id="quickCapture"/);assert.match(template,/id="nativeCapture"[^>]*capture="environment"/);
});
