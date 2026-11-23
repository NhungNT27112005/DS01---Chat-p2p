import { useEffect, useState, useSyncExternalStore } from 'react';
import { chatClient } from './services/chat.js';

const MESSAGE_STATUS_LABELS = {
  SENDING: 'Đang gửi', SENT: 'Đã gửi, chờ xác nhận', FORWARDED: 'Đã chuyển tiếp, chờ xác nhận',
  RECEIVED: 'Đã nhận', FAILED: 'Chưa xác nhận được',
};

export default function App() {
  const state = useSyncExternalStore(chatClient.subscribe, chatClient.getState);
  const identity = chatClient.getIdentity();
  const [peerId, setPeerId] = useState(identity?.peerId || '');
  const [displayName, setDisplayName] = useState(identity?.displayName || '');
  const [selectedPeerId, setSelectedPeerId] = useState('');
  const [webrtcErrors, setWebrtcErrors] = useState({});
  const [drafts, setDrafts] = useState({});
  const [sendFeedback, setSendFeedback] = useState({});
  const { connectionStatus, registrationStatus, currentPeer } = state;
  const onlinePeers = state.onlinePeers; // xem danh sách peer đang online
  const webrtcStates = state.routes;
  const ready = ['DIRECT_READY', 'RELAY_READY'].includes(webrtcStates[selectedPeerId]?.state);
  useEffect(() => { chatClient.start(); return () => chatClient.stop(); }, []);
  function handleRegister() {
    try { chatClient.register(peerId, displayName); }
    catch (error) { setSendFeedback(previous => ({ ...previous, global: error.message })); }
  }
  async function handleConnectWebRTC() {
    const receiverId = selectedPeerId;
    setWebrtcErrors(previous => ({ ...previous, [receiverId]: '' }));
    try { await chatClient.connect(receiverId); }
    catch (error) { setWebrtcErrors(previous => ({ ...previous, [receiverId]: error.message })); }
  }
  function handleSendMessage(event) {
    event.preventDefault();
    try {
      chatClient.sendPrivate(selectedPeerId, drafts[selectedPeerId] || '');
      setDrafts(previous => ({ ...previous, [selectedPeerId]: '' }));
      setSendFeedback(previous => ({ ...previous, [selectedPeerId]: '' }));
    } catch (error) { setSendFeedback(previous => ({ ...previous, [selectedPeerId]: error.message })); }
  }
  const conversationMessages = state.messages.filter(message => message.type === 'CHAT_MESSAGE' && (
    (message.senderId === currentPeer?.peerId && message.receiverId === selectedPeerId) ||
    (message.senderId === selectedPeerId && message.receiverId === currentPeer?.peerId)
  )).map(message => ({ ...message, status: message.deliveries?.[selectedPeerId]?.status,
    error: message.deliveries?.[selectedPeerId]?.error,
    deliveryMode: message.deliveries?.[selectedPeerId]?.deliveryMode || message.deliveryMode }));
  return (
    <main>
      <p className="label">DS01 · DIRECT / RELAY</p>
      <h1>Chat P2P bằng JavaScript</h1>
      <p>Trạng thái: {connectionStatus}</p>
      <p>Relay: {state.relayReady ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</p>
      {state.error && <p role="alert">{state.error} <button type="button" onClick={chatClient.clearError}>Đóng</button></p>}
      {sendFeedback.global && <p role="alert">{sendFeedback.global}</p>}
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
          !connectionStatus.startsWith('Đã kết nối') || !!currentPeer ||
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

      {currentPeer && <div>
        <h2>Lịch sử cá nhân</h2>
        {[...new Set(state.messages.filter(message => message.type === 'CHAT_MESSAGE').map(message => message.senderId === currentPeer.peerId ? message.receiverId : message.senderId))].map(id =>
          <button type="button" key={id} onClick={() => setSelectedPeerId(id)}>{id}{onlinePeers.some(peer => peer.peerId === id) ? '' : ' (OFFLINE)'}</button>
        )}
      </div>}

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
              !onlinePeers.some(peer => peer.peerId === selectedPeerId) ||
              !connectionStatus.startsWith('Đã kết nối') ||
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
                <small> [{message.deliveryMode}]</small>
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
                    !ready
                  }
                  placeholder="Nhập tin nhắn..."
                  maxLength={8000}
                />
              </label>
            </p>

            <button
              type="submit"
              disabled={
                !currentPeer ||
                !ready ||
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
