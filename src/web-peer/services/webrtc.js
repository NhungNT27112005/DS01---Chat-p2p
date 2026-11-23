import {
  sendIceCandidate,
  sendOffer,
  sendAnswer,
  onOffer,
  onAnswer,
  onIceCandidate,
  onWebRTCError,
} from './signaling.js';
import { MAX_PACKET_BYTES } from '../../shared/protocol.js';

const connections = new Map();
const stateListeners = new Set();
const messageListeners = new Set();
const earlyCandidates = new Map();
const retiredSessions = new Set();
let rtcConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let setupTimeoutMs = 10000;
export function configureWebRTC(options = {}) {
  if (options.iceServers) rtcConfiguration = { iceServers: options.iceServers };
  if (options.setupTimeoutMs > 0) setupTimeoutMs = options.setupTimeoutMs;
}
try {
  if (import.meta.env?.VITE_ICE_SERVERS) configureWebRTC({ iceServers: JSON.parse(import.meta.env.VITE_ICE_SERVERS) });
} catch { console.error('[webrtc] VITE_ICE_SERVERS không phải JSON hợp lệ.'); }
const sessionKey = (peerId, sessionId) => JSON.stringify([peerId, sessionId]);
function failConnection(connection, reason) {
  if (disposeConnection(connection)) emitState(connection, 'FAILED', reason);
}

function createPeerConnection(peerId, sessionId) {
  if (connections.has(peerId)) {
    throw new Error('Đã có kết nối WebRTC với peer này.');
  }

  const peerConnection = new RTCPeerConnection(rtcConfiguration);

  const connection = {
    peerId,
    sessionId,
    peerConnection,
    dataChannel: null,
    pendingCandidates: [],
    setupTimer: null,
    disconnectTimer: null,
  };

  peerConnection.onicecandidate = (event) => {
    if (connections.get(peerId) !== connection) {
      return;
    }

    if (event.candidate === null) {
      return;
    }

    try {
      sendIceCandidate(
        peerId,
        sessionId,
        event.candidate.toJSON(),
      );
    } catch (error) {
      failConnection(connection, error?.message || 'Không thể gửi ICE candidate.');
    }
  };

  peerConnection.ondatachannel = (event) => {
    if (connections.get(peerId) !== connection) { event.channel.close(); return; }
    if (connection.dataChannel) {
      event.channel.close();
      return;
    }

    bindDataChannel(connection, event.channel);
  };

  peerConnection.onconnectionstatechange = () => {
    if (connections.get(peerId) !== connection) {
      return;
    }

    if (peerConnection.connectionState === 'failed') {
      failConnection(connection, 'Kết nối WebRTC gặp sự cố.');
    } else if (peerConnection.connectionState === 'disconnected') {
      emitState(connection, 'DISCONNECTED', 'Đang chờ kết nối phục hồi (5 giây).');
      if (!connection.disconnectTimer) connection.disconnectTimer = setTimeout(() => {
        if (connections.get(peerId) === connection && peerConnection.connectionState === 'disconnected') failConnection(connection, 'Mất kết nối quá 5 giây.');
      }, 5000);
    } else if (peerConnection.connectionState === 'connected') {
      clearTimeout(connection.disconnectTimer);
      connection.disconnectTimer = null;
      if (connection.dataChannel?.readyState === 'open') emitState(connection, 'DIRECT_READY');
    } else if (peerConnection.connectionState === 'closed') {
      close(peerId, 'PeerConnection đã đóng.', false);
    }
  };

  connections.set(peerId, connection);
  connection.setupTimer = setTimeout(() => failConnection(connection, 'Hết thời gian chờ kết nối WebRTC.'), setupTimeoutMs);
  const earlyKey = sessionKey(peerId, sessionId);
  const buffered = earlyCandidates.get(earlyKey);
  if (buffered) { clearTimeout(buffered.timer); connection.pendingCandidates.push(...buffered.candidates); earlyCandidates.delete(earlyKey); }

  return connection;
}

function createDataChannel(connection) {
  if (connection.dataChannel) {
    throw new Error('Kết nối này đã có DataChannel.');
  }

  const dataChannel = connection.peerConnection.createDataChannel('chat', {
    ordered: true,
  });

  bindDataChannel(connection, dataChannel);

  return dataChannel;
}

export function onStateChange(handler) {
  stateListeners.add(handler);

  return () => {
    stateListeners.delete(handler);
  };
}

