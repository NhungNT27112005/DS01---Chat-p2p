import { useEffect, useState } from 'react';
import { signalingSocket, registerPeer } from './services/signaling.js';

export default function App() {
  const [connectionStatus, setConnectionStatus] =
    useState('Đang kết nối signaling...');
  const [peerId, setPeerId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('');

  useEffect(() => {
    function handleConnect() {
      setConnectionStatus('Đã kết nối signaling');
      setRegistrationStatus('');
    }

    function handleDisconnect() {
      setConnectionStatus('Mất kết nối signaling');
      setRegistrationStatus('');
    }

    function handleConnectError(error) {
      setConnectionStatus(`Lỗi kết nối: ${error.message}`);
    }

    function handleRegisterResult(result) {
      setRegistrationStatus(result.message);
    }

    signalingSocket.on('connect', handleConnect);
    signalingSocket.on('disconnect', handleDisconnect);
    signalingSocket.on('connect_error', handleConnectError);
    signalingSocket.on('peer:register:result', handleRegisterResult);

    signalingSocket.connect();

    return () => {
      signalingSocket.off('connect', handleConnect);
      signalingSocket.off('disconnect', handleDisconnect);
      signalingSocket.off('connect_error', handleConnectError);
      signalingSocket.off('peer:register:result', handleRegisterResult);

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
      {registrationStatus && <p>{registrationStatus}</p>}
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
