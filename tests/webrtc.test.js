import test from 'node:test';
import assert from 'node:assert/strict';
import * as webrtc from '../src/web-peer/services/webrtc.js';
import { signalingSocket } from '../src/web-peer/services/signaling.js';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

class FakeChannel {
  readyState = 'connecting'; bufferedAmount = 0;
  close() { this.readyState = 'closed'; this.onclose?.(); }
  send(data) { this.sent = data; }
}
class FakePeerConnection {
  static instances = [];
  connectionState = 'new'; signalingState = 'stable'; remoteDescription = null;
  constructor() { FakePeerConnection.instances.push(this); }
  createDataChannel() { this.channel = new FakeChannel(); return this.channel; }
  async createOffer() { return { type: 'offer', sdp: 'test' }; }
  async createAnswer() { return { type: 'answer', sdp: 'test' }; }
  async setLocalDescription(value) { this.localDescription = value; this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(value) { this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate() {}
  close() { this.connectionState = 'closed'; this.signalingState = 'closed'; this.onconnectionstatechange?.(); }
}
function setup(t) {
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeerConnection;
  FakePeerConnection.instances.length = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(signalingSocket,'emit',() => signalingSocket);
  signalingSocket.connected = true;
  webrtc.configureWebRTC({ iceServers: [], setupTimeoutMs: 10000 });
  const stop = webrtc.startWebRTC();
  t.after(() => { stop(); webrtc.closeAll(); signalingSocket.connected = false; globalThis.RTCPeerConnection = original; });
}
test('temporary disconnect recovers before 5 seconds; prolonged disconnect cleans the session', async t => {
  setup(t); const events = []; const stop = webrtc.onStateChange(event => events.push(event)); t.after(stop);
  const connecting = webrtc.connect('b','s1'); await settle(); const pc = FakePeerConnection.instances.at(-1);
  pc.channel.readyState = 'open'; pc.channel.onopen(); await connecting;
  pc.connectionState = 'disconnected'; pc.onconnectionstatechange(); t.mock.timers.tick(4999);
  assert.equal(events.at(-1).state,'DISCONNECTED');
  pc.connectionState = 'connected'; pc.onconnectionstatechange(); t.mock.timers.tick(1);
  assert.equal(events.at(-1).state,'DIRECT_READY'); assert.equal(pc.channel.readyState,'open');
  pc.connectionState = 'disconnected'; pc.onconnectionstatechange(); t.mock.timers.tick(5000);
  assert.equal(events.at(-1).state,'FAILED'); assert.equal(pc.connectionState,'closed');
  const again = webrtc.connect('b','s2'); const rejected = assert.rejects(again); await settle(); t.mock.timers.tick(10000); await rejected;
});
test('both incoming and outgoing setup have a deadline and retired events are ignored', async t => {
  setup(t); const events = []; const stop = webrtc.onStateChange(event => events.push(event)); t.after(stop);
  signalingSocket.emitEvent(['webrtc:offer',{senderId:'c',sessionId:'incoming',offer:{type:'offer',sdp:'test'}}]); await settle();
  const pc = FakePeerConnection.instances.at(-1); assert.equal(pc.localDescription.type,'answer');
  const stale = pc.onconnectionstatechange; t.mock.timers.tick(10000);
  assert.equal(events.at(-1).state,'FAILED'); assert.equal(pc.connectionState,'closed');
  const count = events.length; stale(); assert.equal(events.length,count);
  const again = webrtc.connect('c','new'); const rejected = assert.rejects(again); await settle(); t.mock.timers.tick(10000); await rejected;
});
test('native send rejects oversized packets and channel backpressure', async t => {
  setup(t); const connecting = webrtc.connect('d','data'); await settle(); const pc = FakePeerConnection.instances.at(-1);
  pc.channel.readyState = 'open'; pc.channel.onopen(); await connecting;
  assert.throws(() => webrtc.send('d',{content:'x'.repeat(40000)}));
  pc.channel.bufferedAmount = 2 * 1024 * 1024; assert.throws(() => webrtc.send('d',{content:'hello'}));
});
