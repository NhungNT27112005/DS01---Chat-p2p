import {
  sendIceCandidate,
  sendOffer,
  sendAnswer,
  onAnswer,
  onIceCandidate,
} from './signaling.js';

const connections = new Map();
const stateListeners = new Set();
const messageListeners = new Set();

function createPeerConnection(peerId, sessionId) {
  if (connections.has(peerId)) {
    throw new Error('Đã có kết nối WebRTC với peer này.');
  }

  const peerConnection = new RTCPeerConnection();

  const connection = {
    peerId,
    sessionId,
    peerConnection,
    dataChannel: null,
    pendingCandidates: [],
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
      emitState(
        connection,
        'FAILED',
        error?.message || 'Không thể gửi ICE candidate.',
      );
    }
  };

  peerConnection.ondatachannel = (event) => {
    if (connection.dataChannel) {
      event.channel.close();
      return;
    }

    bindDataChannel(connection, event.channel);
  };

  connections.set(peerId, connection);

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
  const event = {
    peerId: connection.peerId,
    sessionId: connection.sessionId,
    state,
    reason,
    intentional,
  };

  for (const handler of stateListeners) {
    handler(event);
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

    emitState(connection, 'CLOSED', 'DataChannel đã đóng.');
  };

  dataChannel.onerror = (event) => {
    if (!isCurrent()) {
      return;
    }

    const reason =
      event.error?.message || 'DataChannel gặp lỗi.';

    emitState(connection, 'FAILED', reason);
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
    handler(event);
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

  dataChannel.send(data);

  return { deliveryMode: 'DIRECT' };
}

async function handleRemoteIceCandidate(data) {
  const connection = connections.get(data?.senderId);

  if (!connection || connection.sessionId !== data?.sessionId) {
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
    connection.pendingCandidates.push(candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (error) {
    if (connections.get(connection.peerId) !== connection) {
      return;
    }

    emitState(
      connection,
      'FAILED',
      error?.message || 'Không thể thêm ICE candidate.',
    );
  }
}

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

    emitState(
      connection,
      'FAILED',
      error?.message || 'Không thể áp dụng answer.',
    );
  }
}

export function startWebRTC() {
  const stopAnswer = onAnswer(handleRemoteAnswer);

  const stopIceCandidate = onIceCandidate(
    handleRemoteIceCandidate,
  );

  return () => {
    stopAnswer();
    stopIceCandidate();
  };
}

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

  if (connections.has(senderId)) {
    return;
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
      connections.delete(senderId);
      connection.dataChannel?.close();
      connection.peerConnection.close();
      connection.pendingCandidates.length = 0;
    }

    emitState(
      connection || { peerId: senderId, sessionId },
      'FAILED',
      error?.message || 'Không thể xử lý offer.',
    );
  }
}
