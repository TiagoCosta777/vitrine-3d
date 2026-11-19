import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {fitModelCamera,normalizeShapeOptions} from './viewer-logic.mjs?v=4';
import {buildObjectShape} from './object-shape.mjs?v=3';
import {normalizeClippingOptions,clippingPlaneForBounds} from './clipping-logic.mjs?v=1';

const $ = id => document.getElementById(id);
const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'];

// The sample is drawn locally and clearly marked as a demonstration in the UI.
function sampleTexture(face) {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 960;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8c8a3'; ctx.fillRect(0, 0, 640, 960);
  ctx.fillStyle = '#ebe3cf'; ctx.fillRect(0, 45, 640, 730);
  ctx.fillStyle = '#52634c';
  ctx.font = '500 24px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('S T U D I O   /   O B J E C T S', 320, 117);
  ctx.fillRect(285, 153, 70, 2);
  if (face === 'front') {
    ctx.font = 'bold 114px Georgia, serif'; ctx.fillText('café', 320, 345);
    ctx.font = '26px sans-serif'; ctx.fillText('ESPECIAL', 320, 401);
    ctx.strokeStyle = '#657656'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.translate(250 + i * 70, 560 + (i % 2) * 30); ctx.rotate(-.5 + i * .35);
      ctx.beginPath(); ctx.ellipse(0, 0, 30, 47, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -36); ctx.bezierCurveTo(-25, -8, 25, 8, 0, 36); ctx.stroke(); ctx.restore();
    }
    ctx.font = '21px sans-serif'; ctx.fillText('TORRA MÉDIA · 100% ARÁBICA', 320, 707);
  } else if (face === 'back') {
    ctx.font = '40px Georgia, serif'; ctx.fillText('Feito para', 320, 310); ctx.fillText('bons momentos.', 320, 365);
    ctx.font = '22px sans-serif';
    ['Notas de chocolate e caramelo.', 'Um ritual para o seu dia.', '', 'EMBALAGEM DE DEMONSTRAÇÃO'].forEach((line, i) => ctx.fillText(line, 320, 455 + i * 43));
    ctx.fillStyle = '#52634c';
    for (let i = 0; i < 55; i++) if (i % 3 !== 1) ctx.fillRect(190 + i * 5, 645, i % 2 ? 2 : 4, 65);
  } else {
    ctx.font = 'bold 72px Georgia, serif'; ctx.fillText('café', 320, 380);
    ctx.font = '21px sans-serif'; ctx.fillText('ORIGEM BRASILEIRA', 320, 465);
    ctx.fillText('CUIDADO EM CADA DETALHE', 320, 525);
  }
  ctx.fillStyle = '#52634c'; ctx.fillRect(0, 775, 640, 185);
  ctx.fillStyle = '#ebe3cf'; ctx.font = '28px sans-serif'; ctx.fillText('NATURALMENTE BOM.', 320, 850);
  ctx.font = '23px sans-serif'; ctx.fillText('250 g', 320, 908);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createProductViewer() {
  const host = $('viewer3d');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 80);
  const home = new THREE.Vector3(4.5, 2.8, 6.8);
  let homeDistance = home.length();
  const modelCenter = new THREE.Vector3();
  camera.position.copy(home);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.domElement.setAttribute('aria-label', 'Visualização interativa do produto');
  host.append(renderer.domElement); $('viewerLoading').hidden = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xbfcbd2, 1.8));
  const key = new THREE.DirectionalLight(0xfffbf5, 3.1);
  key.position.set(4, 7, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5;
  key.shadow.normalBias = .025; key.shadow.radius = 5; scene.add(key);
  const fill = new THREE.DirectionalLight(0xe9f3ff, .9); fill.position.set(-4, 3, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1); rim.position.set(2, 4, -5); scene.add(rim);

  const product = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.9, 1.18), FACE_ORDER.map(face => new THREE.MeshStandardMaterial({map:sampleTexture(face),roughness:.82})));
  product.castShadow = true; scene.add(product);
  let clipping=normalizeClippingOptions();
  const clipPlane=new THREE.Plane(new THREE.Vector3(1,0,0),0),clipPlanes=[clipPlane];
  const clipHelper=new THREE.PlaneHelper(clipPlane,3.3,0x8061c0);
  clipHelper.visible=false;clipHelper.traverse(object=>{
    if(object.material){object.material.transparent=true;object.material.opacity=object.isMesh ? .12 : .65;object.material.depthWrite=false}
  });scene.add(clipHelper);
  let shapeImages=null,shapeModel=null,shapeUniforms=null,shapeOptions=normalizeShapeOptions(),displayMode='photos';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x77658e, opacity: .13 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.46; floor.receiveShadow = true; scene.add(floor);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .085;
  controls.minDistance = 3.7; controls.maxDistance = 15;
  controls.enablePan = false; controls.rotateSpeed = .75; controls.zoomSpeed = .7;
  controls.autoRotate = false; controls.autoRotateSpeed = 1.4;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  function setDisplayMode(mode){
    displayMode=mode==='shape'?'shape':'photos';
    if(shapeUniforms)shapeUniforms.shapePhotoMix.value=displayMode==='photos'?1:0;
    document.querySelectorAll('[data-display]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.display===displayMode)));
  }
  function updateClipping(){
    product.updateMatrixWorld(true);
    const plane=clippingPlaneForBounds(new THREE.Box3().setFromObject(product),clipping);
    clipPlane.normal.set(plane.normal.x,plane.normal.y,plane.normal.z);clipPlane.constant=plane.constant;
    clipHelper.size=plane.helperSize;clipHelper.visible=clipping.enabled&&product.visible;
    for(const material of (Array.isArray(product.material)?product.material:[product.material])){
      const wasEnabled=!!material.clippingPlanes?.length,side=clipping.enabled?THREE.DoubleSide:THREE.FrontSide;
      const recompile=wasEnabled!==clipping.enabled||material.side!==side;
      material.clippingPlanes=clipping.enabled?clipPlanes:null;material.clipShadows=clipping.enabled;material.side=side;
      if(recompile)material.needsUpdate=true;
    }
    $('clipEnabled').checked=clipping.enabled;$('clipAxis').value=clipping.axis;
    $('clipPosition').value=Math.round(clipping.position*100);$('clipPositionValue').textContent=Math.round(clipping.position*100)+'%';
    $('clipSide').setAttribute('aria-pressed',String(clipping.inverted));
    for(const id of ['clipAxis','clipPosition','clipSide'])$(id).disabled=!clipping.enabled;
    $('clipStatus').textContent=clipping.enabled?`Plano ${clipping.axis.toUpperCase()} · posição ${Math.round(clipping.position*100)}% · lado ${clipping.inverted?'negativo':'positivo'} visível.`:'Clipping desligado. Ative para explorar o modelo por um plano de corte.';
  }
  function resetClipping(){clipping=normalizeClippingOptions();updateClipping()}
  $('clipEnabled').addEventListener('change',()=>{clipping=normalizeClippingOptions({...clipping,enabled:$('clipEnabled').checked});updateClipping()});
  $('clipAxis').addEventListener('change',()=>{clipping=normalizeClippingOptions({...clipping,axis:$('clipAxis').value});updateClipping()});
  $('clipPosition').addEventListener('input',()=>{clipping=normalizeClippingOptions({...clipping,position:Number($('clipPosition').value)/100});updateClipping()});
  $('clipSide').addEventListener('click',()=>{clipping=normalizeClippingOptions({...clipping,inverted:!clipping.inverted});updateClipping()});
  $('clipReset').addEventListener('click',resetClipping);
  document.querySelectorAll('[data-display]').forEach(button=>button.addEventListener('click',()=>setDisplayMode(button.dataset.display)));

  function feedback(message) { $('viewerFeedback').textContent = message; $('viewerFeedback').hidden = !message; }
  function selectView(name) {
    document.querySelectorAll('[data-view]').forEach(button => {
      const selected = button.dataset.view === name;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
  }
  function stopRotation() { controls.autoRotate = false; $('autoRotate').setAttribute('aria-pressed', 'false'); }
  controls.addEventListener('start', () => { stopRotation(); selectView(''); host.focus({preventScroll:true}); });
  controls.addEventListener('change', () => { $('viewerZoom').value = Math.round(homeDistance / controls.getDistance() * 100) + '%'; });
  function setView(name = 'perspective') {
    // Flush residual damping so resets and exact face views remain stable.
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
    stopRotation(); controls.target.copy(modelCenter);
    camera.up.set(0, 1, 0);
    const positions = { perspective: home, front: [0, 0, homeDistance], back: [0, 0, -homeDistance], top: [0, homeDistance, .001] };
    const position = positions[name] || home;
    if (position.isVector3) camera.position.copy(position); else camera.position.set(...position);
    camera.position.add(modelCenter);
    controls.update(); selectView(name);
  }
  function zoom(factor) {
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset); controls.update();
  }
  $('zoomIn').addEventListener('click', () => zoom(.85));
  $('zoomOut').addEventListener('click', () => zoom(1 / .85));
  $('resetView').addEventListener('click', () => setView());
  $('autoRotate').addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; $('autoRotate').setAttribute('aria-pressed', String(controls.autoRotate)); if (controls.autoRotate) selectView(''); });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewerStage').requestFullscreen(); }
    catch { feedback('Tela cheia indisponível neste navegador. Você pode continuar usando os controles aqui.'); }
  });
  if (!$('viewerStage').requestFullscreen) $('fullscreen').hidden = true;
  document.addEventListener('fullscreenchange', () => { $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia'); });
  host.addEventListener('keydown', event => {
    if (event.target !== host) return;
    if (event.key === '+' || event.key === '=') zoom(.9);
    else if (event.key === '-') zoom(1 / .9);
    else if (event.key === 'Home') setView();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      stopRotation(); selectView('');
      const sphere = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (event.key === 'ArrowLeft') sphere.theta -= .12;
      if (event.key === 'ArrowRight') sphere.theta += .12;
      if (event.key === 'ArrowUp') sphere.phi -= .12;
      if (event.key === 'ArrowDown') sphere.phi += .12;
      sphere.makeSafe(); camera.position.setFromSpherical(sphere).add(controls.target); controls.update();
    } else return;
    event.preventDefault();
  });
  function fitCamera(reset=false) {
    const oldDistance=controls.getDistance(),ratio=homeDistance/Math.max(oldDistance,.001);
    const direction=camera.position.clone().sub(controls.target).normalize();
    product.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(product),size=box.getSize(new THREE.Vector3());
    box.getCenter(modelCenter);
    const fit=fitModelCamera({width:size.x,height:size.y,depth:size.z},camera.aspect,{fov:camera.fov,padding:1.13,framing:'bounds',direction:{x:3.1,y:1.8,z:7.8}});
    home.set(fit.position.x,fit.position.y,fit.position.z);homeDistance=fit.distance;
    controls.minDistance=fit.minDistance;controls.maxDistance=fit.maxDistance;
    camera.far=Math.max(80,fit.maxDistance+fit.radius+1);camera.updateProjectionMatrix();
    controls.target.copy(modelCenter);
    const shadowExtent=Math.max(size.x,size.y,size.z)*.7+1;
    key.shadow.camera.left=key.shadow.camera.bottom=-shadowExtent;
    key.shadow.camera.right=key.shadow.camera.top=shadowExtent;key.shadow.camera.updateProjectionMatrix();
    if(reset)setView();
    else{
      const distance=THREE.MathUtils.clamp(homeDistance/ratio,controls.minDistance,controls.maxDistance);
      camera.position.copy(modelCenter).addScaledVector(direction,distance);controls.update();
    }
    updateClipping();
  }
  const observer = new ResizeObserver(() => {
    const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();fitCamera();
  });observer.observe(host);
  let visible=true;
  if(window.IntersectionObserver)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting}).observe(host);
  let previous=performance.now();
  renderer.setAnimationLoop(now=>{
    if(document.hidden||!visible){previous=now;return}
    if(now-previous<30)return;
    const dt=Math.min((now-previous)/1000,.1);previous=now;
    controls.update(dt);renderer.render(scene,camera);
  });

  let generation=0,pendingShapeLoad=null;
  function dispose(materials){
    const maps=new Set();
    (Array.isArray(materials)?materials:[materials]).forEach(material=>{
      if(material.map)maps.add(material.map);
      (material.userData.projectionTextures||[]).forEach(texture=>maps.add(texture));material.dispose();
    });maps.forEach(texture=>texture.dispose());
  }
  function geometryFor(model){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(model.positions,3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(model.indices),1));
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
  }
  function readImages(textures){
    return Object.fromEntries(FACE_ORDER.map((face,index)=>{
      const image=textures[index].image,width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
      const scale=Math.min(1,320/Math.max(width,height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
      return [face,context.getImageData(0,0,canvas.width,canvas.height)];
    }));
  }
  function projectionMaterial(textures,model,images){
    const uniforms={shapeDimensions:{value:new THREE.Vector3(model.dimensions.width,model.dimensions.height,model.dimensions.depth)},shapeScale:{value:new THREE.Vector3(1,1,1)},shapePhotoMix:{value:displayMode==='photos'?1:0},shapeClay:{value:new THREE.Color('#95b9b7')}};
    let red=0,green=0,blue=0,count=0;
    FACE_ORDER.forEach((face,index)=>{
      const name=face[0].toUpperCase()+face.slice(1);
      uniforms['shape'+name]={value:textures[index]};uniforms['rect'+name]={value:new THREE.Vector4(...model.bounds[face].uv)};
      const pixels=images[face].data;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>160){red+=pixels[i];green+=pixels[i+1];blue+=pixels[i+2];count++}
    });
    uniforms.shapeFallback={value:new THREE.Color(count?red/count/255:.8,count?green/count/255:.8,count?blue/count/255:.8).convertSRGBToLinear()};
    const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:0});
    material.userData.projectionTextures=textures;
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader='varying vec3 vShapePosition;\nvarying vec3 vShapeNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvShapePosition=position;\nvShapeNormal=normal;');
      shader.fragmentShader=`varying vec3 vShapePosition;
varying vec3 vShapeNormal;
uniform vec3 shapeDimensions;
uniform vec3 shapeScale;
uniform vec3 shapeFallback;
uniform float shapePhotoMix;
uniform vec3 shapeClay;
uniform sampler2D shapeFront; uniform sampler2D shapeBack;
uniform sampler2D shapeRight; uniform sampler2D shapeLeft;
uniform sampler2D shapeTop; uniform sampler2D shapeBottom;
uniform vec4 rectFront; uniform vec4 rectBack;
uniform vec4 rectRight; uniform vec4 rectLeft;
uniform vec4 rectTop; uniform vec4 rectBottom;
vec2 shapeUV(vec2 point,vec4 rect){return mix(rect.xy,rect.zw,clamp(point,0.0,1.0));}
`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
vec3 shapeP=vShapePosition/shapeDimensions;
vec3 shapeN=normalize(vShapeNormal/shapeScale);
vec3 shapeW=pow(abs(shapeN),vec3(8.0));shapeW/=max(shapeW.x+shapeW.y+shapeW.z,0.0001);
vec4 shapeX;
if(shapeN.x>=0.0)shapeX=texture2D(shapeRight,shapeUV(vec2(0.5-shapeP.z,shapeP.y+0.5),rectRight));
else shapeX=texture2D(shapeLeft,shapeUV(vec2(shapeP.z+0.5,shapeP.y+0.5),rectLeft));
vec4 shapeY;
if(shapeN.y>=0.0)shapeY=texture2D(shapeTop,shapeUV(vec2(shapeP.x+0.5,0.5-shapeP.z),rectTop));
else shapeY=texture2D(shapeBottom,shapeUV(vec2(shapeP.x+0.5,shapeP.z+0.5),rectBottom));
vec4 shapeZ;
if(shapeN.z>=0.0)shapeZ=texture2D(shapeFront,shapeUV(vec2(shapeP.x+0.5,shapeP.y+0.5),rectFront));
else shapeZ=texture2D(shapeBack,shapeUV(vec2(0.5-shapeP.x,shapeP.y+0.5),rectBack));
float shapeA=shapeW.x*shapeX.a+shapeW.y*shapeY.a+shapeW.z*shapeZ.a;
vec3 shapeColor=shapeW.x*shapeX.rgb*shapeX.a+shapeW.y*shapeY.rgb*shapeY.a+shapeW.z*shapeZ.rgb*shapeZ.a;
vec3 shapePhotoColor=shapeA>0.02?shapeColor/max(shapeA,0.0001):shapeFallback;
diffuseColor.rgb*=mix(shapeClay,shapePhotoColor,shapePhotoMix);
`);
    };material.customProgramCacheKey=()=> 'object-shape-projection-v14';return {material,uniforms};
  }
  function updateShape(options){
    const normalized=normalizeShapeOptions(options);
    if(pendingShapeLoad?.run===generation)pendingShapeLoad.options=normalized;
    if(!shapeImages||!shapeModel){shapeOptions=normalized;return normalized}
    if(normalized.form!==shapeOptions.form){
      const next=buildObjectShape(shapeImages,{form:normalized.form}),geometry=geometryFor(next);
      product.geometry.dispose();product.geometry=geometry;shapeModel=next;
      shapeUniforms.shapeDimensions.value.set(next.dimensions.width,next.dimensions.height,next.dimensions.depth);
    }
    shapeOptions=normalized;product.scale.set(normalized.widthScale,1,normalized.depthScale);
    shapeUniforms.shapeScale.value.copy(product.scale);fitCamera();return normalized;
  }
  async function load(urls,{backgroundRemoved=false,shapeOptions:options={}}={}){
    const run=++generation,request={run,options:normalizeShapeOptions(options)};pendingShapeLoad=request;
    feedback(backgroundRemoved?'Construindo o volume pelos contornos…':'Carregando as vistas…');
    if(urls.length!==6||urls.some(url=>typeof url!=='string'||!url)){pendingShapeLoad=null;feedback('Esta captura não contém as seis fotos. Selecione outra captura.');return false}
    const results=await Promise.allSettled(urls.map(url=>new THREE.TextureLoader().loadAsync(url)));
    const textures=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
    if(run!==generation){textures.forEach(texture=>texture.dispose());return false}
    if(results.some(result=>result.status==='rejected')){pendingShapeLoad=null;textures.forEach(texture=>texture.dispose());feedback('Não foi possível carregar as fotos. A prévia anterior foi mantida.');return false}
    let nextGeometry,nextMaterial,nextImages=null,nextModel=null,nextUniforms=null;
    // Controls can change while six images are downloading on a mobile link.
    const normalized=request.options;
    try{
      textures.forEach(texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy())});
      if(backgroundRemoved){
        nextImages=readImages(textures);nextModel=buildObjectShape(nextImages,{form:normalized.form});nextGeometry=geometryFor(nextModel);
        const projection=projectionMaterial(textures,nextModel,nextImages);nextMaterial=projection.material;nextUniforms=projection.uniforms;
      }else{nextGeometry=new THREE.BoxGeometry(1.9,2.9,1.18);nextMaterial=textures.map(texture=>new THREE.MeshStandardMaterial({map:texture,roughness:.85}))}
    }catch(error){pendingShapeLoad=null;nextGeometry?.dispose();textures.forEach(texture=>texture.dispose());feedback('Não consegui gerar o volume destas fotos. Confira se as seis vistas mostram o objeto inteiro.');return false}
    dispose(product.material);product.geometry.dispose();product.material=nextMaterial;product.geometry=nextGeometry;
    shapeImages=nextImages;shapeModel=nextModel;shapeUniforms=nextUniforms;shapeOptions=normalized;
    product.scale.set(backgroundRemoved?normalized.widthScale:1,1,backgroundRemoved?normalized.depthScale:1);
    if(shapeUniforms)shapeUniforms.shapeScale.value.copy(product.scale);
    product.visible=true;renderer.domElement.setAttribute('aria-label',backgroundRemoved?'Modelo 3D aproximado do objeto. Arraste para girar e use o zoom para ver os detalhes.':'Prévia ilustrativa das seis fotos sobre uma caixa');
    $('viewerModes').hidden=!backgroundRemoved;setDisplayMode(displayMode);
    pendingShapeLoad=null;resetClipping();fitCamera(true);feedback(nextModel?.diagnostics.warnings.join(' ')||'');return true;
  }
  fitCamera(true);
  return {
    showScan:(views,options={})=>load(FACE_ORDER.map(face=>views?.[face]),options),
    setShapeOptions:updateShape,
    async showProduct(url){
      if(url)return load(FACE_ORDER.map(()=>url));
      generation++;pendingShapeLoad=null;shapeImages=null;shapeModel=null;shapeUniforms=null;shapeOptions=normalizeShapeOptions();
      dispose(product.material);product.geometry.dispose();product.geometry=new THREE.BoxGeometry(1.9,2.9,1.18);
      product.material=FACE_ORDER.map(face=>new THREE.MeshStandardMaterial({map:sampleTexture(face),roughness:.82}));product.scale.set(1,1,1);
      $('viewerModes').hidden=true;
      resetClipping();
      product.visible=true;feedback('');fitCamera(true);return true;
    }
  };
}
