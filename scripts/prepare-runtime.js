import {cpSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

const src=join('node_modules','onnxruntime-web','dist');
const target=join('dist','runtime');
mkdirSync(target,{recursive:true});
for(const name of ['ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']){
  const file=join(src,name);
  if(!existsSync(file))throw new Error(`Missing runtime file: ${name}`);
  cpSync(file,join(target,name));
}
console.log('Runtime prepared.');
