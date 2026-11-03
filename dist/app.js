import {InferenceEngine,labelFor} from './engine.js';

const el=id=>document.getElementById(id);
const engine=new InferenceEngine(message=>setStatus(message,'busy'));
const storageKey='fieldlens-records-v2';
const state={model:'disease',source:null,mediaURL:null,file:null,result:null,busy:false};
const viewNames={inspect:'识别分析',records:'历史记录',models:'模型信息',about:'使用说明'};
const desktop=Boolean(globalThis.fieldlensDesktop);
let toastTimer=null;

function setStatus(message,tone='idle'){
  el('status-text').textContent=message;
  el('status-dot').className='inline-status-icon '+(tone==='busy'?'busy':tone==='ok'?'ok':'');
}
function toast(message){
  const node=el('toast');node.textContent=message;node.classList.add('visible');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>node.classList.remove('visible'),3300);
}
function setView(view){
  if(!viewNames[view])return;
  document.querySelectorAll('.view').forEach(node=>node.classList.toggle('active',node.id==='view-'+view));
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  el('page-name').textContent=viewNames[view];
  el('rail').classList.remove('open');
  history.replaceState(null,'','#'+view);
  window.scrollTo({top:0,behavior:'smooth'});
  if(view==='records')renderRecords();
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
document.querySelectorAll('[data-use]').forEach(button=>button.addEventListener('click',()=>{chooseModel(button.dataset.use);setView('inspect');}));
el('menu-button').addEventListener('click',()=>el('rail').classList.toggle('open'));
document.addEventListener('click',event=>{if(window.innerWidth<930&&!event.target.closest('.rail')&&!event.target.closest('#menu-button'))el('rail').classList.remove('open');});

function dateText(){
  try{return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'long'}).format(new Date());}
  catch{return '2026';}
}
el('date-text').textContent=dateText();
el('runtime-label').textContent=desktop?'WINDOWS / LOCAL':'BROWSER / LOCAL';
el('footer-runtime').textContent=desktop?'ONNX RUNTIME · WINDOWS':'ONNX RUNTIME · WEB';
el('rail-runtime').textContent=desktop?'Windows 本地推理':'浏览器本地推理';
if(desktop){
  el('disease-description').textContent='59 种作物、387 个作物及病害状态类别。图像分类，不提供病斑边界框。';
  el('disease-count').textContent='387';
}
function clearResult(){
  state.result=null;
  el('results').classList.add('hidden');
  el('result-placeholder').classList.remove('hidden');
  el('output-state').innerHTML='<i></i> 待运行';
}
function chooseModel(key){
  if(!['disease','pest'].includes(key)||state.busy)return;
  state.model=key;
  document.querySelectorAll('[data-model]').forEach(b=>b.classList.toggle('selected',b.dataset.model===key));
  el('crop-field').classList.toggle('hidden',key==='pest');
  el('overview-model').textContent=key==='disease'?'作物病害':'农业害虫';
  clearResult();
  drawPreview();
  setStatus('已选择'+(key==='disease'?'病害分类':'害虫检测'));
  if(key==='disease')loadCropOptions();
}
document.querySelectorAll('[data-model]').forEach(button=>button.addEventListener('click',()=>chooseModel(button.dataset.model)));

async function loadCropOptions(){
  try{
    const info=await engine.metadata('disease');
    const select=el('crop-select'),old=select.value;
    const unique=new Map();
    for(const raw of info.labels){
      const name=String(raw);
      const sep=name.includes('___')?'___':'::';
      if(!name.includes(sep))continue;
      const crop=name.split(sep)[0];
      if(!unique.has(crop))unique.set(crop,labelFor(crop+'::healthy').split(' · ')[0]);
    }
    select.replaceChildren(new Option('自动判断',''));
    for(const crop of [...unique.keys()].sort())select.add(new Option(unique.get(crop),crop));
    select.value=old&&unique.has(old)?old:'';
  }catch(error){console.warn('Model metadata unavailable:',error.message);}
}

