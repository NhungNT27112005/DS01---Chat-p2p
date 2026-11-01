import { useEffect, useState } from 'react';
import { signalingSocket, registerPeer } from './services/signaling.js';

export default function App() {
  const [connectionStatus, setConnectionStatus] =
    useState('Đang kết nối signaling...');
  const [peerId, setPeerId] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    function handleConnect() {
      setConnectionStatus('Đã kết nối signaling');
    }

    function handleDisconnect() {
      setConnectionStatus('Mất kết nối signaling');
    }

    function handleConnectError(error) {
      setConnectionStatus(`Lỗi kết nối: ${error.message}`);
    }

    signalingSocket.on('connect', handleConnect);
    signalingSocket.on('disconnect', handleDisconnect);
    signalingSocket.on('connect_error', handleConnectError);

    signalingSocket.connect();

    return () => {
      signalingSocket.off('connect', handleConnect);
      signalingSocket.off('disconnect', handleDisconnect);
      signalingSocket.off('connect_error', handleConnectError);

      signalingSocket.disconnect();
    };
  }, []);

  function handleRegister() {
    if (!signalingSocket.connected) {
      return;
    }

    registerPeer(peerId, displayName);
  }

  return (
    <main>
      <p className="label">DS01 · GIAI ĐOẠN 1</p>
      <h1>Chat P2P bằng JavaScript</h1>
      <p>Trạng thái: {connectionStatus}</p>
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
      <p>Khung dự án đã sẵn sàng để học và xây dựng từng phần.</p>
    </main>
  );
}
