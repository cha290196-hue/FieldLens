import test from 'node:test';
import assert from 'node:assert/strict';
import {intersectionOverUnion,suppressBoxes,decodeDetections,labelFor} from '../dist/engine.js';

test('computes intersection over union and handles disjoint boxes',()=>{
  assert.equal(intersectionOverUnion({x1:0,y1:0,x2:10,y2:10},{x1:0,y1:0,x2:10,y2:10}),1);
  assert.equal(intersectionOverUnion({x1:0,y1:0,x2:2,y2:2},{x1:3,y1:3,x2:5,y2:5}),0);
});

test('suppresses overlaps only within the same class',()=>{
  const boxes=[{x1:0,y1:0,x2:10,y2:10,score:.9,classId:0},{x1:0,y1:0,x2:10,y2:10,score:.8,classId:0},{x1:0,y1:0,x2:10,y2:10,score:.7,classId:1}];
  const result=suppressBoxes(boxes);assert.equal(result.length,2);assert.deepEqual(result.map(x=>x.classId),[0,1]);
});

test('decodes channels-first output and removes image padding',()=>{
  const transform={width:200,height:100,scale:2,padX:0,padY:100};
  const tensor={dims:[1,6,2],data:new Float32Array([
    100,300, 150,190, 40,20, 20,20, .9,.1, .1,.85
  ])};
  const out=decodeDetections(tensor,['blight','aphid'],transform,.25);
  assert.equal(out.length,2);assert.equal(out[0].name,'玉米大斑病');assert.equal(out[0].x1,40);assert.equal(out[0].y1,20);
  assert.equal(out[1].name,'蚜虫');assert.equal(out[1].x2,155);
});

test('decodes candidates-first output and rejects incompatible labels',()=>{
  const tensor={dims:[1,1,6],data:new Float32Array([100,100,40,20,.1,.9])};
  const out=decodeDetections(tensor,['a','b'],{width:640,height:640,scale:1,padX:0,padY:0});
  assert.equal(out.length,1);assert.equal(out[0].name,'b');
  assert.throws(()=>decodeDetections(tensor,['one'],{width:1,height:1,scale:1,padX:0,padY:0}),/不匹配/);
  assert.equal(labelFor('rice_leaf_roller'),'稻纵卷叶螟');
});