function emitState(
  connection,
  state,
  reason = null,
  intentional = false,
) {
  if (connection.state === state && connection.reason === reason) return;
  connection.state = state;
  connection.reason = reason;
  if (state === 'DIRECT_READY') { clearTimeout(connection.setupTimer); connection.setupTimer = null; }
  const event = {
    peerId: connection.peerId,
    sessionId: connection.sessionId,
    state,
    reason,
    intentional,
  };

  for (const handler of stateListeners) {
    try { handler(event); } catch (error) { console.error('[webrtc] state listener:', error); }
  }
}

function bindDataChannel(connection, dataChannel) {
  connection.dataChannel = dataChannel;

  const isCurrent = () =>
    connections.get(connection.peerId) === connection &&
    connection.dataChannel === dataChannel;
    
  dataChannel.onmessage = (event) => {
    if (!isCurrent()) {
      return;
    }

    if (typeof event.data !== 'string') {
      return;
    }
    if (new TextEncoder().encode(event.data).length > MAX_PACKET_BYTES) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (
      message === null ||
      typeof message !== 'object' ||
      Array.isArray(message)
    ) {
      return;
    }

    emitMessage(connection, message);
  };

  dataChannel.onopen = () => {
    if (!isCurrent()) {
      return;
    }

    emitState(connection, 'DIRECT_READY');
  };

  dataChannel.onclose = () => {
    if (!isCurrent()) {
      return;
    }

    close(
      connection.peerId,
      'DataChannel đã đóng.',
      false,
    );
  };

  dataChannel.onerror = (event) => {
    if (!isCurrent()) {
      return;
    }

    const reason =
      event.error?.message || 'DataChannel gặp lỗi.';

    failConnection(connection, reason);
  };
}

export function onMessage(handler) {
  messageListeners.add(handler);

  return () => {
    messageListeners.delete(handler);
  };
}

function emitMessage(connection, message) {
  const event = {
    peerId: connection.peerId,
    sessionId: connection.sessionId,
    message,
  };

  for (const handler of messageListeners) {
    try { handler(event); } catch (error) { console.error('[webrtc] message listener:', error); }
  }
}

export function send(peerId, message) {
  const connection = connections.get(peerId);

  if (!connection) {
    throw new Error('Chưa có kết nối WebRTC với peer này.');
  }

  const dataChannel = connection.dataChannel;

  if (!dataChannel || dataChannel.readyState !== 'open') {
    throw new Error('DataChannel chưa sẵn sàng để gửi dữ liệu.');
  }

  if (
    message === null ||
    typeof message !== 'object' ||
    Array.isArray(message)
  ) {
    throw new Error('Gói tin phải là một object.');
  }

  const data = JSON.stringify(message);
  if (new TextEncoder().encode(data).length > MAX_PACKET_BYTES) throw new Error('Gói tin quá lớn.');
  if (dataChannel.bufferedAmount > 1024 * 1024) throw new Error('DataChannel đang đầy, sẽ thử lại.');

  dataChannel.send(data);

  return { deliveryMode: 'DIRECT' };
}

function disposeConnection(connection) {
  if (
    connections.get(connection.peerId) !== connection
  ) {
    return false;
  }

  connections.delete(connection.peerId);
  clearTimeout(connection.setupTimer);
  clearTimeout(connection.disconnectTimer);
  retiredSessions.add(sessionKey(connection.peerId, connection.sessionId));
  if (retiredSessions.size > 256) retiredSessions.delete(retiredSessions.values().next().value);

  const { dataChannel, peerConnection } = connection;

  peerConnection.onicecandidate = null;
  peerConnection.ondatachannel = null;
  peerConnection.onconnectionstatechange = null;

  if (dataChannel) {
    dataChannel.onopen = null;
    dataChannel.onmessage = null;
    dataChannel.onclose = null;
    dataChannel.onerror = null;

    dataChannel.close();
  }

  peerConnection.close();
  connection.pendingCandidates.length = 0;

  return true;
}

export function close(
  peerId,
  reason = 'Đã chủ động đóng kết nối WebRTC.',
  intentional = true,
) {
  const connection = connections.get(peerId);

  if (!connection || !disposeConnection(connection)) {
    return false;
  }

  emitState(connection, 'CLOSED', reason, intentional);

  return true;
}

