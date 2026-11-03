import {InferenceEngine,labelFor} from '../dist/engine.js';

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const native=globalThis.fieldlensDesktop||null;
const STORAGE='fieldlens-desktop-history-v2';
const PREFS='fieldlens-desktop-preferences';
const DEMOS=[
  {name:'maize_leaf_01.jpg',url:'./assets/sample-corn.jpg'},
  {name:'maize_sample_02.jpg',url:'./assets/sample-1.jpg'},
  {name:'maize_sample_03.jpg',url:'./assets/sample-2.jpg'},
  {name:'maize_sample_04.jpg',url:'./assets/sample-3.jpg'}
];
const state={photos:[],selected:0,view:'work',mode:'disease',zoom:1,tab:'image',busy:false,compare:false,
  prefs:{grid:true,motion:true,restore:true,lazy:true},statuses:{disease:null,pest:null}};
let toastTimeout,objectUrls=new Set();
const engine=new InferenceEngine(message=>setStatus(message,'busy'));
function setStatus(message,kind='ready'){
  $('.status').classList.remove('ready','busy','error');$('.status').classList.add(kind);
  $('#status-file').textContent=message;
  if(kind==='error')$('#analyse-tip').textContent=message;
  else if(kind==='busy')$('#analyse-tip').textContent=message;
  else $('#analyse-tip').textContent='模型在本地执行 · 首次使用下载并校验权重';
}
function toast(message){const e=$('#toast');e.textContent=String(message);e.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>e.classList.remove('show'),3400);}
function icon(name){return `<svg class="icon small"><use href="#i-${name}"></use></svg>`;}
function readPrefs(){try{return {...state.prefs,...JSON.parse(localStorage.getItem(PREFS)||'{}')};}catch{return state.prefs;}}
function savePrefs(){try{localStorage.setItem(PREFS,JSON.stringify(state.prefs));}catch{}}
function readHistory(){try{const d=JSON.parse(localStorage.getItem(STORAGE)||'[]');return Array.isArray(d)?d:[];}catch{return [];}}
function storeHistory(record){try{localStorage.setItem(STORAGE,JSON.stringify([record,...readHistory()].slice(0,120)));}catch(e){console.warn('History unavailable:',e);}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function showView(next){
  if(!['work','models','history','settings'].includes(next))return;
  state.view=next;
  $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===next));
  $('#workview').style.display=next==='work'?'flex':'none';
  $('#inspector').style.display=next==='work'?'flex':'none';
  $('#library').style.display=next==='work'?'flex':'none';
  $$('.page-alt').forEach(e=>e.classList.toggle('active',e.id==='page-'+next));
  if(next==='models')refreshModelStatuses();
  if(next==='history')renderHistory();
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
function selectedPhoto(){return state.photos[state.selected]||null;}
function safeName(file){return String(file?.name||'未命名图像').slice(0,180);}
function sourceDimensions(img){return {w:img.naturalWidth||img.width,h:img.naturalHeight||img.height};}
function resetResult(reason='尚未运行'){
  $('#empty-results').style.display='flex';$('#result-demo').style.display='none';
  $('#result-time').textContent=reason;
  $('#box-overlay').hidden=true;
  const cnv=$('#box-overlay');const ctx=cnv.getContext('2d');ctx.clearRect(0,0,cnv.width,cnv.height);
  $('#compare-view').classList.remove('visible');
  state.compare=false;$('#image-stage').classList.remove('compare-mode');
  state.tab='image';$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab==='image'));
}
function syncPhotoView(){
  const photo=selectedPhoto();
  if(!photo){$('#main-image').removeAttribute('src');$('#file-subtitle').textContent='尚未导入图片';$('#canvas-dims').textContent='NO IMAGE';$('#film-index').textContent='00 / 00';$('#count-badge').textContent='00 ITEMS';$('#main-image').alt='';$('#status-file').textContent='尚未选择图片';$('#analyse-btn').disabled=true;resetResult();return;}
  $('#main-image').src=photo.url;$('#main-image').alt='图像：'+photo.name;
  $('#file-subtitle').textContent=photo.name+'  ·  '+photo.w+' × '+photo.h+'  ·  '+photo.kind.toUpperCase();
  $('#canvas-dims').textContent=photo.w+' × '+photo.h+' PX  ·  FIT';
  $('#film-index').textContent=String(state.selected+1).padStart(2,'0')+' / '+String(state.photos.length).padStart(2,'0');
  $('#count-badge').textContent=String(state.photos.length).padStart(2,'0')+' ITEMS';
  $('#analyse-btn').disabled=state.busy;
  state.zoom=1;applyZoom();resetResult();
  $('#status-file').textContent='已选中 '+photo.name;
  if(photo.results?.[state.mode])renderResult(photo.results[state.mode]);
}
function createImg(src,className){const i=document.createElement('img');i.src=src;i.className=className;i.alt='';return i;}
function renderQueue(){
  const host=$('#task-list'),film=$('#film-items');host.replaceChildren();film.replaceChildren();
  state.photos.forEach((p,i)=>{
    const active=i===state.selected;
    const btn=document.createElement('button');btn.type='button';btn.className='task'+(active?' active':'');btn.dataset.photo=i;
    const label=document.createElement('span');label.className='task-text';
    const strong=document.createElement('strong');strong.textContent=p.name;
    const small=document.createElement('small');const dot=document.createElement('span');dot.className='task-state'+(active?' current':'');
    small.append(dot,document.createTextNode(p.results?.[state.mode]?'已分析':active?'当前查看 · '+p.w+'×'+p.h:'待分析'));
    label.append(strong,small);btn.append(createImg(p.url,'task-img'),label);
    btn.addEventListener('click',()=>selectPhoto(i));host.append(btn);
    const mini=document.createElement('button');mini.type='button';mini.className='film-item'+(active?' active':'');mini.dataset.film=i;
    const index=document.createElement('span');index.textContent=String(i+1).padStart(2,'0')+' · '+(active?'已选择':'图像');mini.append(createImg(p.url,''),index);
    mini.addEventListener('click',()=>selectPhoto(i));film.append(mini);
  });
  syncPhotoView();
}
function selectPhoto(i){if(state.busy||i<0||i>=state.photos.length)return;state.selected=i;renderQueue();}
async function loadDemoPhotos(){
  const loaded=[];
  for(const item of DEMOS){
    const image=new Image();image.src=item.url;
    try{await image.decode();const {w,h}=sourceDimensions(image);loaded.push({name:item.name,url:item.url,w,h,kind:'jpg',image,results:{},demo:true});}
    catch(e){console.warn('Sample image unavailable:',item.url,e);}
  }
  state.photos=loaded;state.selected=0;renderQueue();
  if(loaded.length)setStatus('本地样例已载入','ready');
}
async function addFiles(list){
  if(state.busy)return;
  const incoming=[...list].filter(f=>['image/jpeg','image/png','image/webp'].includes(f.type)&&f.size<100*1024*1024).slice(0,32);
  const originalLength=state.photos.length;
  for(const file of incoming){
    const url=URL.createObjectURL(file),image=new Image();image.src=url;
    try{await image.decode();const {w,h}=sourceDimensions(image);objectUrls.add(url);state.photos.push({name:safeName(file),url,w,h,kind:(file.name.split('.').pop()||'image').toLowerCase(),image,results:{},demo:false});}
    catch{URL.revokeObjectURL(url);toast('无法读取：'+safeName(file));}
  }
  if(state.photos.length>originalLength){state.selected=originalLength;renderQueue();setStatus('已导入 '+(state.photos.length-originalLength)+' 张图片','ready');}
  else if(list.length)toast('仅支持不超过 100 MB 的 JPG、PNG 或 WEBP 图片');
}
function clearQueue(){
  if(state.busy)return;
  if(!confirm('清空当前图像队列？已保存的分析记录不会删除。'))return;
  for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();
  state.photos=[];state.selected=0;renderQueue();setStatus('图像队列已清空','ready');
}
$('#file-input').addEventListener('change',async e=>{await addFiles(e.target.files||[]);e.target.value='';});
for(const id of ['import-btn','queue-new'])$("#"+id).addEventListener('click',()=>$('#file-input').click());
const stage=$('#image-stage');
stage.addEventListener('dragover',e=>{e.preventDefault();stage.classList.add('is-dragging');});
stage.addEventListener('dragleave',e=>{if(!stage.contains(e.relatedTarget))stage.classList.remove('is-dragging');});
stage.addEventListener('drop',async e=>{e.preventDefault();stage.classList.remove('is-dragging');await addFiles(e.dataTransfer?.files||[]);});
function applyZoom(){$('#image-wrap').style.transform='scale('+state.zoom.toFixed(2)+')';$('#zoom-label').textContent=Math.round(state.zoom*100)+'%';}
function zoomBy(delta){state.zoom=Math.min(2.4,Math.max(.45,state.zoom+delta));applyZoom();}
$('#zoom-in').addEventListener('click',()=>zoomBy(.1));$('#zoom-out').addEventListener('click',()=>zoomBy(-.1));
$('#fit-btn').addEventListener('click',()=>{state.zoom=1;applyZoom();});
$('#grid-btn').addEventListener('click',()=>{stage.classList.toggle('no-grid');$('#grid-btn').classList.toggle('tool-active');state.prefs.grid=!stage.classList.contains('no-grid');$('[data-toggle="grid"]').classList.toggle('on',state.prefs.grid);savePrefs();});
stage.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();zoomBy(e.deltaY<0?.05:-.05);}},{passive:false});
function setMode(next){
  if(!['disease','pest'].includes(next)||state.busy)return;
  state.mode=next;
  $$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===next));
  $('#current-model-name').textContent=next==='disease'?'DINOv2-B · Plant Disease':'YOLO11s · IP102';
  $('#current-model-desc').textContent=next==='disease'?'387 类状态 · 本地按需加载':'102 类害虫 · 目标检测';
  $('#threshold-field').style.display=next==='pest'?'block':'none';
  $('#crop').closest('.field').style.display=next==='disease'?'block':'none';
  if(state.prefs.restore)savePrefs();
  renderQueue();
}
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
$('#model-switch').addEventListener('click',()=>showView('models'));
$('#threshold').addEventListener('input',e=>{$('#threshold-value').textContent=Number(e.target.value).toFixed(2);for(const photo of state.photos)delete photo.results.pest;resetResult('阈值已修改');});
$('#crop').addEventListener('change',()=>{for(const photo of state.photos)delete photo.results.disease;resetResult('已修改筛选条件');});
async function fillCrops(){
  if(!native)return;
  try{
    const info=await engine.metadata('disease');
    const cropList=new Map();
    for(const raw of info.labels){
      const original=String(raw||'');const head=original.split('::')[0];if(head&&head!==original&&!cropList.has(head))cropList.set(head,labelFor(head+'::healthy').split(' · ')[0]);
    }
    const sel=$('#crop');sel.replaceChildren(new Option('自动判断',''));
    for(const raw of [...cropList.keys()].sort((a,b)=>a.localeCompare(b,'zh-CN')))sel.add(new Option(cropList.get(raw),raw));
  }catch(e){console.warn('Crop catalog unavailable',e);}
}
function selectedSource(){return selectedPhoto()?.image||null;}
function toPercentage(x){return (Math.max(0,Math.min(1,Number(x)||0))*100).toFixed(1)+'%';}
function makeResultRow(name,score){
  const row=document.createElement('div');row.className='prediction';
  const head=document.createElement('div');head.className='prediction-header';const label=document.createElement('span');label.textContent=name;
  const percentage=document.createElement('strong');percentage.textContent=toPercentage(score);head.append(label,percentage);
  const bar=document.createElement('div');bar.className='prediction-track';const fill=document.createElement('i');fill.style.width=toPercentage(score);bar.append(fill);row.append(head,bar);return row;
}
function renderResult(result){
  const summary=$('#result-items');summary.replaceChildren();
  $('#empty-results').style.display='none';$('#result-demo').style.display='block';
  $('#result-time').textContent='已完成';
  $('#runtime-ms').textContent=Math.round(result.elapsed)+' ms';$('#runtime-provider').textContent=result.backend;
  if(result.kind==='classification'){
    const top=result.predictions[0];$('#diagnosis-name').textContent=top?.name||'无有效结果';
    $('#diagnosis-note').textContent='图像级分类结果。概率只在模型包含的类别范围内计算。';
    for(const pred of result.predictions)summary.append(makeResultRow(pred.name,pred.score));
    $('#box-overlay').hidden=true;
  }else{
    const detections=result.detections;
    $('#diagnosis-name').textContent=detections.length?'检出 '+detections.length+' 个目标':'未检出目标';
    $('#diagnosis-note').textContent='检测框表示模型预测位置。未检出不代表图像中不存在害虫。';
    for(const d of detections.slice(0,40))summary.append(makeResultRow(d.name,d.score));
    if(!detections.length){const note=document.createElement('p');note.className='diagnosis-note';note.textContent='当前置信度阈值：'+$('#threshold-value').textContent;summary.append(note);}
    drawBoxes();
  }
}
function drawBoxes(){
  const photo=selectedPhoto(),result=photo?.results?.pest,canvas=$('#box-overlay');
  if(!photo||!result||!result.detections.length){canvas.hidden=true;return;}
  canvas.hidden=false;canvas.width=photo.w;canvas.height=photo.h;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,photo.w,photo.h);
  const font=Math.max(13,Math.round(Math.min(photo.w,photo.h)/42));ctx.font='600 '+font+'px Segoe UI, sans-serif';ctx.lineWidth=Math.max(2,font/8);ctx.textBaseline='top';
  for(const d of result.detections){
    const x=d.x1,y=d.y1,w=d.x2-d.x1,h=d.y2-d.y1,name=d.name+' '+toPercentage(d.score);
    ctx.strokeStyle='#edb581';ctx.strokeRect(x,y,w,h);
    const size=ctx.measureText(name).width;
    ctx.fillStyle='#20353ce8';ctx.fillRect(x,Math.max(0,y-font-11),size+14,font+10);
    ctx.fillStyle='#fff';ctx.fillText(name,x+7,Math.max(0,y-font-11)+4);
  }
}
async function analyse(){
  if(state.busy)return;
  const photo=selectedPhoto();if(!photo){toast('请先添加图片');return;}
  if(!native){toast('桌面运行环境不可用');return;}
  state.busy=true;$('#analyse-btn').disabled=true;$('#analyse-btn span').textContent='正在分析…';
  setStatus('正在载入模型并运行识别','busy');
  try{
    const mode=state.mode;
    const res=await engine.run(selectedSource(),mode,{crop:mode==='disease'?$('#crop').value:'',threshold:Number($('#threshold').value)});
    if(selectedPhoto()!==photo)return;
    photo.results[mode]=res;renderResult(res);setStatus('识别完成 · '+Math.round(res.elapsed)+' ms','ready');
    const predictions=res.kind==='classification'?res.predictions:res.detections;
    storeHistory({id:Date.now(),file:photo.name,mode,date:new Date().toISOString(),name:predictions[0]?.name||'未检出目标',score:predictions[0]?.score||0,ms:Math.round(res.elapsed),num:predictions.length,backend:res.backend});
    renderHistory();
  }catch(e){console.error('Inference failure',e);setStatus('识别失败：'+e.message,'error');toast('无法完成识别：'+e.message);}
  finally{state.busy=false;$('#analyse-btn').disabled=!selectedPhoto();$('#analyse-btn span').textContent='运行识别';}
}
$('#analyse-btn').addEventListener('click',analyse);
function drawExport(){
  const photo=selectedPhoto();if(!photo)return null;
  const canvas=document.createElement('canvas');canvas.width=photo.w;canvas.height=photo.h;
  const ctx=canvas.getContext('2d');ctx.drawImage(photo.image,0,0,photo.w,photo.h);
  const result=photo.results?.pest;
  if(result?.detections?.length){
    const overlay=$('#box-overlay');drawBoxes();ctx.drawImage(overlay,0,0,photo.w,photo.h);
  }
  return canvas;
}
$('#export-btn').addEventListener('click',()=>{const canvas=drawExport();if(!canvas){toast('请先选择图片');return;}canvas.toBlob(blob=>blob?downloadBlob(blob,'fieldlens-'+Date.now()+'.png'):toast('导出失败'),'image/png');});
$('#compare-btn').addEventListener('click',()=>{
  const photo=selectedPhoto();if(!photo){toast('请先选择图片');return;}
  if(!photo.results?.[state.mode]){toast('请先完成识别，再对比原图和分析画面');return;}
  state.compare=!state.compare;$('#image-stage').classList.toggle('compare-mode',state.compare);
  if(state.compare){$('#compare-original').src=photo.url;const exp=drawExport();if(exp){const c=$('#compare-canvas');c.width=exp.width;c.height=exp.height;c.getContext('2d').drawImage(exp,0,0);}}
  $('#compare-btn').classList.toggle('tool-active',state.compare);
});
$$('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  state.tab=button.dataset.tab;$$('[data-tab]').forEach(x=>x.classList.toggle('active',x===button));
  if(state.tab==='results'){
    const p=selectedPhoto();if(p?.results?.[state.mode])renderResult(p.results[state.mode]);
    else toast('请先运行识别');
  }else if(state.compare){state.compare=false;$('#image-stage').classList.remove('compare-mode');}
}));
function renderHistory(){
  const records=readHistory(),host=$('#history-body');host.replaceChildren();
  $('#history-count').textContent=records.length+' 条';$('#history-empty').hidden=records.length>0;
  for(const record of records){
    const tr=document.createElement('tr');
    const file=document.createElement('td');file.textContent=record.file||'—';
    const label=document.createElement('td');label.textContent=record.name||'—';
    const stateCell=document.createElement('td');stateCell.textContent=record.mode==='pest'?'害虫检测':'病害分类';
    const when=document.createElement('td');when.textContent=new Date(record.date).toLocaleString('zh-CN');
    tr.append(file,label,stateCell,when);host.append(tr);
  }
}
function exportHistory(){const records=readHistory();if(!records.length){toast('没有可以导出的识别记录');return;}downloadBlob(new Blob([JSON.stringify(records,null,2)],{type:'application/json'}),'fieldlens-history.json');}
function refreshModelStatuses(){
  for(const key of ['disease','pest'])refreshModel(key);
  if(native?.getRuntimeInfo){native.getRuntimeInfo().then(d=>{$('#device-info').textContent=d.platform+' / '+d.arch;$('#available-device').textContent='CPU / 可选 WebGPU';}).catch(()=>{});}
}
async function refreshModel(key){
  const row=$(`[data-model-row="${key}"]`),btn=row?.querySelector('[data-download]');if(!row||!btn)return;
  if(!native){btn.textContent='仅限桌面端';btn.disabled=true;return;}
  try{const status=await native.modelStatus(key);state.statuses[key]=status;
    btn.textContent=status.cached?'重新校验':'下载与校验';
    const label=row.querySelector('.download-detail')||document.createElement('div');label.className='download-detail';
    label.textContent=status.cached?'已下载 · '+(status.size/1048576).toFixed(1)+' MiB':'尚未下载 · 首次使用按需获取';
    row.querySelector('.tag-row')?.after(label);
  }catch(e){btn.textContent='检查连接';console.warn('Model status failed',e);}
}
async function downloadModel(key){
  const btn=$(`[data-download="${key}"]`);if(!native||btn.disabled)return;
  btn.disabled=true;btn.textContent='正在校验…';
  try{await native.ensureModel(key);btn.textContent='已完成';setStatus('模型已下载并校验：'+(key==='disease'?'病害分类':'害虫检测'),'ready');await refreshModel(key);}
  catch(e){btn.textContent='重试下载';setStatus('模型下载失败：'+e.message,'error');toast(e.message);}
  finally{btn.disabled=false;}
}
$$('[data-download]').forEach(button=>button.addEventListener('click',()=>downloadModel(button.dataset.download)));
native?.onProgress?.(payload=>{
  if(!payload||!['disease','pest'].includes(payload.key))return;
  const row=$(`[data-model-row="${payload.key}"]`),button=row?.querySelector('[data-download]');if(!button)return;
  const pct=payload.total?Math.min(100,payload.received/payload.total*100):0;
  button.textContent=payload.total?Math.round(pct)+'%':'下载中…';
  let track=row.querySelector('.progress-track');if(!track){track=document.createElement('div');track.className='progress-track';track.append(document.createElement('i'));row.querySelector('.download-detail')?.after(track);}
  track.hidden=!payload.total;track.firstElementChild.style.width=pct+'%';
  const loaded=(payload.received/1048576).toFixed(1)+' MiB',total=payload.total?' / '+(payload.total/1048576).toFixed(1)+' MiB':'';
  setStatus('模型下载：'+loaded+total,'busy');
});
function handleSetting(name,on){
  state.prefs[name]=on;savePrefs();
  if(name==='grid'){stage.classList.toggle('no-grid',!on);$('#grid-btn').classList.toggle('tool-active',on);}
  if(name==='motion')$('.app').classList.toggle('muted-motion',!on);
}
$$('[data-toggle]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.toggle;const next=!button.classList.contains('on');button.classList.toggle('on',next);button.setAttribute('aria-pressed',String(next));handleSetting(key,next);}));
$$('[data-action]').forEach(button=>button.addEventListener('click',()=>{switch(button.dataset.action){case 'refresh-models':refreshModelStatuses();toast('已刷新本地模型状态');break;case 'export-history':exportHistory();break;case 'settings':showView('settings');break;}}));
$$('[data-menu]').forEach(button=>button.addEventListener('click',()=>{
  switch(button.dataset.menu){
    case 'open':$('#file-input').click();break;
    case 'clear':clearQueue();break;
    case 'fit':state.zoom=1;applyZoom();showView('work');break;
    case 'help':toast('快捷键：Ctrl+O 导入 · Ctrl+Enter 分析 · Ctrl+加减 缩放');break;
  }
}));
$$('[data-window]').forEach(button=>button.addEventListener('click',()=>{
  if(native?.windowControl)native.windowControl(button.dataset.window);
  else toast('窗口控制仅在安装后的桌面程序中可用');
}));
window.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();$('#file-input').click();}
  if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();analyse();}
  if((event.ctrlKey||event.metaKey)&&(event.key==='+'||event.key==='=')){event.preventDefault();zoomBy(.1);}
  if((event.ctrlKey||event.metaKey)&&event.key==='-'){event.preventDefault();zoomBy(-.1);}
  if(event.key==='Escape'&&state.compare){state.compare=false;stage.classList.remove('compare-mode');}
});
window.addEventListener('beforeunload',()=>{for(const url of objectUrls)URL.revokeObjectURL(url);});

async function init(){
  state.prefs=readPrefs();
  $$('[data-toggle]').forEach(b=>{const on=!!state.prefs[b.dataset.toggle];b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  stage.classList.toggle('no-grid',!state.prefs.grid);$('.app').classList.toggle('muted-motion',!state.prefs.motion);
  if(state.prefs.restore){try{const mode=localStorage.getItem('fieldlens-desktop-last-mode');if(mode==='pest')state.mode='pest';}catch{}}
  await loadDemoPhotos();setMode(state.mode);
  if(native){refreshModelStatuses();fillCrops();}
  else{setStatus('设计界面可预览 · 推理需在桌面程序中运行','ready');}
  showView('work');renderHistory();
}
// Keep the last selected task across desktop sessions without changing Web settings.
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{try{localStorage.setItem('fieldlens-desktop-last-mode',state.mode);}catch{}}));
init().catch(error=>{console.error(error);setStatus('界面加载失败：'+error.message,'error');});
