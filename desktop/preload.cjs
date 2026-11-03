'use strict';
const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('fieldlensDesktop',Object.freeze({
  modelMetadata:key=>ipcRenderer.invoke('model:metadata',key),
  ensureModel:key=>ipcRenderer.invoke('model:ensure',key),
  modelStatus:key=>ipcRenderer.invoke('model:status',key),
  getRuntimeInfo:()=>ipcRenderer.invoke('runtime:info'),
  windowControl:action=>ipcRenderer.invoke('window:control',action),
  onProgress:callback=>{
    if(typeof callback!=='function')return;
    ipcRenderer.on('model-progress',(_event,payload)=>callback(payload));
  }
}));