export function closeAll(
  reason = 'Đã chủ động đóng toàn bộ kết nối WebRTC.',
  intentional = true,
) {
  const snapshot = [...connections.values()];
  let closedCount = 0;

  for (const connection of snapshot) {
    if (
      connections.get(connection.peerId) !== connection
    ) {
      continue;
    }

    if (close(connection.peerId, reason, intentional)) {
      closedCount += 1;
    }
  }

  return closedCount;
}
// xử lý ICE candidate từ peer khác gửi tới
async function handleRemoteIceCandidate(data) {
  const connection = connections.get(data?.senderId);

  if (!connection || connection.sessionId !== data?.sessionId) {
    if (typeof data?.senderId !== 'string' || typeof data?.sessionId !== 'string' || typeof data?.candidate?.candidate !== 'string') return;
    const key = sessionKey(data.senderId, data.sessionId);
    if (retiredSessions.has(key)) return;
    if (!earlyCandidates.has(key) && earlyCandidates.size < 100) earlyCandidates.set(key, { candidates: [], timer: setTimeout(() => earlyCandidates.delete(key), setupTimeoutMs) });
    const buffer = earlyCandidates.get(key);
    if (buffer && buffer.candidates.length < 128) buffer.candidates.push(data.candidate);
    return;
  }

  const candidate = data?.candidate;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate) ||
    typeof candidate.candidate !== 'string'
  ) {
    return;
  }

  const peerConnection = connection.peerConnection;

  if (
    !peerConnection.remoteDescription ||
    connection.pendingCandidates.length > 0
  ) {
    if (connection.pendingCandidates.length >= 128) { failConnection(connection, 'Quá nhiều ICE candidate đang chờ.'); return; }
    connection.pendingCandidates.push(candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (error) {
    if (connections.get(connection.peerId) !== connection) {
      return;
    }

    failConnection(connection, error?.message || 'Không thể thêm ICE candidate.');
  }
}
// xử lý ICE candidate từ peer khác gửi tới
async function flushPendingCandidates(connection) {
  const peerConnection = connection.peerConnection;

  if (!peerConnection.remoteDescription) {
    return;
  }

  while (connection.pendingCandidates.length > 0) {
    if (
      connections.get(connection.peerId) !== connection ||
      peerConnection.signalingState === 'closed'
    ) {
      return;
    }

    const candidate = connection.pendingCandidates.shift();

    await peerConnection.addIceCandidate(candidate);
  }
}

async function createAndSendOffer(connection) {
  const peerConnection = connection.peerConnection;

  createDataChannel(connection);

  const offer = await peerConnection.createOffer();

  if (connections.get(connection.peerId) !== connection) {
    return;
  }

  await peerConnection.setLocalDescription(offer);

  if (connections.get(connection.peerId) !== connection) {
    return;
  }

  const description = peerConnection.localDescription;

  sendOffer(
    connection.peerId,
    connection.sessionId,
    {
      type: description.type,
      sdp: description.sdp,
    },
  );
}
// xử lý offer từ peer khác gửi tới rồi tạo và gửi answer ngược lại
async function createAndSendAnswer(connection, offer) {
  const peerConnection = connection.peerConnection;

  const isCurrent = () =>
    connections.get(connection.peerId) === connection;

  await peerConnection.setRemoteDescription(offer);

  if (!isCurrent()) {
    return;
  }

  await flushPendingCandidates(connection);

  if (!isCurrent()) {
    return;
  }

  const answer = await peerConnection.createAnswer();

  if (!isCurrent()) {
    return;
  }

  await peerConnection.setLocalDescription(answer);

  if (!isCurrent()) {
    return;
  }

  const description = peerConnection.localDescription;

  sendAnswer(
    connection.peerId,
    connection.sessionId,
    {
      type: description.type,
      sdp: description.sdp,
    },
  );
}

async function handleRemoteAnswer(data) {
  const connection = connections.get(data?.senderId);

  if (!connection || connection.sessionId !== data?.sessionId) {
    return;
  }

  const answer = data?.answer;

  if (
    answer?.type !== 'answer' ||
    typeof answer.sdp !== 'string' ||
    !answer.sdp.trim()
  ) {
    return;
  }

  const peerConnection = connection.peerConnection;

  if (peerConnection.signalingState !== 'have-local-offer') {
    return;
  }

  try {
    await peerConnection.setRemoteDescription(answer);

    if (connections.get(connection.peerId) !== connection) {
      return;
    }

    await flushPendingCandidates(connection);
  } catch (error) {
    if (connections.get(connection.peerId) !== connection) {
      return;
    }

    failConnection(connection, error?.message || 'Không thể áp dụng answer.');
  }
}
// bắt đầu lắng nghe các sự kiện WebRTC từ signaling server
export function startWebRTC() {
  const stopOffer = onOffer(handleRemoteOffer);
  const stopAnswer = onAnswer(handleRemoteAnswer);
  const stopError = onWebRTCError(data => {
    const connection = connections.get(data?.receiverId);
    if (connection?.sessionId === data?.sessionId) failConnection(connection, data.message || 'Lỗi signaling.');
  });

  const stopIceCandidate = onIceCandidate(
    handleRemoteIceCandidate,
  );

  return () => {
    stopOffer();
    stopAnswer();
    stopIceCandidate();
    stopError();
    for (const buffer of earlyCandidates.values()) clearTimeout(buffer.timer);
    earlyCandidates.clear();
  };
}
// tiếp nhận offer từ peer khác gửi tới rồi tạo và gửi answer ngược lại
async function handleRemoteOffer(data) {
  const senderId = data?.senderId;
  const sessionId = data?.sessionId;
  const offer = data?.offer;

  if (
    typeof senderId !== 'string' ||
    !senderId.trim() ||
    typeof sessionId !== 'string' ||
    !sessionId.trim() ||
    offer?.type !== 'offer' ||
    typeof offer.sdp !== 'string' ||
    !offer.sdp.trim()
  ) {
    return;
  }

  if (retiredSessions.has(sessionKey(senderId, sessionId))) return;
  const existing = connections.get(senderId);
  if (existing) {
    if (existing.sessionId === sessionId) return;
    // Simultaneous offers converge on the lexicographically smaller session.
    // The waiting connect() follows the winning session for this peer.
    if (existing.dataChannel?.readyState !== 'open' && existing.sessionId < sessionId) return;
    disposeConnection(existing);
  }

  let connection = null;

  try {
    connection = createPeerConnection(senderId, sessionId);

    emitState(connection, 'CONNECTING');

    await createAndSendAnswer(connection, offer);
  } catch (error) {
    if (
      connection &&
      connections.get(senderId) !== connection
    ) {
      return;
    }

    if (connection) {
      disposeConnection(connection);
    }

    emitState(
      connection || { peerId: senderId, sessionId },
      'FAILED',
      error?.message || 'Không thể xử lý offer.',
    );
  }
}

function waitForDirectReady(connection, timeoutMs = setupTimeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;

    function cleanup() {
      clearTimeout(timer);
      stopListening();
    }

    const stopListening = onStateChange((event) => {
      if (
        event.peerId !== connection.peerId
      ) {
        return;
      }

      if (event.state === 'DIRECT_READY') {
        cleanup();
        resolve();
        return;
      }

      if (
        event.state === 'FAILED' ||
        event.state === 'CLOSED'
      ) {
        cleanup();
        reject(new Error(event.reason || 'Kết nối WebRTC thất bại.'));
      }
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Hết thời gian chờ kết nối WebRTC.'));
    }, timeoutMs);

    if (connection.dataChannel?.readyState === 'open') {
      cleanup();
      resolve();
    }
  });
}

