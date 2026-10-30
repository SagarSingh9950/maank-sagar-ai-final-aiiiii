const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-pai-history-'));
const env = { ...process.env, PERSONAL_AI_DATA_DIR: tempDir };
try {
  const recorder = require('./electron/agent/taskRecorder.cjs');
  recorder.configureDataDirectory(tempDir);
  const run = {
    runId: 'restart-test-run', workflowId: 'research-study', status: 'completed',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [],
  };
  recorder.saveRun(run);
  recorder.recordEvent({ type: 'run_completed', workflowId: run.workflowId, runId: run.runId, prompt: 'must not be stored', result: 'must not be stored' });

  const script = `const r=require('./electron/agent/taskRecorder.cjs'); const run=r.getRun('restart-test-run'); const events=r.listEvents('restart-test-run'); process.stdout.write(JSON.stringify({run,events}));`;
  const afterRestart = JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: __dirname, env, encoding: 'utf8',
  }));
  assert.equal(afterRestart.run.status, 'completed');
  assert.equal(afterRestart.events.length, 1);
  assert.equal(afterRestart.events[0].prompt, undefined);
  assert.equal(afterRestart.events[0].result, undefined);
  console.log('PASS: workflow history survives a separate process restart and event logs omit prompt/result bodies.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
