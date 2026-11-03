import test from 'node:test';
import assert from 'node:assert/strict';
import {softmax,labelFor} from '../dist/engine.js';

test('stable class probabilities',()=>{
  const output=softmax(new Float32Array([3,1,2]));
  const total=output.reduce((s,x)=>s+x.score,0);
  assert.ok(Math.abs(total-1)<1e-6);
  assert.ok(output[0].score>output[1].score);
});
test('crop restriction does not include other classes',()=>{
  const output=softmax(new Float32Array([1,4,9]),[0,1]);
  assert.deepEqual(output.map(x=>x.classId),[0,1]);
  assert.ok(output[1].score>.9);
});
test('plant disease labels remain readable',()=>{
  assert.equal(labelFor('Tomato___Late_blight'),'番茄 · 晚疫病');
  assert.equal(labelFor('apple::Healthy'),'苹果 · 健康');
});
