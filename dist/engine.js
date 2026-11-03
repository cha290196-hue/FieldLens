const MODEL_DIR = new URL('./models/', import.meta.url);
const RUNTIME_DIR = new URL('./runtime/', import.meta.url);
const MODEL_FILES = { disease: 'disease', pest: 'pest' };
const INPUT_SIZE = 640;
const NAME_MAP = {
  blight:'玉米大斑病', common_rust:'玉米普通锈病', gray_spot:'玉米灰斑病',
  health:'健康玉米叶片', healthy:'健康叶片', 'corn leaf blight':'玉米大斑病',
  'common rust':'玉米普通锈病', 'gray leaf spot':'玉米灰斑病',
  'rice leaf roller':'稻纵卷叶螟', 'paddy stem maggot':'稻秆潜蝇',
  'brown plant hopper':'褐飞虱', aphids:'蚜虫', aphid:'蚜虫',
  'mole cricket':'蝼蛄', 'blister beetle':'芫菁',
  'rice leaf caterpillar':'稻叶毛虫', 'asiatic rice borer':'亚洲玉米螟',
  'yellow rice borer':'二化螟', 'rice gall midge':'稻瘿蚊',
  'white backed plant hopper':'白背飞虱', 'small brown plant hopper':'灰飞虱',
  'rice water weevil':'稻水象甲', 'rice leafhopper':'稻叶蝉',
  'rice shell pest':'稻壳虫', 'rice stemfly':'稻秆蝇',
  'corn borer':'玉米螟', 'army worm':'黏虫', 'black cutworm':'小地老虎',
  'wheat blossom midge':'麦穗吸浆虫', 'wheat sawfly':'麦茎蜂',
  'cabbage army worm':'菜青虫', 'beet army worm':'甜菜夜蛾',
  'red spider':'红蜘蛛', grub:'蛴螬', wireworm:'金针虫',
  beetle:'甲虫', 'fruit fly':'果蝇', 'scale insect':'介壳虫'
};

export function labelFor(name) {
  const raw = String(name ?? '').trim();
  const key = raw.toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ');
  return NAME_MAP[raw.toLowerCase()] || NAME_MAP[key] || raw.replaceAll('_', ' ');
}

export function intersectionOverUnion(a,b) {
  const w=Math.max(0,Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1));
  const h=Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
  const intersection=w*h;
  const union=(a.x2-a.x1)*(a.y2-a.y1)+(b.x2-b.x1)*(b.y2-b.y1)-intersection;
  return union>0?intersection/union:0;
}

export function suppressBoxes(boxes, threshold=0.45, limit=80) {
  const sorted=[...boxes].sort((a,b)=>b.score-a.score).slice(0,1000);
  const result=[];
  for(const box of sorted) {
    if(result.some(other=>box.classId===other.classId && intersectionOverUnion(box,other)>threshold)) continue;
    result.push(box);
    if(result.length>=limit) break;
  }
  return result;
}

export function decodeDetections(tensor, labels, transform, threshold=.25, iou=.45) {
  const dims=tensor.dims, data=tensor.data;
  if(dims.length!==3 || dims[0]!==1) throw new Error(`模型输出形状不受支持：${dims.join(' × ')}`);
  const labelCount=labels.length;
  const channels=4+labelCount;
  let candidates, columnMajor;
  if(dims[1]===channels) { candidates=dims[2]; columnMajor=true; }
  else if(dims[2]===channels) { candidates=dims[1]; columnMajor=false; }
  else throw new Error(`模型类别数与输出不匹配：${dims.join(' × ')}`);
  const get=(row,col)=>columnMajor?data[col*candidates+row]:data[row*channels+col];
  const found=[];
  for(let i=0;i<candidates;i++) {
    let classId=0,score=-Infinity;
    for(let c=0;c<labelCount;c++) {const s=get(i,c+4); if(s>score){score=s;classId=c;}}
    if(score<threshold || !Number.isFinite(score)) continue;
    const cx=get(i,0),cy=get(i,1),w=get(i,2),h=get(i,3);
    if(![cx,cy,w,h].every(Number.isFinite)||w<=0||h<=0) continue;
    const x1=Math.max(0,Math.min(transform.width,(cx-w/2-transform.padX)/transform.scale));
    const y1=Math.max(0,Math.min(transform.height,(cy-h/2-transform.padY)/transform.scale));
    const x2=Math.max(0,Math.min(transform.width,(cx+w/2-transform.padX)/transform.scale));
    const y2=Math.max(0,Math.min(transform.height,(cy+h/2-transform.padY)/transform.scale));
    if(x2<=x1||y2<=y1) continue;
    found.push({x1,y1,x2,y2,classId,score,name:labelFor(labels[classId])});
  }
  return suppressBoxes(found,iou);
}

