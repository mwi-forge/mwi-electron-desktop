const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwi-test-'));
const configPath = path.join(workDir, 'config.yaml');
fs.writeFileSync(configPath, 'mixed-port: 17891\nmode: global\nlog-level: debug\nproxies: []\nrules:\n  - MATCH,DIRECT\n');
console.log('workDir:', workDir);

const child = spawn('resources/mihomo/win/mihomo.exe', ['-d', workDir, '-f', configPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderrBuf = '';
let stdoutBuf = '';
child.stderr.on('data', d => { stderrBuf += d.toString(); });
child.stdout.on('data', d => { stdoutBuf += d.toString(); });
child.on('error', e => console.log('SPAWN ERROR:', e.message));
child.on('exit', (code, signal) => {
  console.log('EXIT code=' + code + ' signal=' + signal);
  console.log('stderr:', stderrBuf.slice(-800));
  console.log('stdout:', stdoutBuf.slice(-300));
  process.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); child.kill('SIGTERM'); setTimeout(() => process.exit(0), 1000); }, 5000);
