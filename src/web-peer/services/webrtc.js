const connections = new Map();

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

    connection.dataChannel = event.channel;
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

  connection.dataChannel = dataChannel;

  return dataChannel;
}
