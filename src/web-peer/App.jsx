import { useEffect, useState } from 'react';
import { signalingSocket, registerPeer } from './services/signaling.js';
import {
  startWebRTC,
  onStateChange,
  connect as connectWebRTC,
} from './services/webrtc.js';

export default function App() {
  const [connectionStatus, setConnectionStatus] =
    useState('Đang kết nối signaling...');
  const [peerId, setPeerId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('');
  const [onlinePeers, setOnlinePeers] = useState([]);
  const [currentPeer, setCurrentPeer] = useState(null);
  const [selectedPeerId, setSelectedPeerId] = useState('');
  const [webrtcStates, setWebrtcStates] = useState({});
  const [webrtcErrors, setWebrtcErrors] = useState({});

  useEffect(() => {
    function handleWebRTCState(event) {
      setWebrtcStates((previous) => ({
        ...previous,
        [event.peerId]: event,
      }));
    }

    function handleConnect() {
      setConnectionStatus('Đã kết nối signaling');
      setRegistrationStatus('');
    }

    function handleDisconnect() {
      setConnectionStatus('Mất kết nối signaling');
      setRegistrationStatus('');
      setOnlinePeers([]);
      setCurrentPeer(null);
      setSelectedPeerId('');
    }

    function handleConnectError(error) {
      setConnectionStatus(`Lỗi kết nối: ${error.message}`);
    }

    function handleRegisterResult(result) {
      setRegistrationStatus(result.message);

      if (result.ok) {
        setCurrentPeer(result.peer);
      }
    }

    function handlePeerList(peerList) {
      setOnlinePeers(peerList);

      setSelectedPeerId((previousId) => {
        const stillOnline = peerList.some(
          (peer) => peer.peerId === previousId
        );

        return stillOnline ? previousId : '';
      });
    }

    signalingSocket.on('connect', handleConnect);
    signalingSocket.on('disconnect', handleDisconnect);
    signalingSocket.on('connect_error', handleConnectError);
    signalingSocket.on('peer:register:result', handleRegisterResult);
    signalingSocket.on('peers:list', handlePeerList);

    const stopWebRTCState = onStateChange(handleWebRTCState);
    const stopWebRTC = startWebRTC();

    signalingSocket.connect();

    return () => {
      stopWebRTCState();
      stopWebRTC();

      signalingSocket.off('connect', handleConnect);
      signalingSocket.off('disconnect', handleDisconnect);
      signalingSocket.off('connect_error', handleConnectError);
      signalingSocket.off('peer:register:result', handleRegisterResult);
      signalingSocket.off('peers:list', handlePeerList);

      signalingSocket.disconnect();
    };
  }, []);

  function handleRegister() {
    if (!signalingSocket.connected) {
      return;
    }

    registerPeer(peerId, displayName);
  }

  async function handleConnectWebRTC() {
    const receiverId = selectedPeerId;

    if (
      !currentPeer ||
      !receiverId ||
      !signalingSocket.connected
    ) {
      return;
    }

    setWebrtcErrors((previous) => ({
      ...previous,
      [receiverId]: '',
    }));

    try {
      const sessionId = crypto.randomUUID();

      await connectWebRTC(receiverId, sessionId);
    } catch (error) {
      setWebrtcErrors((previous) => ({
        ...previous,
        [receiverId]:
          error?.message || 'Không thể kết nối WebRTC.',
      }));
    }
  }

  return (
    <main>
      <p className="label">DS01 · GIAI ĐOẠN 1</p>
      <h1>Chat P2P bằng JavaScript</h1>
      <p>Trạng thái: {connectionStatus}</p>
      {registrationStatus && <p>{registrationStatus}</p>}
      {currentPeer && (
        <p>
          Bạn: {currentPeer.displayName} ({currentPeer.peerId})
        </p>
      )}
      <p>
        <label>
          Peer ID:
          <input
            type="text"
            value={peerId}
            onChange={(event) => setPeerId(event.target.value)}
            placeholder="Ví dụ: peer-a"
          />
        </label>
      </p>

      <p>
        <label>
          Tên hiển thị:
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Ví dụ: An"
          />
        </label>
      </p>
      <button
        type="button"
        onClick={handleRegister}
        disabled={
          !signalingSocket.connected ||
          !peerId.trim() ||
          !displayName.trim()
        }
      >
        Tham gia mạng
      </button>

      <h2>Peer đang online ({onlinePeers.length})</h2>

      {onlinePeers.length === 0 && (
        <p>Chưa có peer nào trong danh sách.</p>
      )}

      <ul>
        {onlinePeers.map((peer) => (
          <li key={peer.peerId}>
            {peer.displayName} ({peer.peerId}) — {peer.status}

            {currentPeer && peer.peerId !== currentPeer.peerId && (
              <button
                type="button"
                onClick={() => setSelectedPeerId(peer.peerId)}
              >
                Chọn chat
              </button>
            )}
          </li>
        ))}
      </ul>

      {selectedPeerId && (
        <section>
          <p>Peer muốn chat: {selectedPeerId}</p>

          <p>
            Trạng thái WebRTC:{' '}
            {webrtcStates[selectedPeerId]?.state || 'Chưa kết nối'}
          </p>

          <button
            type="button"
            onClick={handleConnectWebRTC}
            disabled={
              !currentPeer ||
              !signalingSocket.connected ||
              webrtcStates[selectedPeerId]?.state === 'CONNECTING' ||
              webrtcStates[selectedPeerId]?.state === 'DIRECT_READY'
            }
          >
            Kết nối WebRTC
          </button>

          {webrtcErrors[selectedPeerId] && (
            <p role="alert">{webrtcErrors[selectedPeerId]}</p>
          )}
        </section>
      )}
    </main>
  );
}
