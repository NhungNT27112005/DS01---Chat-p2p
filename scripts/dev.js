import { spawn } from 'node:child_process';
const children = [
  ['--env-file-if-exists=.env', 'src/signaling/index.js'],
  ['--env-file-if-exists=.env', 'src/relay/index.js'],
  ['node_modules/vite/bin/vite.js', '--configLoader', 'native'],
].map(args => spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill());
  process.exitCode = code;
}
children.forEach(child => { child.on('error', error => { console.error(error); stop(1); }); child.on('exit', code => { if (!stopping) stop(code || 0); }); });
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
