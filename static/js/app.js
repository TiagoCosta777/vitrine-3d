import {CaptureWorkflow,ObjectStability,measureFrame,objectReadiness} from './scan-logic.mjs?v=13';
import {chooseCamera,rankCameras,safeInitialZoom,maxUiZoom,getFocusPoint} from './camera-logic.mjs?v=1';
import {canvasBlob,fileToFrame,fetchWithTimeout} from './capture-runtime.mjs?v=1';
import {filterAndSortScans} from './library-logic.mjs?v=1';

const $=id=>document.getElementById(id);
const socket=window.io?window.io():{on(){}};
const video=$('video'),startBtn=$('startBtn'),stopBtn=$('stopBtn'),torchBtn=$('torchBtn');
const wrap=document.querySelector('.camera-wrap'),statusEl=$('scanStatus');
const instruction=$('objectInstruction'),progress=$('objectProgress'),gallery=$('objectGallery');
const workflow=new CaptureWorkflow();
const stability=new ObjectStability();
let productViewer=null,pendingVisual=null,selectedScanId=null,libraryRequest=0,removingSaved=false;
let libraryScans=[],libraryDataScope='active',libraryLoaded=false,libraryLoading=false,libraryNotice='';
let managementBusy=false,managementRequest=0;
let deleteTargetId=null;
let shapeSaveTimer=null,shapeRevision=0,shapeSaving=false;
let pendingShapeSave=null;
const shapeSaveQueues=new Map();
let shapeOptions={form:'auto',widthScale:1,depthScale:1};
let stream=null,cameraPending=false,cameraSession=0,scanning=false,torchOn=false;
let spoken=false,lastSpoken='',lastSpokenAt=0;
let objectActive=false,objectBusy=false,objectTimer=null,objectStep=0,objectRun=0,objectFrames={},previewUrls=[];
let previousPixels=null,stepReference=null,stepStarted=0,stepPreparationMs=3000;
let captureSource='video',frameFailures=0;
const analysisCanvas=document.createElement('canvas');analysisCanvas.width=128;analysisCanvas.height=128;
const analysisCtx=analysisCanvas.getContext('2d',{willReadFrequently:true});
const objectSteps=[
  ['front','Frente','Mostre a FRENTE do objeto. Deixe todas as bordas dentro do quadrado e retire as mãos do enquadramento.'],
  ['right','Direita','Gire um quarto de volta para mostrar o LADO DIREITO. Apoie o objeto e mantenha o celular firme.'],
  ['back','Verso','Gire mais um quarto de volta para mostrar o VERSO. Deixe o objeto inteiro dentro do quadrado.'],
  ['left','Esquerda','Gire mais um quarto de volta para mostrar o LADO ESQUERDO. Evite dedos cobrindo o objeto.'],
  ['top','Topo','Mostre o TOPO diretamente à câmera. Inclua toda a parte de cima, sem reflexos nem dedos na frente.'],
  ['bottom','Base','Mostre a BASE diretamente à câmera. Inclua a base inteira e mantenha parado para a última foto.']
];

function setStatus(text){statusEl.textContent=text}
function speak(text,force=false){
  if(!spoken||!window.speechSynthesis)return;
  const now=Date.now();if(!force&&(text===lastSpoken||now-lastSpokenAt<8000))return;
  lastSpoken=text;lastSpokenAt=now;window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang='pt-BR';utterance.rate=.95;window.speechSynthesis.speak(utterance);
}
function coach(stage,title,hint='',count=null){
  $('coachStage').textContent=stage;$('coachTitle').textContent=title;$('coachHint').textContent=hint;
  $('captureCount').hidden=count===null;$('captureCount').textContent=count??'';
}
$('voiceBtn').disabled=!('speechSynthesis' in window);
$('voiceBtn').addEventListener('click',()=>{
  spoken=!spoken;$('voiceBtn').setAttribute('aria-pressed',String(spoken));$('voiceBtn').textContent=spoken?'Silenciar instruções':'Ouvir instruções';
  if(spoken)speak($('coachTitle').textContent+'. '+$('coachHint').textContent,true);else window.speechSynthesis?.cancel();
});
socket.on('connect',()=>{$('connection').textContent='Dispositivos sincronizados';$('connection').className='connection online';loadLibrary()});
socket.on('disconnect',()=>{$('connection').textContent='Reconectando…';$('connection').className='connection offline'});
socket.on('connect_error',()=>{$('connection').textContent='Sem conexão com o servidor';$('connection').className='connection offline'});
socket.on('object_scanned',data=>{if(!objectActive&&!managementBusy&&(!removingSaved||data.id===selectedScanId))showObjectScan(data);else loadLibrary(false)});
socket.on('object_scan_updated',data=>{handleScanUpdated(data)});
socket.on('object_scan_deleted',data=>{handleScanDeleted(data)});
socket.on('object_shape_updated',data=>{
  if(data.id!==selectedScanId||shapeSaveTimer||shapeSaving)return;
  if(pendingVisual)pendingVisual.shape_options=normalizeShapeOptions(data.shape_options);
  syncShapeControls(data.shape_options);productViewer?.setShapeOptions?.(shapeOptions);
});

