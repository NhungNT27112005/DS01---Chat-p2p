import { useEffect, useRef, useState } from 'react';
import { signalingSocket, registerPeer } from './services/signaling.js';
import {
  startWebRTC,
  onStateChange,
  onMessage,
  connect as connectWebRTC,
  send as sendWebRTC,
} from './services/webrtc.js';
import { createChatMessage } from '../shared/messages.js';

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
  const [drafts, setDrafts] = useState({});
  const [sendFeedback, setSendFeedback] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const sequenceRef = useRef(new Map());

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

  useEffect(() => {
    if (!currentPeer) {
      return;
    }

    function handleIncomingMessage(event) {
      const { peerId, sessionId, message } = event;

      if (
        message.version !== 1 ||
        message.type !== 'CHAT_MESSAGE' ||
        typeof message.messageId !== 'string' ||
        !message.messageId.trim() ||
        message.senderId !== peerId ||
        message.receiverId !== currentPeer.peerId ||
        message.sessionId !== sessionId ||
        message.groupId !== null ||
        !Number.isSafeInteger(message.sequence) ||
        message.sequence < 1 ||
        !Number.isSafeInteger(message.timestamp) ||
        message.timestamp < 0 ||
        typeof message.content !== 'string' ||
        !message.content.trim()
      ) {
        return;
      }

      setChatMessages((previous) => {
        const alreadyExists = previous.some(
          (item) =>
            item.senderId === message.senderId &&
            item.messageId === message.messageId,
        );

        if (alreadyExists) {
          return previous;
        }

        return [...previous, message];
      });
    }

    return onMessage(handleIncomingMessage);
  }, [currentPeer]);

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

  function handleSendMessage(event) {
    event.preventDefault();

    const receiverId = selectedPeerId;
    const connection = webrtcStates[receiverId];
    const content = drafts[receiverId] || '';

    if (
      !currentPeer ||
      !receiverId ||
      connection?.state !== 'DIRECT_READY' ||
      !content.trim()
    ) {
      return;
    }

    try {
      const sequenceKey = JSON.stringify([
        currentPeer.peerId,
        receiverId,
        connection.sessionId,
      ]);

      const sequence =
        (sequenceRef.current.get(sequenceKey) || 0) + 1;

      const message = createChatMessage({
        senderId: currentPeer.peerId,
        receiverId,
        sessionId: connection.sessionId,
        sequence,
        content,
      });

      sendWebRTC(receiverId, message);

      sequenceRef.current.set(sequenceKey, sequence);

      setChatMessages((previous) => [
        ...previous,
        message,
      ]);

      setDrafts((previous) => ({
        ...previous,
        [receiverId]: '',
      }));

      setSendFeedback((previous) => ({
        ...previous,
        [receiverId]: 'Đã đưa tin vào DataChannel.',
      }));
    } catch (error) {
      setSendFeedback((previous) => ({
        ...previous,
        [receiverId]: error?.message || 'Không thể gửi tin nhắn.',
      }));
    }
  }

  const conversationMessages = chatMessages.filter(
    (message) =>
      (
        message.senderId === currentPeer?.peerId &&
        message.receiverId === selectedPeerId
      ) ||
      (
        message.senderId === selectedPeerId &&
        message.receiverId === currentPeer?.peerId
      ),
  );

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

          <h3>Cuộc trò chuyện</h3>

          {conversationMessages.length === 0 && (
            <p>Chưa có tin nhắn.</p>
          )}

          <ul>
            {conversationMessages.map((message) => (
              <li
                key={JSON.stringify([
                  message.senderId,
                  message.messageId,
                ])}
              >
                <strong>
                  {message.senderId === currentPeer?.peerId
                    ? 'Bạn'
                    : message.senderId}
                </strong>
                : {message.content}
              </li>
            ))}
          </ul>

          <form onSubmit={handleSendMessage}>
            <p>
              <label>
                Tin nhắn:
                <input
                  type="text"
                  value={drafts[selectedPeerId] || ''}
                  onChange={(event) => {
                    const content = event.target.value;

                    setDrafts((previous) => ({
                      ...previous,
                      [selectedPeerId]: content,
                    }));
                  }}
                  disabled={
                    webrtcStates[selectedPeerId]?.state !== 'DIRECT_READY'
                  }
                  placeholder="Nhập tin nhắn..."
                />
              </label>
            </p>

            <button
              type="submit"
              disabled={
                !currentPeer ||
                webrtcStates[selectedPeerId]?.state !== 'DIRECT_READY' ||
                !(drafts[selectedPeerId] || '').trim()
              }
            >
              Gửi tin
            </button>
          </form>

          {sendFeedback[selectedPeerId] && (
            <p role="status">{sendFeedback[selectedPeerId]}</p>
          )}
        </section>
      )}
    </main>
  );
}
