const RUNTIME_DIR = new URL('./runtime/', import.meta.url);
const MODEL_DIR = new URL('./models/', import.meta.url);
const FIXED_NAMES = {
  blight:'玉米大斑病', aphid:'蚜虫', aphids:'蚜虫',
  rice_leaf_roller:'稻纵卷叶螟', brown_plant_hopper:'褐飞虱',
  rice_weevil:'米象', fall_armyworm:'草地贪夜蛾'
};
const CROPS = {
  apple:'苹果', tomato:'番茄', potato:'马铃薯', corn:'玉米', maize:'玉米',
  rice:'水稻', wheat:'小麦', grape:'葡萄', peach:'桃', strawberry:'草莓',
  soybean:'大豆', soybeans:'大豆', blueberry:'蓝莓', raspberry:'树莓',
  pepper:'辣椒', bell_pepper:'甜椒', cherry:'樱桃', orange:'柑橘',
  squash:'南瓜', tea:'茶', banana:'香蕉', cotton:'棉花', mango:'芒果',
  cucumber:'黄瓜', cabbage:'甘蓝', sugarcane:'甘蔗', cauliflower:'花椰菜'
};
const TERMS = {
  healthy:'健康', common_rust:'普通锈病', early_blight:'早疫病',
  late_blight:'晚疫病', bacterial_spot:'细菌性斑点病',
  powdery_mildew:'白粉病', leaf_mold:'叶霉病', black_rot:'黑腐病',
  apple_scab:'苹果黑星病', target_spot:'靶斑病',
  northern_leaf_blight:'大斑病', mosaic_virus:'花叶病毒病',
  leaf_curl:'卷叶病', downy_mildew:'霜霉病'
};
function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
export function labelFor(label) {
  const raw = String(label ?? '').trim();
  const direct = FIXED_NAMES[normalizeKey(raw)];
  if (direct) return direct;
  let parts = null;
  if (raw.includes('___')) parts = raw.split('___');
  else if (raw.includes('::')) parts = raw.split('::');
  if (parts && parts.length > 1) {
    const cropKey = normalizeKey(parts[0].replace(/^\s*corn\s*\(maize\)/i, 'maize'));
    const diseaseName = parts.slice(1).join(' ').replace(/_/g, ' ').trim();
    const condition = TERMS[normalizeKey(diseaseName)] || diseaseName;
    return (CROPS[cropKey] || parts[0].replaceAll('_', ' ')) + ' · ' + condition;
  }
  return TERMS[normalizeKey(raw)] || raw.replaceAll('_', ' ');
}
export function intersectionOverUnion(a, b) {
  const w = Math.max(0, Math.min(a.x2,b.x2) - Math.max(a.x1,b.x1));
  const h = Math.max(0, Math.min(a.y2,b.y2) - Math.max(a.y1,b.y1));
  const intersect = w*h;
  const areaA = Math.max(0,a.x2-a.x1)*Math.max(0,a.y2-a.y1);
  const areaB = Math.max(0,b.x2-b.x1)*Math.max(0,b.y2-b.y1);
  const union = areaA+areaB-intersect;
  return union>0?intersect/union:0;
}
export function suppressBoxes(boxes, threshold=.45, limit=80, crossClassDuplicateIou=1) {
  const sorted = [...boxes].sort((a,b)=>b.score-a.score).slice(0,1000);
  const result = [];
  for (const box of sorted) {
    if(result.some(other=>intersectionOverUnion(box,other)>(box.classId===other.classId?threshold:crossClassDuplicateIou)))continue;
    result.push(box);
    if(result.length>=limit)break;
  }
  return result;
}
export function decodeDetections(tensor, labels, transform, threshold=.25, iou=.45, crossClassDuplicateIou=1) {
  const dims=tensor.dims,data=tensor.data;
  if(dims.length!==3||dims[0]!==1)throw new Error('模型输出形状不受支持：'+dims.join('×'));
  const count=labels.length,channels=4+count;
  let candidates,channelFirst;
  if(dims[1]===channels){candidates=dims[2];channelFirst=true;}
  else if(dims[2]===channels){candidates=dims[1];channelFirst=false;}
  else throw new Error('模型类别数与输出不匹配：'+dims.join('×'));
  const get=(row,col)=>channelFirst?data[col*candidates+row]:data[row*channels+col];
  const found=[];
  for(let i=0;i<candidates;i++){
    let cls=0,score=-Infinity;
    for(let c=0;c<count;c++){const p=get(i,c+4);if(p>score){score=p;cls=c;}}
    if(score<threshold||!Number.isFinite(score))continue;
    const cx=get(i,0),cy=get(i,1),w=get(i,2),h=get(i,3);
    if(![cx,cy,w,h].every(Number.isFinite)||w<=0||h<=0)continue;
    const x1=Math.max(0,Math.min(transform.width,(cx-w/2-transform.padX)/transform.scale));
    const x2=Math.max(0,Math.min(transform.width,(cx+w/2-transform.padX)/transform.scale));
    const y1=Math.max(0,Math.min(transform.height,(cy-h/2-transform.padY)/transform.scale));
    const y2=Math.max(0,Math.min(transform.height,(cy+h/2-transform.padY)/transform.scale));
    if(x2<=x1||y2<=y1)continue;
    found.push({x1,y1,x2,y2,score,classId:cls,name:labelFor(labels[cls])});
  }
  return suppressBoxes(found,iou,80,crossClassDuplicateIou);
}
export function softmax(logits, ids=null) {
  const allow = ids || Array.from(logits.keys());
  if(!allow.length)return[];
  const max = Math.max(...allow.map(i=>logits[i]));
  const exps = allow.map(i=>Math.exp(logits[i]-max));
  const sum = exps.reduce((a,b)=>a+b,0);
  return allow.map((id,i)=>({classId:id,score:sum?exps[i]/sum:0}));
}
function imageSize(source) {
  const width=source.naturalWidth||source.videoWidth||source.width;
  const height=source.naturalHeight||source.videoHeight||source.height;
  if(!width||!height)throw new Error('无法读取图像尺寸');
  return {width,height};
}
function pixelsToTensor(canvas, ort, mean=[0,0,0], std=[1,1,1]) {
  const size=canvas.width,ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgba=ctx.getImageData(0,0,size,size).data,plane=size*size;
  const floats=new Float32Array(plane*3);
  for(let i=0;i<plane;i++){
    floats[i]=(rgba[4*i]/255-mean[0])/std[0];
    floats[plane+i]=(rgba[4*i+1]/255-mean[1])/std[1];
    floats[2*plane+i]=(rgba[4*i+2]/255-mean[2])/std[2];
  }
  return new ort.Tensor('float32',floats,[1,3,size,size]);
}
function cropTensor(source, info, ort) {
  const {width,height}=imageSize(source),size=Number(info.img_size||224);
  const cropPct=Number(info.crop_pct||.875);
  const sourceSide=Math.min(width,height)*cropPct;
  const x=(width-sourceSide)/2,y=(height-sourceSide)/2;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  canvas.getContext('2d').drawImage(source,x,y,sourceSide,sourceSide,0,0,size,size);
  return pixelsToTensor(canvas,ort,info.mean||[.485,.456,.406],info.std||[.229,.224,.225]);
}
function detectionTensor(source, ort) {
  const {width,height}=imageSize(source),size=640;
  const scale=Math.min(size/width,size/height);
  const rw=Math.round(width*scale),rh=Math.round(height*scale);
  const padX=(size-rw)/2,padY=(size-rh)/2;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#727272';ctx.fillRect(0,0,size,size);ctx.drawImage(source,padX,padY,rw,rh);
  return {tensor:pixelsToTensor(canvas,ort),transform:{width,height,scale,padX,padY}};
}
export class InferenceEngine {
  constructor(onStatus=()=>{}) {
    this.onStatus=onStatus;this.ort=null;this.sessions=new Map();this.metadataCache=new Map();
  }
  async metadata(key) {
    if(this.metadataCache.has(key))return this.metadataCache.get(key);
    if(!['disease','pest'].includes(key))throw new Error('未知模型类型');
    let info;
    if(globalThis.fieldlensDesktop){
      info=await globalThis.fieldlensDesktop.modelMetadata(key);
    } else {
      const response=await fetch(new URL(key+'.json',MODEL_DIR));
      if(!response.ok)throw new Error('模型清单尚未部署：'+key);
      info=await response.json();
    }
    if(!Array.isArray(info.labels)||!info.labels.length)throw new Error('模型类别数据无效');
    this.metadataCache.set(key,info);
    return info;
  }
  async load(key) {
    if(this.sessions.has(key))return this.sessions.get(key);
    this.onStatus('载入模型配置…');
    const info=await this.metadata(key);
    if(!this.ort){
      this.onStatus('初始化 ONNX 推理引擎…');
      try{this.ort=await import('./runtime/ort.webgpu.min.mjs');}
      catch{throw new Error('推理运行库缺失，请检查构建产物');}
      this.ort.env.wasm.wasmPaths=RUNTIME_DIR.href;
      this.ort.env.wasm.numThreads=1;
    }
    this.onStatus('加载模型权重，首次使用需要一些时间…');
    const url=globalThis.fieldlensDesktop
      ?(await globalThis.fieldlensDesktop.ensureModel(key)).url
      :new URL(key+'.onnx',MODEL_DIR).href;
    let session,backend='WASM';
    if(key==='pest'&&typeof navigator!=='undefined'&&navigator.gpu){
      try{session=await this.ort.InferenceSession.create(url,{executionProviders:['webgpu']});backend='WebGPU';}
      catch(e){console.warn('Falling back to WASM',e);}
    }
    if(!session)session=await this.ort.InferenceSession.create(url,{executionProviders:['wasm']});
    const item={session,info,backend};
    this.sessions.set(key,item);return item;
  }
  async run(source,key,options={}) {
    const {session,info,backend}=await this.load(key);
    this.onStatus('运行推理…');
    const classification=key==='disease';
    const prep=classification?{tensor:cropTensor(source,info,this.ort)}:detectionTensor(source,this.ort);
    const start=performance.now();
    const output=await session.run({[session.inputNames[0]]:prep.tensor});
    const ms=performance.now()-start;
    if(classification){
      const logits=(output.logits||output[session.outputNames[0]]).data;
      let ids=null;
      if(options.crop){
        ids=info.labels.map((x,i)=>({x,i})).filter(({x})=>String(x).toLowerCase().startsWith(String(options.crop).toLowerCase()+'::')||String(x).toLowerCase().startsWith(String(options.crop).toLowerCase()+'___')).map(({i})=>i);
        if(!ids.length)ids=null;
      }
      const ranked=softmax(logits,ids).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>({...x,name:labelFor(info.labels[x.classId])}));
      return {kind:'classification',predictions:ranked,elapsed:ms,backend,...imageSize(source)};
    }
    const detections=decodeDetections(output[session.outputNames[0]],info.labels,prep.transform,options.threshold??.25,.45,.88);
    return {kind:'detection',detections,elapsed:ms,backend,...imageSize(source)};
  }
}
