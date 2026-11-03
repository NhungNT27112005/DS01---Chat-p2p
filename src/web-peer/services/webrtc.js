const connections = new Map();
const stateListeners = new Set();

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