export async function connect(peerId, sessionId) {
  if (
    typeof peerId !== 'string' ||
    !peerId.trim() ||
    typeof sessionId !== 'string' ||
    !sessionId.trim()
  ) {
    throw new Error('Peer ID và Session ID không được để trống.');
  }

  peerId = peerId.trim();
  sessionId = sessionId.trim();

  const existing = connections.get(peerId);

  if (existing?.dataChannel?.readyState === 'open') {
    return {
      peerId,
      sessionId: existing.sessionId,
      deliveryMode: 'DIRECT',
    };
  }

  let connection = null;

  try {
    connection = existing || createPeerConnection(peerId, sessionId);

    emitState(connection, 'CONNECTING');

    await Promise.all([
      waitForDirectReady(connection),
      existing ? Promise.resolve() : createAndSendOffer(connection).catch(error => { if (connections.get(peerId) === connection) throw error; }),
    ]);

    const ready = connections.get(peerId);
    if (ready?.dataChannel?.readyState !== 'open') {
      throw new Error('Kết nối WebRTC không còn sẵn sàng.');
    }

    return {
      peerId,
      sessionId: ready.sessionId,
      deliveryMode: 'DIRECT',
    };
  } catch (error) {
    if (
      connection &&
      connections.get(peerId) === connection
    ) {
      disposeConnection(connection);

      emitState(
        connection,
        'FAILED',
        error?.message || 'Không thể kết nối WebRTC.',
      );
    }

    throw error;
  }
}
