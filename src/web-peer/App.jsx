import { useEffect, useRef, useState } from 'react';
import { signalingSocket, registerPeer } from './services/signaling.js';
import {
  startWebRTC,
  onStateChange,
  onMessage,
  connect as connectWebRTC,
  send as sendWebRTC,
  closeAll as closeAllWebRTC,
} from './services/webrtc.js';
import {
  createChatMessage,
  createAckMessage,
} from '../shared/messages.js';
import {
  sendReliable,
  acknowledgeMessage,
  cancelPendingMessages,
} from './services/reliable.js';

const MESSAGE_STATUS_LABELS = {
  SENDING: 'Đang gửi',
  SENT: 'Đã gửi, chờ xác nhận',
  RECEIVED: 'Đã nhận',
  FAILED: 'Chưa xác nhận được',
};

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

      closeAllWebRTC('Ứng dụng đã dừng.');

      signalingSocket.off('connect', handleConnect);
      signalingSocket.off('disconnect', handleDisconnect);
      signalingSocket.off('connect_error', handleConnectError);
      signalingSocket.off(
        'peer:register:result',
        handleRegisterResult,
      );
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

      if (message.type === 'ACK') {
        if (
          message.version !== 1 ||
          typeof message.messageId !== 'string' ||
          !message.messageId.trim() ||
          typeof message.ackFor !== 'string' ||
          !message.ackFor.trim() ||
          message.senderId !== peerId ||
          message.receiverId !== currentPeer.peerId ||
          message.sessionId !== sessionId ||
          message.groupId !== null ||
          message.sequence !== null ||
          message.content !== null ||
          !Number.isSafeInteger(message.timestamp) ||
          message.timestamp < 0
        ) {
          return;
        }

        acknowledgeMessage(message);

        setChatMessages((previous) =>
          previous.map((item) => {
            if (
              item.type !== 'CHAT_MESSAGE' ||
              item.messageId !== message.ackFor ||
              item.senderId !== currentPeer.peerId ||
              item.receiverId !== peerId ||
              item.sessionId !== sessionId ||
              item.status === 'RECEIVED'
            ) {
              return item;
            }

            return {
              ...item,
              status: 'RECEIVED',
              error: null,
            };
          }),
        );

        return;
      }

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

      try {
        const ack = createAckMessage({
          senderId: currentPeer.peerId,
          receiverId: peerId,
          sessionId,
          ackFor: message.messageId,
        });

        sendWebRTC(peerId, ack);
      } catch (error) {
        setSendFeedback((previous) => ({
          ...previous,
          [peerId]:
            `Không thể gửi ACK: ${
              error?.message || 'Lỗi không xác định.'
            }`,
        }));
      }
    }

    const stopMessage = onMessage(handleIncomingMessage);

    return () => {
      stopMessage();
      cancelPendingMessages(currentPeer.peerId);

      setChatMessages((previous) =>
        previous.map((item) => {
          if (
            item.senderId !== currentPeer.peerId ||
            !['SENDING', 'SENT'].includes(item.status)
          ) {
            return item;
          }

          return {
            ...item,
            status: 'FAILED',
            error: 'Đã dừng theo dõi vì phiên peer kết thúc.',
          };
        }),
      );
    };
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

  function updateMessageStatus(target, status, error = null) {
    setChatMessages((previous) =>
      previous.map((item) => {
        const matches =
          item.messageId === target.messageId &&
          item.senderId === target.senderId &&
          item.receiverId === target.receiverId &&
          item.sessionId === target.sessionId;

        if (!matches || item.status === 'RECEIVED') {
          return item;
        }

        if (
          status === 'SENT' &&
          !['SENDING', 'SENT'].includes(item.status)
        ) {
          return item;
        }

        return { ...item, status, error };
      }),
    );
  }

  async function handleSendMessage(event) {
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

    let message = null;

    try {
      const sequenceKey = JSON.stringify([
        currentPeer.peerId,
        receiverId,
        connection.sessionId,
      ]);

      const sequence =
        (sequenceRef.current.get(sequenceKey) || 0) + 1;

      message = createChatMessage({
        senderId: currentPeer.peerId,
        receiverId,
        sessionId: connection.sessionId,
        sequence,
        content,
      });

      sequenceRef.current.set(sequenceKey, sequence);

      setChatMessages((previous) => [
        ...previous,
        {
          ...message,
          status: 'SENDING',
          error: null,
        },
      ]);

      setDrafts((previous) => ({
        ...previous,
        [receiverId]: '',
      }));

      setSendFeedback((previous) => ({
        ...previous,
        [receiverId]: '',
      }));

      await sendReliable(
        message,
        async (packet) => {
          const result = await sendWebRTC(
            packet.receiverId,
            packet,
          );

          updateMessageStatus(packet, 'SENT');

          return result;
        },
        (failedMessage, reason) => {
          updateMessageStatus(
            failedMessage,
            'FAILED',
            reason,
          );
        },
      );
    } catch (error) {
      const reason =
        error?.message || 'Không thể gửi tin nhắn.';

      if (message) {
        updateMessageStatus(message, 'FAILED', reason);
      } else {
        setSendFeedback((previous) => ({
          ...previous,
          [receiverId]: reason,
        }));
      }
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
                {message.senderId === currentPeer?.peerId && (
                  <small>
                    {' — '}
                    {MESSAGE_STATUS_LABELS[message.status] ||
                      'Đang chờ xác nhận'}

                    {message.status === 'FAILED' && message.error && (
                      <span> ({message.error})</span>
                    )}
                  </small>
                )}
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
