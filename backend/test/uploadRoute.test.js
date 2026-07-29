const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

function waitForServer(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryFetch = () => {
      fetch(url)
        .then((res) => {
          if (res.ok) resolve();
          else throw new Error(`Unexpected status ${res.status}`);
        })
        .catch(() => {
          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error('Server did not start in time'));
          } else {
            setTimeout(tryFetch, 100);
          }
        });
    };

    tryFetch();
  });
}

test('POST /upload validates a CSV file', async () => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '3101' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForServer('http://127.0.0.1:3101/health');

    const csvPath = path.join(__dirname, '..', 'sample.csv');
    const csvBuffer = fs.readFileSync(csvPath);
    const formData = new FormData();
    formData.append('file', new Blob([csvBuffer], { type: 'text/csv' }), 'sample.csv');

    const response = await fetch('http://127.0.0.1:3101/upload', {
      method: 'POST',
      body: formData,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.ok(payload.summary);
    assert.equal(payload.summary.totalRows, 7);
    assert.ok(payload.summary.qualityScore !== null);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});
