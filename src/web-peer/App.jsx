import GroupChatPanel from './GroupChatPanel.jsx';
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
  const [activeTab, setActiveTab] = useState('private');
  const [search, setSearch] = useState('');
  const contacts = [...new Set([
    ...onlinePeers.filter(p => p.peerId !== currentPeer?.peerId).map(p => p.peerId),
    ...state.messages.filter(m => m.type === 'CHAT_MESSAGE' && currentPeer).map(m => m.senderId === currentPeer.peerId ? m.receiverId : m.senderId)
  ])].filter(id => `${id} ${onlinePeers.find(p => p.peerId === id)?.displayName || ''}`.toLowerCase().includes(search.toLowerCase()));
  const selectedName = onlinePeers.find(p => p.peerId === selectedPeerId)?.displayName || selectedPeerId;
  return <main className="messenger">
    <header className="app-header">
      <div className="brand"><span className="brand-icon">↗</span><div><h1>DS01 Messenger</h1><small>Kết nối và trò chuyện cùng nhau</small></div></div>
      <div className="account"><span className={`status-dot ${connectionStatus.startsWith('Đã kết nối') ? 'online' : ''}`} />{currentPeer ? `${currentPeer.displayName} · ${currentPeer.peerId}` : 'Chưa tham gia'}
        <details><summary>Trạng thái kết nối</summary><p>{connectionStatus}</p><p>Relay: {state.relayReady ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</p></details>
      </div>
    </header>
    <div className="registration">
      {!currentPeer && <form onSubmit={e => { e.preventDefault(); handleRegister(); }}>
        <label>Peer ID<input value={peerId} onChange={e => setPeerId(e.target.value)} placeholder="Ví dụ: peer-a" /></label>
        <label>Tên hiển thị<input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Ví dụ: An" /></label>
        <button className="primary" disabled={!connectionStatus.startsWith('Đã kết nối') || !peerId.trim() || !displayName.trim()}>Tham gia mạng</button>
      </form>}
      {registrationStatus && <p role="status">{registrationStatus}</p>}
      {state.error && <p role="alert">{state.error} <button onClick={chatClient.clearError}>Đóng</button></p>}
      {sendFeedback.global && <p role="alert">{sendFeedback.global}</p>}
    </div>
    <nav className="chat-tabs" role="tablist" aria-label="Loại trò chuyện">
      <button id="private-tab" role="tab" aria-selected={activeTab === 'private'} aria-controls="private-panel" onClick={() => setActiveTab('private')}>◉ Trò chuyện riêng</button>
      <button id="group-tab" role="tab" aria-selected={activeTab === 'group'} aria-controls="group-panel" onClick={() => setActiveTab('group')}>♧ Trò chuyện nhóm</button>
    </nav>
    <div id="private-panel" role="tabpanel" aria-labelledby="private-tab" hidden={activeTab !== 'private'}>
      <div className="private-layout">
        <aside className="contacts"><h2>Đoạn chat</h2><p className="muted">Bạn bè và các cuộc trò chuyện</p>
          <input className="search" aria-label="Tìm người trò chuyện" placeholder="Tìm tên hoặc Peer ID" value={search} onChange={e => setSearch(e.target.value)} />
          <ul>{contacts.map(id => { const person = onlinePeers.find(p => p.peerId === id);
            const last = state.messages.filter(m => m.type === 'CHAT_MESSAGE' && ((m.senderId === id && m.receiverId === currentPeer?.peerId) || (m.receiverId === id && m.senderId === currentPeer?.peerId))).at(-1);
            return <li key={id} className={selectedPeerId === id ? 'contact selected' : 'contact'}>
              <span className="avatar">{(person?.displayName || id).slice(0, 1).toUpperCase()}<i className={`status-dot ${person ? 'online' : ''}`} /></span>
              <div className="contact-info"><strong>{person?.displayName || id}</strong><small>{person ? 'Đang hoạt động' : 'Ngoại tuyến'} · {id}</small><p>{last?.content || 'Bắt đầu cuộc trò chuyện'}</p></div>
              <button aria-label={`Chọn chat với ${id}`} onClick={() => setSelectedPeerId(id)}>Chọn chat</button>
            </li>;
          })}</ul>
          {!contacts.length && <p className="empty-note">{currentPeer ? 'Chưa có cuộc trò chuyện. Mở tab khác để thêm một người bạn.' : 'Tham gia mạng để bắt đầu trò chuyện.'}</p>}
        </aside>
        <section className="private-conversation">
          {!selectedPeerId ? <div className="empty-state"><span className="empty-icon">☏</span><h2>Tin nhắn của bạn</h2><p>Chọn một người ở bên trái để bắt đầu cuộc trò chuyện.</p></div> : <>
            <header className="conversation-header"><span className="avatar">{selectedName.slice(0, 1).toUpperCase()}</span><div><h2>{selectedName}</h2><small>{onlinePeers.some(p => p.peerId === selectedPeerId) ? 'Đang hoạt động' : 'Ngoại tuyến'} · {webrtcStates[selectedPeerId]?.state || 'Chưa kết nối'}</small></div>
              <button onClick={handleConnectWebRTC} disabled={!currentPeer || !onlinePeers.some(p => p.peerId === selectedPeerId) || !connectionStatus.startsWith('Đã kết nối') || ['CONNECTING', 'DIRECT_READY'].includes(webrtcStates[selectedPeerId]?.state)}>Kết nối WebRTC</button>
            </header>
            {webrtcErrors[selectedPeerId] && <p role="alert">{webrtcErrors[selectedPeerId]}</p>}
            <div className="private-messages" aria-live="polite">
              {!conversationMessages.length && <div className="empty-state"><h3>Gửi lời chào đến {selectedName}</h3><p>Kết nối rồi gửi tin nhắn đầu tiên.</p></div>}
              {conversationMessages.map(m => <article className={`bubble ${m.senderId === currentPeer?.peerId ? 'mine' : ''}`} key={`${m.senderId}:${m.messageId}`}>
                <small>{m.senderId === currentPeer?.peerId ? 'Bạn' : selectedName}</small><p>{m.content}</p>
                <small>{m.deliveryMode}{m.senderId === currentPeer?.peerId && ` · ${MESSAGE_STATUS_LABELS[m.status] || 'Đang chờ xác nhận'}`}{m.error && ` (${m.error})`}</small>
              </article>)}
            </div>
            <form className="composer" onSubmit={handleSendMessage}><input aria-label="Tin nhắn riêng" value={drafts[selectedPeerId] || ''} onChange={e => setDrafts(old => ({ ...old, [selectedPeerId]: e.target.value }))} disabled={!ready} placeholder="Nhập tin nhắn..." maxLength={8000} /><button className="primary" disabled={!currentPeer || !ready || !(drafts[selectedPeerId] || '').trim()}>Gửi tin</button></form>
            {sendFeedback[selectedPeerId] && <p role="status">{sendFeedback[selectedPeerId]}</p>}
          </>}
        </section>
      </div>
    </div>
    <div id="group-panel" role="tabpanel" aria-labelledby="group-tab" hidden={activeTab !== 'group'}>
      {currentPeer ? <GroupChatPanel key={currentPeer.peerId} currentPeer={currentPeer} onlinePeers={onlinePeers} /> : <div className="empty-state"><span className="empty-icon">♧</span><h2>Trò chuyện nhóm</h2><p>Tham gia mạng để tạo nhóm và trò chuyện với mọi người.</p></div>}
    </div>
  </main>;
}