function cleanSource(){
  if(state.mediaURL){URL.revokeObjectURL(state.mediaURL);state.mediaURL=null;}
  if(state.source?.tagName==='VIDEO')state.source.pause();
  state.source=null;state.file=null;state.result=null;
}
function drawPreview(){
  const canvas=el('preview-canvas'),source=state.source;
  if(!source)return;
  const width=source.naturalWidth||source.videoWidth||source.width;
  const height=source.naturalHeight||source.videoHeight||source.height;
  const maxSide=1600,s=Math.min(1,maxSide/Math.max(width,height));
  canvas.width=Math.max(1,Math.round(width*s));
  canvas.height=Math.max(1,Math.round(height*s));
  const ctx=canvas.getContext('2d');
  ctx.drawImage(source,0,0,canvas.width,canvas.height);
  if(state.model!=='pest'||!state.result?.detections)return;
  const factorX=canvas.width/width,factorY=canvas.height/height;
  const fontSize=Math.max(12,Math.round(Math.min(canvas.width,canvas.height)/36));
  ctx.textBaseline='top';ctx.font='600 '+fontSize+'px sans-serif';ctx.lineWidth=Math.max(2,fontSize/6);
  for(const item of state.result.detections){
    const x=item.x1*factorX,y=item.y1*factorY,w=(item.x2-item.x1)*factorX,h=(item.y2-item.y1)*factorY;
    const name=item.name+'  '+Math.round(item.score*100)+'%';
    ctx.strokeStyle='#e9b48a';ctx.strokeRect(x,y,w,h);
    const txtWidth=ctx.measureText(name).width;
    const labelY=Math.max(0,y-fontSize-10);
    ctx.fillStyle='#293a40e6';ctx.fillRect(x,labelY,txtWidth+14,fontSize+10);
    ctx.fillStyle='#fff';ctx.fillText(name,x+7,labelY+4);
  }
}
async function openFile(file){
  if(!file||state.busy)return;
  const allowed=['image/jpeg','image/png','image/webp','video/mp4','video/webm'];
  if(!allowed.includes(file.type)){toast('文件格式不受支持');return;}
  if(file.size>100*1024*1024){toast('文件不能超过 100 MB');return;}
  cleanSource();clearResult();
  state.mediaURL=URL.createObjectURL(file);state.file=file;
  try{
    if(file.type.startsWith('video/')){
      const video=document.createElement('video');video.src=state.mediaURL;video.preload='auto';video.muted=true;video.playsInline=true;
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('视频解码失败'));video.load();});
      video.pause();state.source=video;
    }else{
      const image=new Image();image.src=state.mediaURL;
      await image.decode();state.source=image;
    }
  }catch(error){
    cleanSource();toast('文件读取失败：'+error.message);return;
  }
  el('drop-intro').classList.add('hidden');el('preview').classList.remove('hidden');
  el('file-name').textContent=file.name||'image';
  el('run-button').disabled=false;drawPreview();
  setStatus('已载入 '+(file.name||'图片'),'ok');
}
el('dropzone').addEventListener('click',event=>{if(event.target.closest('#remove-file'))return;el('file-input').click();});
el('dropzone').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button')){event.preventDefault();el('file-input').click();}});
el('file-input').addEventListener('change',event=>{if(event.target.files?.[0])openFile(event.target.files[0]);event.target.value='';});
for(const eventName of ['dragenter','dragover'])el('dropzone').addEventListener(eventName,event=>{event.preventDefault();el('dropzone').classList.add('dragover');});
for(const eventName of ['dragleave','drop'])el('dropzone').addEventListener(eventName,event=>{event.preventDefault();el('dropzone').classList.remove('dragover');});
el('dropzone').addEventListener('drop',event=>{if(event.dataTransfer?.files?.[0])openFile(event.dataTransfer.files[0]);});
el('remove-file').addEventListener('click',event=>{event.stopPropagation();cleanSource();clearResult();el('preview').classList.add('hidden');el('drop-intro').classList.remove('hidden');el('run-button').disabled=true;setStatus('选择文件后可开始识别');});
el('example-button').addEventListener('click',async()=>{
  try{const res=await fetch('./example-corn.jpg');if(!res.ok)throw new Error('示例文件未找到');const blob=await res.blob();await openFile(new File([blob],'example-corn.jpg',{type:'image/jpeg'}));}
  catch(error){toast(error.message);}
});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();el('file-input').click();}});