async function startCamera(requestedDevice='',fallbackDevice=''){
  if(stream||cameraPending)return;
  if(typeof requestedDevice!=='string')requestedDevice='';
  cameraPending=true;startBtn.disabled=true;stopBtn.disabled=false;const session=++cameraSession;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Abra o endereço HTTPS para usar a câmera.');
    const options={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24}};
    const acquire=device=>navigator.mediaDevices.getUserMedia({audio:false,video:{...options,...(device?{deviceId:{exact:device}}:{facingMode:{ideal:'environment'}})}});
    let acquired;
    try{acquired=await acquire(requestedDevice)}catch(error){if(!requestedDevice||session!==cameraSession)throw error;acquired=await acquire(fallbackDevice);requestedDevice=fallbackDevice}
    if(session!==cameraSession){acquired.getTracks().forEach(t=>t.stop());return}
    stream=acquired;
    let devices=[];try{devices=await navigator.mediaDevices.enumerateDevices()}catch(_){}
    if(session!==cameraSession)return;
    // Keep the granted rear stream: lens enumeration must not reopen the camera
    // or accidentally switch to the front when Safari hides device identifiers.
    if(session!==cameraSession)return;video.muted=true;video.playsInline=true;video.srcObject=stream;await video.play();if(session!==cameraSession)return;
    wrap.classList.add('is-active','object-mode');$('cameraIdle').hidden=true;
    const track=stream.getVideoTracks()[0],caps=track.getCapabilities?.()||{};
    track.addEventListener?.('ended',()=>{if(session!==cameraSession||workflow.phase==='saving')return;clearTimeout(objectTimer);startBtn.disabled=false;setStatus('A câmera foi interrompida. Toque em Escanear agora para retomar ou use a câmera de fotos do celular.');},{once:true});
    if(caps.focusMode?.includes('continuous')){try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch(_){}}
    if(session!==cameraSession)return;
    torchOn=false;torchBtn.hidden=!caps.torch;$('zoomControl').hidden=!(caps.zoom&&caps.zoom.max>caps.zoom.min);
    const activeDevice=track.getSettings().deviceId||'',ranked=rankCameras(devices,activeDevice),namedMain=ranked.find(device=>device.deviceId===activeDevice)?.score>=200;
    if(caps.zoom){
      const initial=safeInitialZoom(caps.zoom,namedMain?1:track.getSettings().zoom);try{await track.applyConstraints({advanced:[{zoom:initial}]})}catch(_){}
      if(session!==cameraSession)return;
      const value=track.getSettings().zoom??initial,zoom=$('cameraZoom');zoom.min=caps.zoom.min;zoom.max=maxUiZoom(caps.zoom,value);zoom.step=caps.zoom.step||.1;zoom.value=value;$('zoomValue').textContent=Number(value).toFixed(1)+'×';
    }
    $('cameraSelect').replaceChildren();ranked.forEach((device,index)=>{const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label||'Câmera '+(index+1);$('cameraSelect').append(option)});
    $('cameraSelect').value=activeDevice;$('cameraSelect').disabled=ranked.length<2;$('cameraTools').hidden=false;$('resetZoom').hidden=!caps.zoom;
    scanning=true;setStatus('Câmera pronta. Enquadre o objeto. Capturar agora fotografa sem esperar.');
    fitGuide();renderWorkflow();coach('Etapa 1 · Enquadrar','Posicione apenas o objeto','Use um fundo simples, inclua todas as bordas e deixe as mãos fora do quadrado.');
  }catch(err){
    if(session===cameraSession){stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;wrap.classList.remove('is-active');$('cameraIdle').hidden=false;$('cameraTools').hidden=true;stopBtn.disabled=true;setStatus('Erro ao abrir câmera: '+err.message)}
  }finally{cameraPending=false;startBtn.disabled=!!stream;renderWorkflow()}
}
function stopCamera(){
  const saving=workflow.phase==='saving';cameraSession++;scanning=false;if(objectActive&&!saving)cancelObjectScan();
  stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;wrap.classList.remove('is-active');$('cameraIdle').hidden=false;
  startBtn.disabled=false;stopBtn.disabled=true;torchBtn.hidden=true;$('zoomControl').hidden=true;$('cameraTools').hidden=true;
  if(!saving&&workflow.phase!=='done'){coach('Câmera parada','Abra a câmera para continuar','As fotos já capturadas permanecem disponíveis para reenvio, se necessário.');setStatus('Câmera parada.')}
  window.speechSynthesis?.cancel();
}
async function toggleTorch(){const track=stream?.getVideoTracks()[0];if(!track)return;try{await track.applyConstraints({advanced:[{torch:!torchOn}]});torchOn=!torchOn;torchBtn.textContent=torchOn?'Desligar luz':'Ligar luz'}catch(_){setStatus('Este aparelho não permitiu ajustar a luz.')}}
$('cameraZoom').addEventListener('change',async()=>{const track=stream?.getVideoTracks()[0];if(!track)return;try{await track.applyConstraints({advanced:[{zoom:Number($('cameraZoom').value)}]});$('zoomValue').textContent=Number($('cameraZoom').value).toFixed(1)+'×'}catch(_){setStatus('Não foi possível ajustar o zoom.')}});
$('resetZoom').addEventListener('click',()=>{const track=stream?.getVideoTracks()[0],caps=track?.getCapabilities?.();if(!caps?.zoom)return;$('cameraZoom').value=safeInitialZoom(caps.zoom,1);$('cameraZoom').dispatchEvent(new Event('change'))});
$('cameraSelect').addEventListener('change',async()=>{if(!workflow.canStart||cameraPending)return;const device=$('cameraSelect').value,previous=stream?.getVideoTracks()[0].getSettings().deviceId||'';stopCamera();await startCamera(device,previous)});
video.addEventListener('click',async event=>{
  const track=stream?.getVideoTracks()[0];if(!track)return;
  const caps=track.getCapabilities?.()||{},point=getFocusPoint(event.clientX,event.clientY,video.getBoundingClientRect(),video.videoWidth,video.videoHeight);if(!point)return;
  const supported=navigator.mediaDevices.getSupportedConstraints?.()||{},advanced={};
  if(supported.pointsOfInterest)advanced.pointsOfInterest=[point];if(caps.focusMode?.includes('continuous'))advanced.focusMode='continuous';else if(caps.focusMode?.includes('single-shot'))advanced.focusMode='single-shot';
  if(!Object.keys(advanced).length){setStatus('O foco é automático neste navegador. Afaste um pouco para o objeto ficar nítido.');return}
  try{await track.applyConstraints({advanced:[advanced]});setStatus('Aguarde o foco ajustar. Deixe o objeto inteiro no quadrado.')}catch(_){setStatus('Afaste um pouco para o foco automático ajustar.')}
});

