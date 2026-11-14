import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, symlink, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {taskPath, saveState, readState, listActiveStates} from '../core.js';

test('default task directory remains unchanged', () => {
  const previous=process.env.PI_TASK_STATE_DIR;
  delete process.env.PI_TASK_STATE_DIR;
  try { assert.equal(taskPath('/project','task-one'),'/project/.pi/task-state/task-one.json'); }
  finally { if(previous===undefined)delete process.env.PI_TASK_STATE_DIR;else process.env.PI_TASK_STATE_DIR=previous; }
});

test('trusted root controls checkpoint reading, writing and listing despite a project symlink',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-checkpoint-root-'));
  const previous=process.env.PI_TASK_STATE_DIR;
  try {
    const cwd=join(root,'attempt'), trusted=join(root,'coordinator','checkpoints'), outside=join(root,'outside');
    await mkdir(join(cwd,'.pi'),{recursive:true});await mkdir(outside);await mkdir(trusted,{recursive:true});
    await symlink(outside,join(cwd,'.pi','task-state'));
    process.env.PI_TASK_STATE_DIR=trusted;
    const target=taskPath(cwd,'selected-task');
    assert.equal(target,join(trusted,'selected-task.json'));
    const saved=await saveState(target,{objective:'Trusted checkpoint',status:'active',completed:[],decisions:[],failedApproaches:[],unresolved:[],nextAction:'Continue'},0);
    assert.equal((await readState(taskPath(cwd,'selected-task'))).revision,saved.revision);
    assert.equal((await listActiveStates(cwd))[0].taskId,'selected-task');
    await assert.rejects(readFile(join(outside,'selected-task.json')), {code:'ENOENT'});
    assert.throws(()=>taskPath(cwd,'../escape'),/Task ID/);
    assert.throws(()=>taskPath(cwd,'/absolute'),/Task ID/);
    process.env.PI_TASK_STATE_DIR='relative/path';
    assert.throws(()=>taskPath(cwd,'safe'),/absolute path/);
  } finally {
    if(previous===undefined)delete process.env.PI_TASK_STATE_DIR;else process.env.PI_TASK_STATE_DIR=previous;
    await rm(root,{recursive:true,force:true});
  }
});