export class Detector {
  constructor(onStatus=()=>{}) { this.onStatus=onStatus;this.sessions=new Map();this.ort=null; }
  async load(key) {
    if(this.sessions.has(key)) return this.sessions.get(key);
    if(!MODEL_FILES[key]) throw new Error('未找到所选模型');
    this.onStatus('正在加载识别引擎…');
    if(!this.ort) {
      try { this.ort=await import('./runtime/ort.webgpu.min.mjs'); }
      catch { throw new Error('识别引擎未准备好，请检查项目是否完成构建。'); }
      this.ort.env.wasm.wasmPaths=RUNTIME_DIR.href;
      this.ort.env.wasm.numThreads=1;
    }
    const stem=MODEL_FILES[key];
    this.onStatus('正在加载模型，首次使用可能需要一些时间…');
    const labelsResponse=await fetch(new URL(`${stem}.json`,MODEL_DIR));
    if(!labelsResponse.ok) throw new Error('模型配置未找到，请先完成模型准备。');
    const info=await labelsResponse.json();
    if(!Array.isArray(info.labels)||!info.labels.length) throw new Error('模型类别配置无效。');
    const url=new URL(`${stem}.onnx`,MODEL_DIR).href;
    let session,backend='WASM';
    if(navigator.gpu) {
      try { session=await this.ort.InferenceSession.create(url,{executionProviders:['webgpu']}); backend='WebGPU'; }
      catch(e) { console.warn('WebGPU is unavailable; using WASM.',e); }
    }
    if(!session) session=await this.ort.InferenceSession.create(url,{executionProviders:['wasm']});
    const instance={session,labels:info.labels,backend};this.sessions.set(key,instance);return instance;
  }
  async run(source,key,threshold=.25) {
    const {session,labels,backend}=await this.load(key);
    this.onStatus('正在识别图像…');
    const width=source.naturalWidth||source.videoWidth||source.width;
    const height=source.naturalHeight||source.videoHeight||source.height;
    if(!width||!height) throw new Error('无法读取图片尺寸。');
    const scale=Math.min(INPUT_SIZE/width,INPUT_SIZE/height);
    const resizedW=Math.round(width*scale),resizedH=Math.round(height*scale);
    const padX=(INPUT_SIZE-resizedW)/2,padY=(INPUT_SIZE-resizedH)/2;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=INPUT_SIZE;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#727272';ctx.fillRect(0,0,INPUT_SIZE,INPUT_SIZE);
    ctx.drawImage(source,padX,padY,resizedW,resizedH);
    const rgba=ctx.getImageData(0,0,INPUT_SIZE,INPUT_SIZE).data;
    const plane=INPUT_SIZE*INPUT_SIZE,chw=new Float32Array(plane*3);
    for(let i=0;i<plane;i++){chw[i]=rgba[i*4]/255;chw[plane+i]=rgba[i*4+1]/255;chw[2*plane+i]=rgba[i*4+2]/255;}
    const input=new this.ort.Tensor('float32',chw,[1,3,INPUT_SIZE,INPUT_SIZE]);
    const started=performance.now();
    const outputs=await session.run({[session.inputNames[0]]:input});
    const elapsed=performance.now()-started;
    const output=outputs[session.outputNames[0]];
    const detections=decodeDetections(output,labels,{width,height,padX,padY,scale},threshold);
    return {detections,elapsed,backend,width,height};
  }
}