function renderWorkflow(){
  const phase=workflow.phase,ready=phase==='ready',done=phase==='done',saving=phase==='saving'||removingSaved;
  if(saving||managementBusy)startBtn.disabled=true;else if(!cameraPending)startBtn.disabled=!!stream&&!video.paused&&stream.getVideoTracks?.()[0]?.readyState!=='ended';
  $('captureTitle').textContent=ready?'1. Enquadre o objeto':done?'3. Objeto sem fundo':'2. Capture os lados';
  $('captureSubtitle').textContent=ready?'Comece direto pelo objeto. Sem código de barras.':saving?'Separando o objeto do fundo nas seis fotos…':done?'Confira os recortes e explore o resultado.':'Siga a vista indicada e mantenha o objeto parado.';
  $('captureStepTag').textContent=ready?'PASSO 01':done?'CONCLUÍDO':'PASSO 02';
  $('cameraIdleTitle').textContent=done?'Captura concluída':'Só o seu objeto, em destaque';
  $('cameraIdleHint').textContent=done?'Explore o resultado ou toque em Novo objeto.':'Toque em Escanear agora. A câmera abre e a captura começa no mesmo passo.';
  $('objectStart').disabled=!workflow.canStart||cameraPending||removingSaved||managementBusy;$('objectStart').hidden=!workflow.canStart;
  const canCapture=['preparing','capturing'].includes(phase)&&captureSource==='video';
  $('objectCancel').hidden=!['preparing','capturing','retry'].includes(phase);$('objectCapture').hidden=!canCapture;$('objectRetry').hidden=phase!=='retry';
  $('quickCapture').hidden=!canCapture;$('quickCapture').disabled=objectBusy&&phase!=='preparing';
  $('objectCapture').disabled=objectBusy&&phase!=='preparing';
  $('nativeCapture').disabled=saving||managementBusy||objectBusy&&phase!=='preparing';
  $('nativeCaptureTitle').textContent=objectActive?'Fotografar '+(objectSteps[objectStep]?.[1]||'objeto'):'Usar câmera de fotos do celular';
  $('nativeCaptureLabel').hidden=saving||done;
  if(captureSource==='photo'&&objectActive){$('cameraIdleTitle').textContent='Foto '+(objectStep+1)+' de 6 · '+(objectSteps[objectStep]?.[1]||'');$('cameraIdleHint').textContent='Toque em Fotografar para usar a câmera de fotos do celular. Não é preciso esperar a captura automática.'}
  $('nextProduct').disabled=saving||managementBusy;$('nextProduct').textContent=['preparing','capturing'].includes(phase)?'Cancelar e reiniciar':phase==='retry'?'Descartar e reiniciar':'Novo objeto';
  $('newCapture').setAttribute('aria-disabled',String(saving||managementBusy));$('scanName').disabled=saving||phase==='retry'||done;
  $('cameraSelect').disabled=!ready||removingSaved||managementBusy||$('cameraSelect').options.length<2;$('processingNotice').hidden=!saving;
  $('removeSavedBackground').disabled=objectActive||removingSaved;
  for(const [id,step] of [['workflowFrame',1],['workflowCapture',2],['workflowDone',3]]){
    const element=$(id),current=ready?1:done?3:2;element.classList.toggle('current',step===current);element.classList.toggle('complete',step<current);
    if(step===current)element.setAttribute('aria-current','step');else element.removeAttribute('aria-current');
  }
  updateCaptureViews();
  renderObjectManager();
}
function updateCaptureViews(){
  $('captureViews').replaceChildren();objectSteps.forEach(([face,label],index)=>{
    const chip=document.createElement('span'),complete=index<objectStep;chip.className='capture-view'+(complete?' complete':'')+(workflow.phase==='capturing'&&index===objectStep?' current':'');
    chip.textContent=(complete?'✓ ':`${index+1} `)+label;if(workflow.phase==='capturing'&&index===objectStep)chip.setAttribute('aria-current','step');$('captureViews').append(chip);
  });$('captureLabel').textContent=objectStep+' de 6 vistas';
}
function resetCaptureWorkflow(){
  if(managementBusy){setStatus('Aguarde a atualização do objeto antes de iniciar outra captura.');return}
  if(workflow.phase==='saving'||removingSaved){setStatus('Aguarde a remoção do fundo e o envio antes de iniciar outro objeto.');return}
  cancelObjectScan();workflow.reset();previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];objectFrames={};objectStep=0;previousPixels=null;stepReference=null;
  captureSource='video';frameFailures=0;$('scanName').value='';gallery.replaceChildren();progress.value=0;renderWorkflow();fitGuide();
  coach('Etapa 1 · Enquadrar','Posicione apenas o objeto','Inclua todas as bordas. Use luz uniforme e mantenha as mãos fora do quadrado.');
  instruction.textContent='Pronto para capturar um novo objeto.';setStatus('Enquadre o objeto e toque em Escanear objeto.');
}
function objectRegion(){const side=Math.min(video.videoWidth,video.videoHeight)*.86;return {x:(video.videoWidth-side)/2,y:(video.videoHeight-side)/2,width:side,height:side}}
function fitGuide(){if(!video.videoWidth)return;const scale=Math.min(wrap.clientWidth/video.videoWidth,wrap.clientHeight/video.videoHeight),region=objectRegion();document.querySelector('.guide span').style.cssText=`width:${region.width*scale}px;height:${region.height*scale}px`}
function resetObjectControls(){objectActive=false;objectBusy=false;clearTimeout(objectTimer);wrap.classList.remove('capturing');fitGuide();renderWorkflow()}
function cancelObjectScan(){
  if(workflow.phase==='saving')return;
  objectRun++;workflow.cancel();resetObjectControls();$('captureCount').hidden=true;window.speechSynthesis?.cancel();
  instruction.textContent='Captura cancelada. Toque em Escanear objeto para recomeçar.';coach('Captura pausada','Vamos recomeçar?','Posicione a frente do objeto e inicie uma nova sequência de fotos.');
}
function beginObjectStep(){
  stepReference=previousPixels;previousPixels=null;stability.reset();stepStarted=performance.now();
  stepPreparationMs=objectStep===0?3000:4500;
  objectBusy=false;frameFailures=0;renderWorkflow();
  const stage=`Vista ${objectStep+1}/6 · ${objectSteps[objectStep][1]}`;coach(stage,objectStep===0?'Enquadre o objeto':'Gire o objeto',objectSteps[objectStep][2]);
  instruction.textContent=stage+'. '+objectSteps[objectStep][2];speak('Mostre '+objectSteps[objectStep][1]+'.',true);
  if(captureSource==='video')objectTimer=setTimeout(analyzeObjectFrame,140);
}
async function startObjectScan(source='video'){
  if(typeof source!=='string')source='video';
  if(!workflow.canStart||objectActive||removingSaved||managementBusy)return;const revision=workflow.revision;if(source==='video'&&!stream)await startCamera();
  if(source==='video'&&!stream||revision!==workflow.revision||objectActive||!workflow.prepare())return;
  captureSource=source;
  previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];objectFrames={};objectStep=0;previousPixels=null;stepReference=null;objectActive=true;objectBusy=false;objectRun++;
  wrap.classList.add('object-mode');fitGuide();gallery.replaceChildren();progress.value=0;renderWorkflow();
  setStatus('Captura iniciada. Teremos mais tempo para enquadrar cada lado e esperar a câmera estabilizar. Capturar agora continua disponível.');speak('Captura iniciada. Enquadre a frente e mantenha firme.',true);
  if(source==='photo'){workflow.start();renderWorkflow();beginObjectStep();return}
  const run=objectRun,started=performance.now();
  function prepareFirstView(){
    if(!objectActive||run!==objectRun||workflow.phase!=='preparing')return;
    const remaining=Math.ceil((500-(performance.now()-started))/1000);
    if(remaining<=0){if(workflow.start()){renderWorkflow();beginObjectStep()}return}
    coach('Etapa 2 · Captura iniciada','Prepare a FRENTE do objeto','Inclua todo o objeto no quadrado, sem dedos na frente. Use luz uniforme.',remaining);
    instruction.textContent='Enquadre a frente do objeto. Capturar agora já está disponível.';objectTimer=setTimeout(prepareFirstView,100);
  }prepareFirstView();
}
async function analyzeObjectFrame(){
  if(!objectActive||objectBusy||workflow.phase!=='capturing'||captureSource!=='video'||document.hidden)return;
  const run=objectRun;
  try{
    if(video.readyState<2||!video.videoWidth||!video.videoHeight||video.paused||stream?.getVideoTracks?.()[0]?.readyState==='ended'){
      stability.reset();previousPixels=null;
      startBtn.disabled=false;
      setStatus('Aguardando a câmera. Você também pode usar Fotografar para abrir a câmera de fotos.');
      objectTimer=setTimeout(analyzeObjectFrame,250);return;
    }
    const region=objectRegion();analysisCtx.drawImage(video,region.x,region.y,region.width,region.height,0,0,128,128);
    const quality=measureFrame(analysisCtx.getImageData(0,0,128,128).data,128,previousPixels,stepReference);
    const now=performance.now(),stableFor=stability.observe(quality,now,!!previousPixels);previousPixels=quality.pixels;frameFailures=0;
    const result=objectReadiness(quality,{elapsed:now-stepStarted,stableFor,minimumDelay:stepPreparationMs});
    const stage=`Vista ${objectStep+1}/6 · ${objectSteps[objectStep][1]}`;coach(stage,result.title,objectSteps[objectStep][2]+' '+result.hint,result.ready?null:result.count||null);
    instruction.textContent=stage+' · '+result.title+'. '+result.hint;
    if(result.ready){await captureObjectView();return}
  }catch(error){
    if(run!==objectRun||!objectActive)return;
    stability.reset();previousPixels=null;
    frameFailures++;setStatus(frameFailures>=3?'O vídeo não forneceu uma imagem. Use Fotografar para capturar esta vista com a câmera do celular.':'Ajustando a câmera. Você pode tocar em Capturar agora.');
  }
  if(run===objectRun&&objectActive&&!objectBusy)objectTimer=setTimeout(analyzeObjectFrame,140);
}
async function captureObjectView(manual=false){
  if(!objectActive||document.hidden||captureSource!=='video')return;
  if(manual&&workflow.phase==='preparing'){clearTimeout(objectTimer);workflow.start();objectBusy=false;renderWorkflow()}
  if(objectBusy||workflow.phase!=='capturing')return;
  if(video.readyState<2||!video.videoWidth||!video.videoHeight||video.paused||stream?.getVideoTracks?.()[0]?.readyState==='ended'){
    startBtn.disabled=false;setStatus('Toque em Escanear agora para retomar a câmera ou use Fotografar.');return;
  }
  objectBusy=true;clearTimeout(objectTimer);$('objectCapture').disabled=true;const run=objectRun,region=objectRegion();
  renderWorkflow();
  try{
    const capture=document.createElement('canvas');capture.width=capture.height=Math.round(Math.min(1024,region.width));
    capture.getContext('2d').drawImage(video,region.x,region.y,region.width,region.height,0,0,capture.width,capture.height);
    wrap.classList.add('capturing');coach(`Vista ${objectStep+1}/6`,'Capturando…','Aguarde um instante.');
    const blob=await canvasBlob(capture,'image/jpeg',.9);if(!objectActive||run!==objectRun)return;
    wrap.classList.remove('capturing');await storeObjectView(blob,manual);
  }catch(error){
    if(run!==objectRun||!objectActive)return;
    wrap.classList.remove('capturing');objectBusy=false;renderWorkflow();
    setStatus('Não foi possível obter esta foto. Tente Capturar agora ou use Fotografar.');
    objectTimer=setTimeout(analyzeObjectFrame,300);
  }
}
async function storeObjectView(blob,manual=false){
  const [face,label]=objectSteps[objectStep];objectFrames[face]=blob;
  const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),url=URL.createObjectURL(blob);previewUrls.push(url);
  img.src=url;img.alt=label;caption.textContent=label+(manual?' · manual':' ✓');figure.append(img,caption);gallery.append(figure);navigator.vibrate?.(60);progress.value=++objectStep;updateCaptureViews();
  if(objectStep===objectSteps.length){await uploadObjectScan();return}beginObjectStep();
}
function prepareNativePhoto(event){
  if(workflow.phase==='saving'||removingSaved||managementBusy||objectBusy&&workflow.phase!=='preparing'){event.preventDefault();return}
  captureSource='photo';clearTimeout(objectTimer);cameraSession++;
  stream?.getTracks().forEach(track=>track.stop());stream=null;scanning=false;video.srcObject=null;
  wrap.classList.remove('is-active','capturing');$('cameraIdle').hidden=false;
  startBtn.disabled=false;stopBtn.disabled=true;$('cameraTools').hidden=true;$('zoomControl').hidden=true;torchBtn.hidden=true;
  if(workflow.phase==='preparing'){workflow.start();objectBusy=false}
  renderWorkflow();
}
async function acceptNativePhoto(file){
  if(!file||workflow.phase==='saving'||removingSaved||managementBusy)return;
  if(workflow.canStart)await startObjectScan('photo');
  if(!objectActive||workflow.phase!=='capturing'||objectBusy)return;
  captureSource='photo';clearTimeout(objectTimer);const run=objectRun;objectBusy=true;renderWorkflow();
  try{
    const {blob}=await fileToFrame(file,{maxSide:1400,quality:.9});
    if(run!==objectRun||!objectActive)return;
    await storeObjectView(blob,true);
  }catch(error){if(run===objectRun&&objectActive){objectBusy=false;renderWorkflow();setStatus('Não consegui abrir a foto. Toque em Fotografar para tentar novamente.')}}
}
async function uploadObjectScan(){
  if(Object.keys(objectFrames).length!==6||!workflow.save())return;
  const run=objectRun;objectActive=true;objectBusy=true;renderWorkflow();
  coach('Processando as seis vistas','Removendo o fundo…','O processamento pode levar alguns instantes. Mantenha esta página aberta.');instruction.textContent='Enviando as fotos e separando o objeto do fundo…';
  setStatus('Removendo o fundo das seis fotos. Aguarde a conclusão.');
  const fd=new FormData();fd.append('name',$('scanName').value.trim());for(const [face,blob] of Object.entries(objectFrames))fd.append(face,blob,`${face}.jpg`);
  try{
    const response=await fetchWithTimeout('/api/object-scan',{method:'POST',body:fd},180000),data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Falha ao processar a captura');if(run!==objectRun)return;
    workflow.complete();objectActive=false;showObjectScan(data,{captureResult:true});
    instruction.textContent='✓ Objeto salvo. Confira as bordas recortadas nas seis fotos e explore o resultado.';
    coach('Etapa 3 · Concluído','Seu objeto está salvo','Confira o recorte. Arraste para girar e faça pinça para ampliar.');
    speak('Captura concluída. Confira o objeto sem fundo.',true);setStatus('✓ Captura salva. Confira o recorte antes de continuar.');
  }catch(error){
    if(run!==objectRun)return;workflow.fail();instruction.textContent='Não foi possível concluir: '+error.message+'. As fotos foram mantidas para tentar novamente.';
    coach('Fotos mantidas','Não foi possível processar','Toque em Reenviar capturas para tentar novamente.');setStatus(instruction.textContent);
  }finally{if(run===objectRun)resetObjectControls()}
}
function showObjectScan(data,{captureResult=false}={}){
  if(!data.views)return;
  const changed=selectedScanId!==data.id;
  if(changed){
    clearTimeout(shapeSaveTimer);shapeSaveTimer=null;
    const pending=pendingShapeSave;pendingShapeSave=null;
    if(pending)void persistShapeOptions(pending.id,pending.options,pending.revision);
    shapeRevision++;shapeSaving=false;
  }
  const options=!changed&&(shapeSaveTimer||shapeSaving)?shapeOptions:normalizeShapeOptions(data.shape_options);
  selectedScanId=data.id;pendingVisual={...data,shape_options:options};syncShapeControls(options);
  $('savedObjectName').value=data.name||'Objeto sem nome';$('objectManageStatus').textContent='';
  $('shapeControls').hidden=!data.background_removed;$('shapeSaveStatus').textContent='';
  productViewer?.showScan(data.views,{backgroundRemoved:!!data.background_removed,shapeOptions:options});
  $('productName').textContent=data.name||'Objeto capturado';$('productMeta').textContent=data.background_removed?'Volume aproximado · seis vistas do objeto':'6 vistas salvas · captura anterior';
  $('codeBadge').textContent=data.background_removed?'VOLUME 3D':'6 VISTAS';$('viewerKind').textContent=data.background_removed?'3D APROXIMADO':'CAPTURA SALVA';$('viewerKind').classList.add('saved');
  $('stageLabel').textContent='SEU OBJETO · VOLUME INTERATIVO';$('viewerNote').textContent=data.background_removed?'Modelo 3D aproximado pelos contornos das fotos. Ajuste largura e profundidade se necessário. Não calcula medidas reais nem reproduz cavidades exatas.':'Captura antiga com fundo. Use Remover fundo desta captura para processar estas fotos, preservando os originais.';
  $('removeSavedBackground').hidden=!!data.background_removed;
  document.querySelectorAll('.scan-card').forEach(card=>card.setAttribute('aria-pressed',String(card.dataset.id===selectedScanId)));
  if(captureResult){
    $('libraryScope').value='active';
    gallery.replaceChildren();for(const [face,label] of objectSteps){const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=data.views[face];image.alt=label+' · resultado';caption.textContent=label;figure.append(image,caption);gallery.append(figure)}
    previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];progress.value=6;$('captureLabel').textContent='6 de 6 vistas';
    $('viewerStage').scrollIntoView?.({behavior:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
  }
  renderObjectManager();
  loadLibrary(false);
}
function normalizeShapeOptions(value={}){
  const number=(input,fallback,min,max)=>{const result=Number(input);return Number.isFinite(result)&&result>0?Math.max(min,Math.min(max,result)):fallback};
  return {form:['auto','round','box','cylinder','ellipsoid'].includes(value?.form)?value.form:'auto',widthScale:number(value?.widthScale,1,.5,1.75),depthScale:number(value?.depthScale,1,.25,2.5)};
}
function syncShapeControls(value){
  shapeOptions=normalizeShapeOptions(value);$('shapeForm').value=shapeOptions.form;
  $('shapeWidth').value=Math.round(shapeOptions.widthScale*100);$('shapeDepth').value=Math.round(shapeOptions.depthScale*100);
  $('shapeWidthValue').textContent=Math.round(shapeOptions.widthScale*100)+'%';$('shapeDepthValue').textContent=Math.round(shapeOptions.depthScale*100)+'%';
}
function applyShapeControls(){
  if(!selectedScanId||!pendingVisual?.background_removed||managementBusy)return;
  shapeOptions=normalizeShapeOptions({form:$('shapeForm').value,widthScale:Number($('shapeWidth').value)/100,depthScale:Number($('shapeDepth').value)/100});
  syncShapeControls(shapeOptions);pendingVisual.shape_options={...shapeOptions};productViewer?.setShapeOptions?.(shapeOptions);
  $('shapeSaveStatus').textContent='Ajustando o modelo…';
  clearTimeout(shapeSaveTimer);const id=selectedScanId,options={...shapeOptions},revision=++shapeRevision;
  pendingShapeSave={id,options,revision};
  renderObjectManager();
  shapeSaveTimer=setTimeout(async()=>{if(pendingShapeSave?.revision!==revision)return;pendingShapeSave=null;shapeSaveTimer=null;await persistShapeOptions(id,options,revision)},450);
}
async function persistShapeOptions(id,options,revision){
  // Serialize writes per object: an older slow POST must finish before the
  // latest adjustment is sent, so the server also keeps the newest options.
  const previous=shapeSaveQueues.get(id)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(()=>performShapeSave(id,options,revision));
  shapeSaveQueues.set(id,operation);
  try{await operation}
  finally{if(shapeSaveQueues.get(id)===operation){shapeSaveQueues.delete(id);if(id===selectedScanId&&!shapeSaveTimer)shapeSaving=false}renderObjectManager()}
}
async function performShapeSave(id,options,revision){
  if(id===selectedScanId)shapeSaving=true;
  try{
    const response=await fetchWithTimeout('/api/scans/'+encodeURIComponent(id)+'/shape-options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options)},10000),data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Não foi possível salvar os ajustes.');
    loadLibrary(false);
    if(id!==selectedScanId||revision!==shapeRevision)return;
    pendingVisual.shape_options=normalizeShapeOptions(data.shape_options||options);syncShapeControls(pendingVisual.shape_options);
    $('shapeSaveStatus').textContent='Ajustes salvos nesta captura.';
  }catch(_){if(id===selectedScanId&&revision===shapeRevision)$('shapeSaveStatus').textContent='O ajuste foi aplicado, mas não foi salvo. Mova um controle para tentar novamente.'}
}
async function removeSavedBackground(){
  if(!selectedScanId||objectActive||removingSaved||managementBusy||pendingVisual?.background_removed)return;
  const id=selectedScanId;removingSaved=true;renderWorkflow();setStatus('Removendo o fundo da captura salva. Os originais serão preservados.');
  try{
    const response=await fetchWithTimeout('/api/scans/'+encodeURIComponent(id)+'/remove-background',{method:'POST'},180000),data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Não foi possível remover o fundo.');
    showObjectScan(data);setStatus('✓ Fundo removido. Confira as bordas recortadas nas fotos.');
  }catch(error){setStatus('Não foi possível processar a captura: '+error.message)}
  finally{removingSaved=false;renderWorkflow()}
}
function libraryScope(){return $('libraryScope').value==='archived'?'archived':'active'}
function managementBlocked(){
  return managementBusy||objectActive||objectBusy||cameraPending||removingSaved||workflow.phase==='saving'||
    shapeSaving||!!shapeSaveTimer||!!selectedScanId&&shapeSaveQueues.has(selectedScanId);
}
function renderObjectManager(){
  if(selectedScanId&&pendingVisual&&!!pendingVisual.archived!==(libraryScope()==='archived')&&!managementBlocked()){
    clearSelectedObject();return;
  }
  const selected=!!selectedScanId&&!!pendingVisual,blocked=managementBlocked();
  $('objectManager').hidden=!selected;
  $('savedObjectName').disabled=blocked;
  $('saveObjectName').disabled=!selected||blocked;
  $('archiveObject').hidden=!selected||!!pendingVisual.archived;
  $('restoreObject').hidden=!selected||!pendingVisual.archived;
  $('archiveObject').disabled=$('restoreObject').disabled=!selected||blocked;
  $('deleteObject').disabled=!selected||blocked;
  $('shapeForm').disabled=$('shapeWidth').disabled=$('shapeDepth').disabled=$('resetShape').disabled=managementBusy;
}
function rememberScan(data){
  const belongs=!!data.archived===(libraryDataScope==='archived');
  libraryScans=libraryScans.filter(scan=>scan.id!==data.id);
  if(belongs)libraryScans.push(data);
}
function updateSelectedMetadata(data,{preserveDraft=true}={}){
  if(data.id!==selectedScanId||!pendingVisual)return;
  const draft=$('savedObjectName').value,dirty=preserveDraft&&draft!==(pendingVisual.name||'Objeto sem nome');
  const options=shapeSaveTimer||shapeSaving?shapeOptions:normalizeShapeOptions(data.shape_options||pendingVisual.shape_options);
  pendingVisual={...pendingVisual,...data,shape_options:options};
  $('savedObjectName').value=dirty?draft:data.name||'Objeto sem nome';
  $('productName').textContent=data.name||'Objeto sem nome';renderObjectManager();
}
function clearSelectedObject(){
  clearTimeout(shapeSaveTimer);shapeSaveTimer=null;
  const pending=pendingShapeSave;pendingShapeSave=null;
  if(pending)void persistShapeOptions(pending.id,pending.options,pending.revision);
  shapeRevision++;shapeSaving=false;selectedScanId=null;pendingVisual=null;
  $('shapeControls').hidden=true;$('removeSavedBackground').hidden=true;
  $('productName').textContent='Selecione um objeto';$('productMeta').textContent='Abra uma captura da biblioteca para explorar.';
  $('codeBadge').textContent='PRÉVIA';$('viewerKind').textContent='DEMONSTRAÇÃO';$('viewerKind').classList.remove('saved');
  $('stageLabel').textContent='VITRINE 3D · ESTÚDIO';$('viewerNote').textContent='Suas capturas e seus ajustes permanecem salvos na biblioteca.';
  $('objectManageStatus').textContent='';$('savedObjectName').value='';
  productViewer?.showProduct?.();renderObjectManager();
}
function handleScanUpdated(data){
  if(!data?.id)return;
  rememberScan(data);
  if(data.id===selectedScanId&&!managementBusy&&!objectActive&&!removingSaved&&workflow.phase!=='saving'){
    if(!!data.archived!==(libraryScope()==='archived'))clearSelectedObject();
    else updateSelectedMetadata(data);
  }
  void loadLibrary(false);
}
async function manageSelectedObject(action){
  if(!selectedScanId||!pendingVisual||managementBlocked())return;
  const id=selectedScanId,request=++managementRequest;
  const name=String($('savedObjectName').value||'').trim();
  if(action==='rename'&&(!name||name.length>120)){
    $('objectManageStatus').textContent='Informe um nome de 1 a 120 caracteres.';return;
  }
  if(!['rename','archive','restore'].includes(action))return;
  managementBusy=true;
  $('objectManageStatus').textContent=action==='rename'?'Salvando o nome…':action==='archive'?'Arquivando o objeto…':'Restaurando o objeto…';
  renderWorkflow();renderObjectManager();
  try{
    const url='/api/scans/'+encodeURIComponent(id)+(action==='rename'?'':'/'+action);
    const options=action==='rename'?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}:{method:'POST'};
    const response=await fetchWithTimeout(url,options,10000),data=await response.json();
    if(!response.ok||!data.ok||data.id!==id)throw new Error(data.error||'Não foi possível atualizar o objeto.');
    rememberScan(data);
    if(action==='rename'){
      if(request===managementRequest&&id===selectedScanId){updateSelectedMetadata(data,{preserveDraft:false});$('objectManageStatus').textContent='Nome salvo nesta captura.'}
    }else{
      libraryNotice=action==='archive'?'Objeto arquivado. As imagens e os ajustes foram preservados.':'Objeto restaurado. Ele voltou à lista de ativos.';
      if(request===managementRequest&&id===selectedScanId&&!objectActive&&workflow.phase!=='saving')clearSelectedObject();
    }
    await loadLibrary(false);
  }catch(error){if(request===managementRequest&&id===selectedScanId)$('objectManageStatus').textContent='Não foi possível concluir: '+error.message+' Tente novamente.'}
  finally{if(request===managementRequest){managementBusy=false;renderWorkflow();renderObjectManager()}}
}
function handleScanDeleted(data){
  if(!data?.id)return;
  libraryScans=libraryScans.filter(scan=>scan.id!==data.id);
  if(deleteTargetId===data.id&&$('deleteObjectDialog').open)$('deleteObjectDialog').close();
  if(data.id===selectedScanId){
    clearTimeout(shapeSaveTimer);shapeSaveTimer=null;pendingShapeSave=null;
    clearSelectedObject();
  }
  libraryNotice='Objeto excluído da biblioteca.';
  void loadLibrary(false);
}
function openDeleteDialog(){
  if(!selectedScanId||!pendingVisual||managementBlocked())return;
  deleteTargetId=selectedScanId;
  $('deleteObjectName').textContent=pendingVisual.name||'Objeto sem nome';
  $('deletePassword').value='';$('deleteObjectError').textContent='';
  $('deleteObjectDialog').showModal();$('deletePassword').focus();
}
function setDeleteBusy(busy){
  $('deletePassword').disabled=$('cancelDeleteObject').disabled=$('confirmDeleteObject').disabled=busy;
  $('confirmDeleteObject').textContent=busy?'Excluindo…':'Excluir definitivamente';
}
async function confirmDeleteObject(event){
  event.preventDefault();
  const id=deleteTargetId;
  if(!id||id!==selectedScanId||managementBlocked())return;
  const password=$('deletePassword').value;
  $('deletePassword').value='';$('deleteObjectError').textContent='';
  managementBusy=true;setDeleteBusy(true);renderWorkflow();renderObjectManager();
  try{
    const response=await fetchWithTimeout('/api/scans/'+encodeURIComponent(id),{
      method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})
    },20000);
    const data=await response.json();
    if(!response.ok||!data.ok||data.id!==id)throw new Error(data.error||'Não foi possível excluir o objeto.');
    if($('deleteObjectDialog').open)$('deleteObjectDialog').close();
    handleScanDeleted(data);setStatus('Objeto excluído. As outras capturas foram preservadas.');
  }catch(error){
    $('deleteObjectError').textContent=error.message;
    if($('deleteObjectDialog').open)$('deletePassword').focus();
  }finally{
    managementBusy=false;setDeleteBusy(false);renderWorkflow();renderObjectManager();
    if($('deleteObjectDialog').open)$('deletePassword').focus();
  }
}
const emptyLibrary=$('scanLibrary').firstElementChild.cloneNode(true);
function renderLibrary(){
  const library=$('scanLibrary'),scope=libraryScope();
  const visible=filterAndSortScans(libraryScans,{query:$('librarySearch').value,sort:$('librarySort').value});
  library.replaceChildren();library.classList.toggle('has-items',visible.length>0);
  $('libraryCount').textContent=libraryLoaded?libraryScans.length:'—';
  const label=scope==='archived'?'arquivados':'ativos';
  $('libraryResultCount').textContent=(libraryNotice?libraryNotice+' ':'')+(libraryLoading?'Atualizando objetos…':visible.length+' de '+libraryScans.length+' objetos '+label+'.');
  if(!visible.length){
    if(libraryLoaded&&!libraryScans.length&&scope==='active'&&!String($('librarySearch').value||'').trim())library.append(emptyLibrary.cloneNode(true));
    else{
      const message=document.createElement('div');message.className='library-empty';
      message.textContent=libraryLoading?'Carregando os objetos salvos…':String($('librarySearch').value||'').trim()?'Nenhum objeto corresponde à busca. Ajuste o nome ou os filtros.':scope==='archived'?'Nenhum objeto arquivado. Os itens arquivados podem ser restaurados aqui.':'Nenhum objeto disponível.';
      library.append(message);
    }
    return visible;
  }
  for(const scan of visible){
    const card=document.createElement('button'),image=document.createElement('img'),title=document.createElement('strong'),meta=document.createElement('small'),count=document.createElement('span');
    card.className='scan-card';card.dataset.id=scan.id;card.setAttribute('aria-pressed',String(scan.id===selectedScanId));
    image.src=scan.views?.front||'';image.alt='Frente de '+(scan.name||'Objeto sem nome');image.loading='lazy';title.textContent=scan.name||'Objeto sem nome';
    count.className='scan-count';count.textContent=scan.archived?'ARQUIVADO':scan.background_removed?'SEM FUNDO':'6 VISTAS';
    meta.textContent=new Date(scan.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});card.append(image,count,title,meta);
    card.addEventListener('click',()=>{
      if(managementBlocked())return;
      showObjectScan(scan);$('viewerStage').scrollIntoView?.({behavior:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
    });library.append(card);
  }
  return visible;
}
async function loadLibrary(restore=true){
  const request=++libraryRequest,scope=libraryScope();
  if(scope!==libraryDataScope){libraryScans=[];libraryDataScope=scope;libraryLoaded=false}
  libraryLoading=true;renderLibrary();
  try{
    const response=await fetchWithTimeout('/api/scans'+(scope==='archived'?'?archived=1':''),{},10000),data=await response.json();
    if(!response.ok||!data.ok||!Array.isArray(data.scans))throw new Error('Falha ao carregar');
    if(request!==libraryRequest||scope!==libraryScope())return;
    libraryScans=data.scans;libraryLoaded=true;libraryLoading=false;
    const visible=renderLibrary();
    if(restore&&scope==='active'&&!pendingVisual&&!objectActive&&!managementBusy&&visible.length)showObjectScan(visible[0]);
  }catch(_){
    if(request!==libraryRequest||scope!==libraryScope())return;
    libraryLoading=false;renderLibrary();$('libraryResultCount').textContent='Não foi possível atualizar os objetos. Use Atualizar para tentar novamente.';
    if(!libraryLoaded){const library=$('scanLibrary');library.classList.remove('has-items');library.replaceChildren();const message=document.createElement('div');message.className='library-empty';message.textContent='Não foi possível carregar suas capturas. Use Atualizar para tentar novamente.';library.append(message)}
  }
}
async function startOrResumeCapture(){
  if(workflow.phase==='saving'||removingSaved||managementBusy||objectBusy)return;
  if(workflow.phase==='retry'){setStatus('As fotos estão mantidas. Use Reenviar capturas ou Novo objeto para recomeçar.');return}
  if(objectActive&&['preparing','capturing'].includes(workflow.phase)){
    const run=objectRun;
    if(stream?.getVideoTracks?.()[0]?.readyState==='ended'){stream.getTracks().forEach(track=>track.stop());stream=null}
    if(!stream)await startCamera();else{try{await video.play()}catch(_){setStatus('Use a câmera de fotos do celular para continuar.');return}}
    if(run!==objectRun||!objectActive||!stream)return;
    captureSource='video';clearTimeout(objectTimer);if(workflow.phase==='preparing')workflow.start();objectBusy=false;renderWorkflow();beginObjectStep();return;
  }
  if(workflow.phase==='done')resetCaptureWorkflow();
  await startObjectScan();
}
async function resumeVisibleCapture(){
  if(document.hidden){clearTimeout(objectTimer);return}
  if(!objectActive||objectBusy||captureSource!=='video'||!['preparing','capturing'].includes(workflow.phase))return;
  const run=objectRun;
  try{if(!stream||stream.getVideoTracks()[0].readyState==='ended')throw new Error('Câmera interrompida');await video.play()}
  catch(_){startBtn.disabled=false;setStatus('Toque em Escanear agora para retomar a câmera ou use Fotografar.');return}
  if(run!==objectRun||!objectActive)return;
  if(workflow.phase==='preparing')workflow.start();objectBusy=false;previousPixels=null;stability.reset();stepStarted=performance.now();renderWorkflow();
  objectTimer=setTimeout(analyzeObjectFrame,140);
}
startBtn.addEventListener('click',startOrResumeCapture);stopBtn.addEventListener('click',stopCamera);torchBtn.addEventListener('click',toggleTorch);
$('objectStart').addEventListener('click',startObjectScan);$('objectCancel').addEventListener('click',cancelObjectScan);$('objectCapture').addEventListener('click',()=>captureObjectView(true));$('objectRetry').addEventListener('click',uploadObjectScan);
$('quickCapture').addEventListener('click',()=>captureObjectView(true));
$('nativeCaptureLabel').addEventListener('click',prepareNativePhoto);
$('nativeCapture').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';void acceptNativePhoto(file)});
$('nativeCapture').addEventListener('cancel',()=>setStatus('Foto cancelada. Toque em Fotografar para tentar novamente ou em Escanear agora para voltar ao vídeo.'));
$('nextProduct').addEventListener('click',resetCaptureWorkflow);
$('newCapture').addEventListener('click',event=>{event.preventDefault();if(workflow.phase==='saving'||removingSaved||managementBusy)return;resetCaptureWorkflow();wrap.scrollIntoView({behavior:'smooth',block:'center'});void startOrResumeCapture()});
$('refreshLibrary').addEventListener('click',()=>loadLibrary());
$('librarySearch').addEventListener('input',()=>{libraryNotice='';renderLibrary()});
$('librarySort').addEventListener('change',()=>{libraryNotice='';renderLibrary()});
$('libraryScope').addEventListener('change',()=>{libraryNotice='';renderObjectManager();void loadLibrary(false)});
$('saveObjectName').addEventListener('click',()=>{void manageSelectedObject('rename')});
$('savedObjectName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void manageSelectedObject('rename')}});
$('archiveObject').addEventListener('click',()=>{void manageSelectedObject('archive')});
$('restoreObject').addEventListener('click',()=>{void manageSelectedObject('restore')});
$('deleteObject').addEventListener('click',openDeleteDialog);
$('deleteObjectForm').addEventListener('submit',event=>{void confirmDeleteObject(event)});
$('cancelDeleteObject').addEventListener('click',()=>{if(!managementBusy)$('deleteObjectDialog').close()});
$('deleteObjectDialog').addEventListener('cancel',event=>{if(managementBusy)event.preventDefault()});
$('deleteObjectDialog').addEventListener('close',()=>{deleteTargetId=null;$('deletePassword').value='';$('deleteObjectError').textContent=''});
$('removeSavedBackground').addEventListener('click',removeSavedBackground);
$('shapeForm').addEventListener('change',applyShapeControls);$('shapeWidth').addEventListener('input',applyShapeControls);$('shapeDepth').addEventListener('input',applyShapeControls);
$('resetShape').addEventListener('click',()=>{syncShapeControls({});applyShapeControls()});
window.addEventListener('pagehide',()=>{clearTimeout(objectTimer);if(stream&&captureSource==='video')stopCamera()});
document.addEventListener('visibilitychange',()=>{void resumeVisibleCapture()});
addEventListener('resize',fitGuide);video.addEventListener('resize',fitGuide);
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav-link').forEach(item=>item.classList.toggle('active',item===link))}));
import('./viewer.js?v=14').then(({createProductViewer})=>{productViewer=createProductViewer();if(pendingVisual)productViewer.showScan(pendingVisual.views,{backgroundRemoved:!!pendingVisual.background_removed,shapeOptions:pendingVisual.shape_options||{}})}).catch(()=>{$('viewerLoading').textContent='A visualização não pôde ser iniciada. Verifique o suporte a WebGL deste navegador, a conexão com o servidor e recarregue.';document.querySelectorAll('.viewer-toolbar button,[data-view],#clippingControls input,#clippingControls select,#clippingControls button').forEach(button=>button.disabled=true)});
renderWorkflow();loadLibrary();
