'use strict';

const {app,BrowserWindow,ipcMain,shell} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const DIST=path.join(__dirname,'..','dist');
const HOST='127.0.0.1';
const PAGES='https://cha290196-hue.github.io/FieldLens/models/';
const INDIA_META='https://raw.githubusercontent.com/Vatsal2008/AgriSmart-AI/main/models/models.json';
const INDIA_WEIGHT='https://raw.githubusercontent.com/Vatsal2008/AgriSmart-AI/main/models/india_v1.onnx';
const INDIA_SHA='f6b0ad51ea7175a7426d40a08b2f56bade93f4de5c89da9ebe2540d3c81a27b4';

let server;
let serverPort=0;
let mainWindow;
const activeModels=new Map();
const cachedMeta=new Map();

function allowModel(key){
  if(key!=='disease'&&key!=='pest')throw new Error('未知模型标识');
}
function modelDir(){return path.join(app.getPath('userData'),'models');}
function sendProgress(key,received,total){
  if(mainWindow&&!mainWindow.isDestroyed()){
    mainWindow.webContents.send('model-progress',{key,received,total});
  }
}
function fetchRequest(url,handler,depth=0){
  return new Promise((resolve,reject)=>{
    if(depth>6)return reject(new Error('模型下载重定向次数过多'));
    if(!url.startsWith('https://'))return reject(new Error('仅允许 HTTPS 模型资源'));
    const req=https.get(url,{headers:{'User-Agent':'FieldLens/2.0'}},res=>{
      const status=res.statusCode||0;
      if([301,302,303,307,308].includes(status)&&res.headers.location){
        const next=new URL(res.headers.location,url).href;
        res.resume();resolve(fetchRequest(next,handler,depth+1));return;
      }
      if(status!==200){res.resume();reject(new Error('模型资源请求失败：HTTP '+status));return;}
      Promise.resolve(handler(res)).then(resolve,reject);
    });
    req.on('error',reject);
    req.setTimeout(120000,()=>req.destroy(new Error('下载连接超时')));
  });
}
async function fetchJson(url,maxBytes=4*1024*1024){
  const content=await fetchRequest(url,res=>new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy(new Error('模型元数据过大'));return;}chunks.push(chunk);});
    res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error',reject);
  }));
  return JSON.parse(content);
}
async function digest(file){
  return new Promise((resolve,reject)=>{
    const hash=crypto.createHash('sha256');
    const stream=fs.createReadStream(file);
    stream.on('data',chunk=>hash.update(chunk));
    stream.on('end',()=>resolve(hash.digest('hex')));
    stream.on('error',reject);
  });
}
async function metadata(key){
  allowModel(key);
  if(cachedMeta.has(key))return cachedMeta.get(key);
  await fsp.mkdir(modelDir(),{recursive:true});
  const file=path.join(modelDir(),key+'.json');
  try{
    let value;
    if(key==='disease'){
      const document=await fetchJson(INDIA_META);
      const model=document.models?.find(row=>row.id==='india_v1');
      if(!model||!Array.isArray(model.labels)||model.labels.length!==387)throw new Error('病害类别配置无效');
      value={
        kind:'classification',img_size:model.img_size,crop_pct:model.crop_pct,
        mean:model.mean,std:model.std,
        labels:model.labels.map(row=>row.crop+'::'+row.label),
        sha256:INDIA_SHA
      };
    }else{
      value=await fetchJson(PAGES+'pest.json');
      if(value.kind!=='detection'||value.labels?.length!==102)throw new Error('害虫类别配置无效');
    }
    await fsp.writeFile(file,JSON.stringify(value),'utf8');
    cachedMeta.set(key,value);
    return value;
  }catch(error){
    try{
      const stored=JSON.parse(await fsp.readFile(file,'utf8'));
      if(stored.labels?.length){cachedMeta.set(key,stored);return stored;}
    }catch{}
    throw new Error('无法获取模型配置：'+error.message);
  }
}
async function downloadBinary(url,destination,key,maxBytes){
  const tmp=destination+'.download';
  await fsp.mkdir(path.dirname(destination),{recursive:true});
  try{
    await fetchRequest(url,res=>new Promise((resolve,reject)=>{
      const writer=fs.createWriteStream(tmp);
      let received=0;
      const total=Number(res.headers['content-length']||0);
      res.on('data',chunk=>{
        received+=chunk.length;
        if(received>maxBytes){res.destroy(new Error('下载文件超出限制'));return;}
        sendProgress(key,received,total);
      });
      res.on('error',reject);
      writer.on('error',reject);
      writer.on('finish',resolve);
      res.pipe(writer);
    }));
    await fsp.rename(tmp,destination);
  }catch(error){
    await fsp.rm(tmp,{force:true}).catch(()=>{});
    throw error;
  }
}
async function ensureModel(key){
  allowModel(key);
  if(activeModels.has(key))return activeModels.get(key);
  const task=(async()=>{
    const meta=await metadata(key);
    const destination=path.join(modelDir(),key+'.onnx');
    const sha=meta.sha256;
    if(!/^[a-f0-9]{64}$/i.test(String(sha)))throw new Error('模型校验信息不完整');
    let valid=false;
    try{valid=(await digest(destination))===sha;}catch{}
    if(!valid){
      const url=key==='disease'?INDIA_WEIGHT:PAGES+'pest.onnx';
      await downloadBinary(url,destination,key,key==='disease'?120*1024*1024:200*1024*1024);
      if((await digest(destination))!==sha){
        await fsp.rm(destination,{force:true});
        throw new Error('模型文件校验失败，请重试');
      }
    }
    return {url:'http://'+HOST+':'+serverPort+'/cache/'+key+'.onnx'};
  })();
  activeModels.set(key,task);
  try{return await task;}finally{activeModels.delete(key);}
}
function sendFile(res,file){
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    const ext=path.extname(file).toLowerCase();
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.onnx':'application/octet-stream','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(file).pipe(res);
  });
}
function handler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://'+HOST).pathname);}catch{res.writeHead(400);res.end();return;}
  if(pathname==='/')pathname='/index.html';
  if(pathname.startsWith('/cache/')){
    const name=pathname.slice('/cache/'.length);
    if(!['disease.onnx','pest.onnx'].includes(name)){res.writeHead(404);res.end();return;}
    sendFile(res,path.join(modelDir(),name));return;
  }
  const file=path.resolve(DIST,'.'+pathname);
  if(!file.startsWith(DIST+path.sep)){res.writeHead(403);res.end();return;}
  sendFile(res,file);
}
function openWindow(){
  mainWindow=new BrowserWindow({
    width:1440,height:920,minWidth:930,minHeight:680,
    backgroundColor:'#f7f7f4',
    autoHideMenuBar:true,
    show:false,
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      nodeIntegration:false,contextIsolation:true,sandbox:false,webSecurity:true
    }
  });
  const origin='http://'+HOST+':'+serverPort;
  mainWindow.loadURL(origin+'/?desktop=1');
  mainWindow.once('ready-to-show',()=>mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
}
app.setAppUserModelId('app.fieldlens.desktop');
app.whenReady().then(async()=>{
  server=http.createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,HOST,resolve);});
  serverPort=server.address().port;
  ipcMain.handle('model:metadata',(_event,key)=>metadata(key));
  ipcMain.handle('model:ensure',(_event,key)=>ensureModel(key));
  openWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)openWindow();});
}).catch(error=>{console.error('Startup failed:',error);app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{if(server)server.close();});
