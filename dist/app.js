import {Detector} from './engine.js';

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const STORAGE_KEY='fieldlens:history:v1';
const navNames={detect:'智能检测',history:'识别记录',models:'模型中心',guide:'使用指南'};
const state={view:'detect',model:'disease',image:null,frame:null,mediaType:'image',objectUrl:null,detections:[],running:false,stopRequested:false,lastResult:null,loadToken:0};
let toastTimer;
const detector=new Detector(message=>setStatus(message,'busy'));

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500);}
function setStatus(message,type='idle'){
  const el=$('#result-state');el.replaceChildren();const dot=document.createElement('i');
  if(type==='busy')dot.style.background='#cfb375';
  if(type==='error')dot.style.background='#d48c76';
  el.append(dot,document.createTextNode(` ${message}`));
}
function setView(view){
  if(!navNames[view])return;
  state.view=view;$$('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  $$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('#breadcrumb').textContent=navNames[view];$('#sidebar').classList.remove('open');
  if(view==='history')renderHistory();
  try{history.replaceState(null,'',`#${view}`);}catch{}
}
function setModel(model){
  if(state.running||!['disease','pest'].includes(model))return;
  state.model=model;$$('.model-option').forEach(el=>{
    const selected=el.dataset.model===model;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));
  });
  state.detections=[];state.lastResult=null;if(state.image)drawImage();resetResult();
}
function resetResult(){
  $('#result-empty').classList.remove('hidden');$('#result-content').classList.add('hidden');
  setStatus('等待识别');
}
function createCanvasThumb(){
  const source=$('#preview-canvas');const c=document.createElement('canvas');
  const factor=Math.min(1,180/Math.max(source.width,source.height));
  c.width=Math.max(1,Math.round(source.width*factor));c.height=Math.max(1,Math.round(source.height*factor));
  c.getContext('2d').drawImage(source,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.72);
}
function readHistory(){try{const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(data)?data:[];}catch{return [];}}
function saveHistory(result){
  try{
    const entries=readHistory();entries.unshift({id:crypto.randomUUID?.()||String(Date.now()),time:Date.now(),model:state.model,
      count:result.detections.length,elapsed:Math.round(result.elapsed),labels:[...new Set(result.detections.map(d=>d.name))].slice(0,4),thumb:createCanvasThumb()});
    localStorage.setItem(STORAGE_KEY,JSON.stringify(entries.slice(0,30)));
  }catch{toast('当前浏览器无法保存记录，识别结果仍可使用');}
}
function renderHistory(){
  const list=$('#history-list'),empty=$('#history-empty'),entries=readHistory();list.replaceChildren();
  empty.classList.toggle('hidden',entries.length>0);$('#history-count').textContent=`${entries.length} RECORDS`;
  $('#clear-history').disabled=!entries.length;
  entries.forEach(entry=>{
    const row=document.createElement('div');row.className='history-entry';
    const img=document.createElement('img');img.className='history-thumb';img.src=entry.thumb;img.alt='识别记录缩略图';
    const text=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');
    title.textContent=entry.labels.length?entry.labels.join('、'):'未检出目标';
    detail.textContent=`${entry.model==='pest'?'农田虫害':'作物病害'} · ${new Date(entry.time).toLocaleString('zh-CN')}`;text.append(title,detail);
    const count=document.createElement('span');count.textContent=`${entry.count} 个目标`;
    const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','删除这条记录');
    remove.innerHTML='<svg aria-hidden="true"><use href="#i-trash"></use></svg>';
    remove.addEventListener('click',()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(readHistory().filter(x=>x.id!==entry.id)));renderHistory();});
    row.append(img,text,count,remove);list.append(row);
  });
}
function loadFile(file){
  if(!file)return;
  if(state.running){toast('请先停止当前检测');return;}
  const imageTypes=['image/jpeg','image/png','image/webp'],videoTypes=['video/mp4','video/webm'];
  if(!imageTypes.includes(file.type)&&!videoTypes.includes(file.type)){toast('请选择支持的图片或视频格式');return;}
  if(file.size>100*1024*1024){toast('文件大小不能超过 100 MB');return;}
  if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);
  const url=URL.createObjectURL(file),token=++state.loadToken,isVideo=videoTypes.includes(file.type);
  const source=isVideo?document.createElement('video'):new Image();
  const ready=()=>{
    if(token!==state.loadToken){URL.revokeObjectURL(url);return;}
    if(state.objectUrl&&state.objectUrl!==url)URL.revokeObjectURL(state.objectUrl);
    state.image=source;state.frame=null;state.mediaType=isVideo?'video':'image';state.objectUrl=url;state.detections=[];state.lastResult=null;
    $('#drop-inner').classList.add('hidden');$('#image-stage').classList.remove('hidden');
    $('#run-detection').disabled=false;$('#media-tip').textContent=isVideo?'视频将逐帧分析，可随时停止':'图片越清晰，识别效果通常越好';drawImage();resetResult();
  };
  source.onerror=()=>{URL.revokeObjectURL(url);toast('文件无法读取，请尝试其他文件');};
  if(isVideo){source.muted=true;source.playsInline=true;source.preload='auto';source.onloadeddata=ready;}
  else source.onload=ready;
  source.src=url;
}
function drawImage(){
  if(!state.image)return;
  const canvas=$('#preview-canvas'),source=state.frame||state.image,w=source.naturalWidth||source.videoWidth||source.width,h=source.naturalHeight||source.videoHeight||source.height;
  const factor=Math.min(1,2400/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*factor));canvas.height=Math.max(1,Math.round(h*factor));
  const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const line=Math.max(2,Math.min(canvas.width,canvas.height)*.005),font=Math.max(13,Math.min(canvas.width,canvas.height)*.026);
  ctx.lineWidth=line;ctx.textBaseline='top';ctx.font=`600 ${font}px system-ui, sans-serif`;
  for(const d of state.detections){
    const x=d.x1*factor,y=d.y1*factor,bw=(d.x2-d.x1)*factor,bh=(d.y2-d.y1)*factor;
    ctx.strokeStyle='#9bea74';ctx.fillStyle='#9bea74';ctx.strokeRect(x,y,bw,bh);
    const label=`${d.name} ${(d.score*100).toFixed(0)}%`,pad=font*.36,tw=Math.min(ctx.measureText(label).width+pad*2,canvas.width);
    const top=Math.max(0,y-font-pad*2);ctx.fillRect(x,top,tw,font+pad*2);
    ctx.fillStyle='#1b3b24';ctx.fillText(label,x+pad,top+pad,Math.max(0,tw-pad*2));
  }
}
function renderResult(result){
  $('#result-empty').classList.add('hidden');$('#result-content').classList.remove('hidden');
  $('#result-count').textContent=result.detections.length;$('#result-time').textContent=`${Math.round(result.elapsed)} ms`;
  const list=$('#result-list');list.replaceChildren();
  if(!result.detections.length){const p=document.createElement('p');p.className='result-footnote';p.textContent='本次未检出目标，可以换一张图片或切换识别方向。';list.append(p);}
  result.detections.slice(0,30).forEach(d=>{
    const row=document.createElement('div');row.className='detection-item';
    const dot=document.createElement('i');dot.className='dot';const label=document.createElement('strong');label.textContent=d.name;
    const score=document.createElement('span');score.textContent=`${(d.score*100).toFixed(1)}%`;row.append(dot,label,score);list.append(row);
  });
  const concerns=result.detections.filter(d=>!/健康|healthy/i.test(d.name)).length;
  $('#result-advice').textContent=concerns
    ? `关注提示：发现 ${concerns} 个疑似异常目标，建议复查叶片或虫体；结果仅供辅助观察。`
    : '未检出异常目标不代表绝对健康，请结合实地观察判断。';
  setStatus('识别完成');
}
async function detect(){
  if(!state.image)return;
  if(state.running){if(state.mediaType==='video'){state.stopRequested=true;setStatus('正在停止…','busy');}return;}
  state.running=true;state.stopRequested=false;$('#run-detection').disabled=state.mediaType!=='video';$('#run-detection span').textContent=state.mediaType==='video'?'停止检测':'正在识别';
  try{
    if(state.mediaType==='image'){
      const result=await detector.run(state.image,state.model,.25);state.frame=null;state.detections=result.detections;state.lastResult=result;
      drawImage();renderResult(result);saveHistory(result);
    }else{
      const video=state.image;
      await detector.load(state.model);
      if(state.stopRequested)return;
      if(video.ended)video.currentTime=0;
      await video.play();
      while(!video.ended&&!state.stopRequested){
        const frame=document.createElement('canvas');const factor=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
        frame.width=Math.max(1,Math.round(video.videoWidth*factor));frame.height=Math.max(1,Math.round(video.videoHeight*factor));
        frame.getContext('2d').drawImage(video,0,0,frame.width,frame.height);
        const result=await detector.run(frame,state.model,.25);state.frame=frame;state.detections=result.detections;state.lastResult=result;
        drawImage();renderResult(result);
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      video.pause();if(state.lastResult)saveHistory(state.lastResult);
      setStatus(state.stopRequested?'已停止':'识别完成');
    }
  }catch(e){console.error(e);setStatus('加载失败','error');toast(e?.message||'识别失败，请检查模型文件后重试');}
  finally{if(state.mediaType==='video')state.image?.pause?.();state.running=false;state.stopRequested=false;$('#run-detection').disabled=!state.image;$('#run-detection span').textContent='开始识别';}
}

$$('.nav-item').forEach(el=>el.addEventListener('click',()=>setView(el.dataset.view)));
$$('[data-go]').forEach(el=>el.addEventListener('click',()=>setView(el.dataset.go)));
$$('[data-model]').forEach(el=>el.addEventListener('click',()=>setModel(el.dataset.model)));
$$('[data-select-model]').forEach(el=>el.addEventListener('click',()=>{setView('detect');setModel(el.dataset.selectModel);}));
$('#menu-button').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#dropzone').addEventListener('click',event=>{if(!event.target.closest('#clear-image'))$('#file-input').click();});
$('#dropzone').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('#file-input').click();}});
$('#dropzone').addEventListener('dragover',event=>{event.preventDefault();$('#dropzone').classList.add('dragging');});
$('#dropzone').addEventListener('dragleave',()=>$('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop',event=>{event.preventDefault();$('#dropzone').classList.remove('dragging');loadFile(event.dataTransfer.files[0]);});
$('#file-input').addEventListener('change',event=>{loadFile(event.target.files[0]);event.target.value='';});
$('#load-example').addEventListener('click',async()=>{try{const response=await fetch('./example-corn.jpg');if(!response.ok)throw new Error();const blob=await response.blob();setModel('disease');loadFile(new File([blob],'sample.jpg',{type:'image/jpeg'}));}catch{toast('示例图片加载失败');}});
$('#clear-image').addEventListener('click',event=>{event.stopPropagation();if(state.running){toast('请先停止当前检测');return;}if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);state.loadToken++;state.objectUrl=null;state.image=null;state.frame=null;state.detections=[];$('#image-stage').classList.add('hidden');$('#drop-inner').classList.remove('hidden');$('#run-detection').disabled=true;$('#media-tip').textContent='图片越清晰，识别效果通常越好';resetResult();});
$('#run-detection').addEventListener('click',detect);
$('#download-result').addEventListener('click',()=>{
  $('#preview-canvas').toBlob(blob=>{
    if(!blob){toast('图片生成失败，请重试');return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.download=`fieldlens-${new Date().toISOString().slice(0,10)}.png`;a.href=url;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  },'image/png');
});
$('#clear-history').addEventListener('click',()=>{if(confirm('确定清空此设备上的所有识别记录吗？')){localStorage.removeItem(STORAGE_KEY);renderHistory();toast('记录已清空');}});
$('#today').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});
$('#year').textContent=new Date().getFullYear();setModel('disease');setView(location.hash.slice(1)||'detect');
