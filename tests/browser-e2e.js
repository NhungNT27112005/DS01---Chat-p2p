// Native Chromium + CDP: no mocked RTCPeerConnection and no extra test package.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createSignalingServer } from '../src/signaling/server.js';
import { createRelayServer } from '../src/relay/server.js';
import { listen } from '../src/server/common.js';

const executable = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
if (!executable) throw new Error('Set CHROME_PATH to a Chromium browser executable.');
const profile = await mkdtemp(join(tmpdir(), 'ds01-browser-'));
const secret = 'ds01-browser-test-secret-thirty-two-characters';
const allowedOrigins = [];
const serverLogs = [];
const log = (...args) => serverLogs.push(args.join(' '));
const signaling = createSignalingServer({ secret, allowedOrigins, log });
const relay = createRelayServer({ secret, allowedOrigins, log, lookup: async (kind,id) => {
  const peer = signaling.peers.get(id); return peer ? { registrationId: peer.socketId } : null;
} });
let vite, browser, cdp, browserSocket;
const report = [];
const pass = name => { console.log('PASS:', name); report.push(name); };
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function waitFor(check, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
try {
  const signalPort = await listen(signaling.httpServer,0,'127.0.0.1');
  const relayPort = await listen(relay.httpServer,0,'127.0.0.1');
  vite = await createViteServer({ configFile:false, plugins:[react()], define:{
    'import.meta.env.VITE_SIGNAL_URL':JSON.stringify(`http://127.0.0.1:${signalPort}`),
    'import.meta.env.VITE_RELAY_URL':JSON.stringify(`http://127.0.0.1:${relayPort}`),
    'import.meta.env.VITE_ICE_SERVERS':JSON.stringify('[]'),
  }, server:{host:'127.0.0.1',port:0,hmr:false} });
  await vite.listen();
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  allowedOrigins.push(url);
  browser = spawn(executable, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const wsUrl = await new Promise((resolve,reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Chrome did not open DevTools')),15000);
    browser.on('error',reject); browser.stderr.on('data',chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const ws = new WebSocket(wsUrl);
  browserSocket = ws;
  await new Promise((resolve,reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const browserErrors = [];
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') browserErrors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    if (!data.id) return;
    const task = pending.get(data.id); if (!task) return; pending.delete(data.id); clearTimeout(task.timer);
    data.error ? task.reject(new Error(data.error.message)) : task.resolve(data.result);
  };
  cdp = (method,params = {},sessionId) => new Promise((resolve,reject) => {
    const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); },45000);
    pending.set(id,{resolve,reject,timer}); ws.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
  });
  const page = async id => {
    const {browserContextId} = await cdp('Target.createBrowserContext');
    const {targetId} = await cdp('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId} = await cdp('Target.attachToTarget',{targetId,flatten:true});
    await cdp('Runtime.enable',{},sessionId); await cdp('Page.enable',{},sessionId);
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,replMode:true},sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await cdp('Page.navigate',{url},sessionId);
    await waitFor(() => evaluate("!!document.querySelector('input[placeholder=\"Ví dụ: peer-a\"]')"),'React page');
    await evaluate("window.ds = (await import('/src/web-peer/services/chat.js')).chatClient; true");
    await waitFor(() => evaluate("ds.getState().connectionStatus.startsWith('Đã kết nối')"),'signaling connect');
    await evaluate(`ds.register(${JSON.stringify(id)},${JSON.stringify(id)}); true`);
    await waitFor(() => evaluate('!!ds.getState().currentPeer && ds.getState().relayReady'),'register peer and relay');
    return {id,targetId,sessionId,evaluate, async reload() {
      await cdp('Page.reload',{},sessionId);
      await delay(500);
      await waitFor(() => evaluate("!!document.querySelector('input[placeholder=\"Ví dụ: peer-a\"]')"),'reload React');
      await evaluate("window.ds = (await import('/src/web-peer/services/chat.js')).chatClient; true");
      await waitFor(() => evaluate('!!ds.getState().currentPeer && ds.getState().relayReady'),'restore registration');
    }};
  };
  const a = await page('peer-a'), b = await page('peer-b'), c = await page('peer-c');
  await waitFor(() => a.evaluate('ds.getState().onlinePeers.length === 3'),'three peer discovery');
  pass('three isolated browser peers register and discover each other');
  await Promise.all([a.evaluate("await ds.connect('peer-b'); true"),b.evaluate("await ds.connect('peer-a'); true")]);
  await waitFor(() => a.evaluate("ds.getState().routes['peer-b']?.state === 'DIRECT_READY'"),'native DIRECT');
  pass('simultaneous offer negotiation converges to a native DataChannel');
  const beforeDirect = relay.metrics.forwarded;
  await Promise.all([a.evaluate("ds.sendPrivate('peer-b','direct A to B')"),b.evaluate("ds.sendPrivate('peer-a','direct B to A')")]);
  await waitFor(async () => await a.evaluate("ds.getState().messages.some(m => m.content === 'direct A to B' && m.deliveries?.['peer-b'].status === 'RECEIVED')") && await b.evaluate("ds.getState().messages.some(m => m.content === 'direct B to A' && m.deliveries?.['peer-a'].status === 'RECEIVED')"),'two way ACK');
  assert.equal(relay.metrics.forwarded,beforeDirect);
  await a.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim()==='Chọn chat' && button.parentElement.textContent.includes('peer-b')).click(); true`);
  await waitFor(() => a.evaluate("!!document.querySelector('input[placeholder=\"Nhập tin nhắn...\"]')"),'private chat UI');
  await a.evaluate(`window.setInput = (input,value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); };
    setInput(document.querySelector('input[placeholder="Nhập tin nhắn..."]'),'private UI submit'); true`);
  await a.evaluate(`document.querySelector('input[placeholder="Nhập tin nhắn..."]').form.requestSubmit(); true`);
  await waitFor(() => a.evaluate("ds.getState().messages.some(m => m.content === 'private UI submit' && m.deliveries?.['peer-b'].status === 'RECEIVED')"),'private form submit');
  assert.equal(relay.metrics.forwarded,beforeDirect);
  pass('simultaneous DIRECT chat and destination ACK do not pass through relay');
  await b.evaluate(`window.dropped = []; window.savedDirectSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(data) { let m; try {m=JSON.parse(data);} catch {} if(m?.type==='ACK') {dropped.push(m.ackFor); return;} return savedDirectSend.call(this,data); }; true`);
  await a.evaluate("ds.sendPrivate('peer-b','retry same ID over relay')");
  await waitFor(() => a.evaluate("ds.getState().messages.some(m => m.content === 'retry same ID over relay' && m.deliveries?.['peer-b'].status === 'RECEIVED' && m.deliveries['peer-b'].deliveryMode === 'RELAY')"),'retry fallback and relay ACK',15000);
  assert.equal(await b.evaluate("ds.getState().messages.filter(m => m.content === 'retry same ID over relay').length"),1);
  await b.evaluate('RTCDataChannel.prototype.send = savedDirectSend; true');
  pass('lost DIRECT ACK retries unchanged Message ID through RELAY and deduplicates');
  // Close the native channel unconditionally, on both ends observe automatic fallback.
  await a.evaluate("(await import('/src/web-peer/services/webrtc.js')).close('peer-b','e2e broken direct',false); true");
  await waitFor(() => b.evaluate("ds.getState().routes['peer-a']?.state === 'RELAY_READY'"),'remote close fallback');
  await a.evaluate("ds.sendPrivate('peer-b','after direct disconnect')");
  await waitFor(() => a.evaluate("ds.getState().messages.some(m => m.content === 'after direct disconnect' && m.deliveries?.['peer-b'].status === 'RECEIVED')"),'relay after disconnect');
  pass('closing DIRECT automatically switches both peers to RELAY');
  // Block creation of a native connection to model an unreachable direct path.
  await c.evaluate("window.savedRTC = RTCPeerConnection; window.RTCPeerConnection = class { constructor() { throw new Error('simulated blocked direct network'); } }; true");
  await c.evaluate("await ds.connect('peer-a'); ds.sendPrivate('peer-a','blocked direct uses relay'); true");
  await waitFor(() => c.evaluate("ds.getState().messages.some(m => m.content === 'blocked direct uses relay' && m.deliveries?.['peer-a'].status === 'RECEIVED')"),'blocked direct relay');
  pass('an unavailable DIRECT path falls back to the independent relay server');
  assert.equal(await b.evaluate("ds.getState().messages.some(m => m.content === 'blocked direct uses relay')"),false);
  assert.equal(await c.evaluate("ds.getState().messages.some(m => m.content === 'private UI submit')"),false);
  assert.equal(await a.evaluate("!!document.querySelector('section[aria-label=\"Chat nhóm\"]')"),false);
  pass('private messages stay isolated between peer pairs and the UI only exposes private chat');
  await a.evaluate("await ds.connect('peer-b'); true");
  // Suppress ACKs on both transports to check the complete retry budget.
  await b.evaluate(`window.savedDirectSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(data) { const m=JSON.parse(data); if(m.type!=='ACK') return savedDirectSend.call(this,data); };
    window.bs = (await import('/src/web-peer/services/chat.js')).chatClient;
    window.socketPrototype = (await import('/src/web-peer/services/signaling.js')).signalingSocket.constructor.prototype;
    window.savedSocketEmit = socketPrototype.emit;
    socketPrototype.emit = function(event,...args) {
      if(event==='relay:send' && args[0]?.type==='ACK') { const cb=args.at(-1); if(typeof cb==='function') cb(null,{ok:true,deliveryMode:'RELAY'}); return this; }
      return savedSocketEmit.call(this,event,...args);
    }; true`);
  await a.evaluate("ds.sendPrivate('peer-b','no ACK bounded retries')");
  await waitFor(() => a.evaluate("ds.getState().messages.some(m => m.content === 'no ACK bounded retries' && m.deliveries?.['peer-b'].status === 'FAILED')"),'bounded retries',30000);
  assert.equal(await b.evaluate("ds.getState().messages.filter(m => m.content === 'no ACK bounded retries').length"),1);
  pass('all ACKs lost: bounded retries terminate with FAILED and no duplicate display');
  await b.reload();
  assert.equal(await b.evaluate("ds.getState().messages.filter(m => m.content === 'private UI submit').length"),1);
  pass('peer restart restores private localStorage history and re-registers');
  await cdp('Target.closeTarget',{targetId:c.targetId});
  await waitFor(() => a.evaluate("!ds.getState().onlinePeers.some(p => p.peerId === 'peer-c')"),'offline discovery',20000);
  await a.evaluate("ds.sendPrivate('peer-c','offline private recipient')");
  await waitFor(() => a.evaluate("ds.getState().messages.some(m => m.content === 'offline private recipient' && m.deliveries?.['peer-c'].status === 'FAILED')"),'offline private recipient',30000);
  pass('abrupt peer exit updates discovery and private messages to offline peers fail explicitly');
  await relay.close();
  await waitFor(() => a.evaluate('!ds.getState().relayReady'),'relay unavailable');
  await a.evaluate("await ds.connect('peer-b'); ds.sendPrivate('peer-b','DIRECT while relay stopped'); true");
  await waitFor(() => a.evaluate("ds.getState().messages.some(m => m.content === 'DIRECT while relay stopped' && m.deliveries?.['peer-b'].status === 'RECEIVED')"),'direct independent of relay');
  pass('relay outage does not break a working DIRECT conversation');
  assert.deepEqual(browserErrors,[]);
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/browser-e2e.json',JSON.stringify({at:new Date().toISOString(),scope:'localhost native Chromium WebRTC; unreachable path is injected, not WAN deployment',passed:report,relay:relay.metrics,serverLogs},null,2));
  const layout = await cdp('Page.getLayoutMetrics',{},a.sessionId);
  const screenshot = await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:layout.cssContentSize.width,height:layout.cssContentSize.height,scale:1}},a.sessionId);
  await writeFile('test-results/browser.png',Buffer.from(screenshot.data,'base64'));
  console.log(`Browser scenarios passed: ${report.length}`);
  await cdp('Browser.close').catch(() => {}); ws.close();
} finally {
  browserSocket?.close();
  browser?.kill(); await vite?.close();
  if (relay.httpServer.listening) await relay.close();
  await signaling.close();
  // Only the unique temporary browser profile created by this test is removed.
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(() => {});
}
