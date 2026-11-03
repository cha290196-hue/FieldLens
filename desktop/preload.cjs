'use strict';
const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('fieldlensDesktop',Object.freeze({
  modelMetadata:key=>ipcRenderer.invoke('model:metadata',key),
  ensureModel:key=>ipcRenderer.invoke('model:ensure',key),
  onProgress:callback=>{
    if(typeof callback!=='function')return;
    ipcRenderer.on('model-progress',(_event,payload)=>callback(payload));
  }
}));