function resultItem({name,score}){
  const row=document.createElement('div');row.className='result-item';
  const title=document.createElement('span');title.className='result-name';title.textContent=name;
  const number=document.createElement('strong');number.className='result-score';number.textContent=(score*100).toFixed(1)+'%';
  const track=document.createElement('div');track.className='bar-track';
  const fill=document.createElement('div');fill.className='bar-fill';fill.style.width=Math.max(0,Math.min(100,score*100))+'%';
  track.append(fill);row.append(title,number,track);return row;
}
function renderResult(result){
  el('results').classList.remove('hidden');el('result-placeholder').classList.add('hidden');
  el('result-type').textContent=result.kind==='classification'?'病害分类':'害虫检测';
  el('result-ms').textContent=Math.round(result.elapsed)+' ms';
  el('result-backend').textContent=result.backend;
  const predictions=result.kind==='classification'?result.predictions:result.detections;
  el('results-title').textContent=result.kind==='classification'?'类别概率 · TOP 5':'检测目标 · '+predictions.length;
  const container=el('result-list');container.replaceChildren();
  if(predictions.length)predictions.forEach(p=>container.append(resultItem(p)));
  else{const div=document.createElement('p');div.className='result-notice';div.textContent='没有检测到达到阈值的目标。';container.append(div);}
  el('result-notice').textContent=result.kind==='classification'
    ?'分类概率仅在模型支持的类别范围内计算。对于未知病害，结果可能不适用。'
    :'检测框表示模型识别的位置；未检出不代表没有害虫。';
  el('output-state').innerHTML='<i></i> 已完成';
}
function readRecords(){
  try{const value=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(value)?value:[];}catch{return [];}
}
function addRecord(result){
  const top=result.kind==='classification'?result.predictions[0]:result.detections[0];
  const item={id:Date.now(),file:state.file?.name||'未命名图片',mode:state.model,when:new Date().toISOString(),label:top?.name||'未检出',score:top?.score||0,ms:Math.round(result.elapsed)};
  try{localStorage.setItem(storageKey,JSON.stringify([item,...readRecords()].slice(0,40)));}catch(error){console.warn('Local records unavailable',error);}
}
function renderRecords(){
  const items=readRecords();el('record-count').textContent=items.length+' 条';
  el('records-empty').classList.toggle('hidden',items.length>0);
  const host=el('records-list');host.replaceChildren();
  items.forEach((entry,index)=>{
    const row=document.createElement('div');row.className='record';
    const number=document.createElement('div');number.className='record-number';number.textContent=String(index+1).padStart(2,'0');
    const details=document.createElement('div');
    const strong=document.createElement('strong');strong.textContent=entry.label||'—';
    const sub=document.createElement('span');sub.textContent=(entry.mode==='disease'?'病害分类':'害虫检测')+' · '+(entry.file||'图片')+' · '+new Date(entry.when).toLocaleString('zh-CN');
    details.append(strong,sub);
    const score=document.createElement('div');score.className='record-score';score.textContent=Number.isFinite(entry.score)?(entry.score*100).toFixed(1)+'%':'—';
    row.append(number,details,score);host.append(row);
  });
}
el('clear-records').addEventListener('click',()=>{if(!readRecords().length)return;if(!confirm('清空当前设备保存的识别记录？'))return;localStorage.removeItem(storageKey);renderRecords();toast('已清空记录');});
el('run-button').addEventListener('click',async()=>{
  if(!state.source||state.busy)return;
  state.busy=true;el('run-button').disabled=true;el('run-button-label').textContent='分析中…';el('preview').classList.add('processing');
  el('output-state').innerHTML='<i></i> 正在推理';clearResult();
  try{
    const result=await engine.run(state.source,state.model,{crop:el('crop-select').value,threshold:.25});
    state.result=result;drawPreview();renderResult(result);addRecord(result);
    setStatus('推理完成 · '+Math.round(result.elapsed)+' ms','ok');
    el('output-state').innerHTML='<i></i> 已完成';
  }catch(error){
    console.error('Inference error:',error);setStatus('运行失败：'+error.message);
    toast('无法完成推理：'+error.message);
  }finally{
    state.busy=false;el('run-button').disabled=!state.source;el('run-button-label').textContent='运行识别';el('preview').classList.remove('processing');
  }
});
el('export-button').addEventListener('click',()=>{
  if(!state.source||!state.result){toast('请先完成识别');return;}
  const canvas=el('preview-canvas');
  canvas.toBlob(blob=>{
    if(!blob){toast('导出失败');return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fieldlens-result.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
});
el('crop-select').addEventListener('change',()=>{if(state.result){clearResult();drawPreview();setStatus('作物范围已改变，请重新识别');}});
setView(viewNames[location.hash.slice(1)]?location.hash.slice(1):'inspect');
loadCropOptions();
