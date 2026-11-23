import { useEffect, useRef, useState } from 'react';
import { createGroupChat } from './services/groupChat.js';
import { createGroupStorage } from './services/groupStorage.js';
import { createLocalGroupTransport } from './services/localGroupTransport.js';

const deliveryText = deliveries => deliveries.map(d =>
  `${d.receiverId}: ${d.status === 'received' ? 'đã nhận' : d.status === 'pending' ? 'đang gửi' : `lỗi (${d.error})`}`
).join(' · ');

export default function GroupChatPanel({ currentPeer, onlinePeers }) {
  const service = useRef(null);
  const [revision, refresh] = useState(0);
  const [groupId, setGroupId] = useState('');
  const [name, setName] = useState('');
  const [members, setMembers] = useState([]);
  const [content, setContent] = useState('');
  const [memberId, setMemberId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const peerId = currentPeer.peerId;
  const onlineKey = onlinePeers.map(p => p.peerId).sort().join(',');

  useEffect(() => {
    let active = true;
    const changed = () => { if (active) refresh(n => n + 1); };
    let transport;
    try {
      let chat;
      transport = createLocalGroupTransport(peerId, {
        onReceive: (envelope, sender) => chat.receive(envelope, sender), onChange: changed
      });
      chat = createGroupChat({ peerId, sendToPeer: transport.sendToPeer,
        storage: createGroupStorage(localStorage, peerId) });
      service.current = chat;
      changed();
    } catch (e) { setError(`Không mở được chat nhóm: ${e.message}`); }
    return () => { active = false; service.current = null; transport?.close(); };
  }, [peerId]);

  // A creator re-announces snapshots when a peer registers/reconnects.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const results = await service.current?.reconnect();
        if (active) {
          refresh(n => n + 1);
          const failures = results?.filter(r => r.error || r.deliveries?.some(d => d.status === 'failed'));
          if (failures?.length) setNotice('Một số nhóm chưa đồng bộ được. Mở tab của người tạo rồi bấm Đồng bộ nhóm.');
        }
      } catch (e) { if (active) setError(e.message); }
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [peerId, onlineKey]);

  const groups = service.current?.listGroups() ?? [];
  const selected = groups.find(g => g.groupId === groupId) ?? groups[0];
  const history = selected ? service.current?.getHistory(selected.groupId) ?? [] : [];
  const candidates = onlinePeers.filter(p => p.peerId !== peerId);
  void revision;

  async function run(action) {
    setError(''); setNotice(''); setBusy(true);
    try { await action(service.current); }
    catch (e) { setError(e.message); }
    finally { refresh(n => n + 1); setBusy(false); }
  }
  function summarize(result) {
    const failed = result.deliveries.filter(d => d.status !== 'received');
    setNotice(failed.length ? `Đã lưu; ${deliveryText(result.deliveries)}` : 'Đã hoàn tất và nhận ACK từ các thành viên.');
  }

  return <section className="group-demo">
    <h2>Chat nhóm thử nghiệm</h2>
    <p className="demo-note">Thử cục bộ: mở các tab cùng địa chỉ trong cùng trình duyệt, mỗi tab dùng một Peer ID khác nhau. Chưa gửi qua DIRECT/RELAY hoặc giữa các máy.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <div className="group-layout">
      <aside>
        <h3>Tạo nhóm</h3>
        <form onSubmit={e => { e.preventDefault(); run(async chat => {
          const result = await chat.createGroup(name, members);
          setGroupId(result.group.groupId); setName(''); setMembers([]); summarize(result);
        }); }}>
          <label>Tên nhóm<input value={name} maxLength={200} onChange={e => setName(e.target.value)} placeholder="Nhóm học tập" required /></label>
          <fieldset disabled={busy}><legend>Chọn thành viên đang online</legend>
            {!candidates.length && <p>Mở tab khác và đăng ký peer để chọn.</p>}
            {candidates.map(p => <label className="member-choice" key={p.peerId}>
              <input type="checkbox" checked={members.includes(p.peerId)} onChange={e => setMembers(old => e.target.checked ? [...old, p.peerId] : old.filter(id => id !== p.peerId))} />
              {p.displayName} ({p.peerId})
            </label>)}
          </fieldset>
          <button disabled={busy || !service.current || !name.trim() || !members.length}>Tạo nhóm</button>
        </form>
        <h3>Nhóm của bạn ({groups.length})</h3>
        {!groups.length && <p>Chưa có nhóm. Tạo nhóm hoặc đợi lời mời từ tab khác.</p>}
        <nav className="group-list" aria-label="Danh sách nhóm">{groups.map(g =>
          <button key={g.groupId} className={selected?.groupId === g.groupId ? 'selected' : ''} onClick={() => setGroupId(g.groupId)}>{g.name} ({g.members.length})</button>
        )}</nav>
        <button disabled={busy || !service.current} onClick={() => run(async chat => {
          const results = await chat.reconnect();
          const failed = results.filter(r => r.error || r.deliveries?.some(d => d.status === 'failed'));
          setNotice(failed.length ? 'Có peer chưa phản hồi. Kiểm tra các tab và thử đồng bộ lại.' : 'Đã đồng bộ nhóm.');
        })}>Đồng bộ nhóm</button>
      </aside>
      <div className="conversation">
        {!selected ? <p>Chọn hoặc tạo một nhóm để bắt đầu.</p> : <>
          <h3>{selected.name}</h3>
          <p className="muted">Phiên bản {selected.version} · Người tạo: {selected.createdBy}</p>
          <div className="member-list">{selected.members.map(id => <span key={id}>{id}
            {selected.createdBy === peerId && id !== peerId && <button disabled={busy} aria-label={`Xóa ${id}`} onClick={() => run(async chat => summarize(await chat.updateMembers(selected.groupId, { remove: [id] })))}>×</button>}
          </span>)}</div>
          {selected.createdBy === peerId && <form className="inline-form" onSubmit={e => { e.preventDefault(); run(async chat => {
            summarize(await chat.updateMembers(selected.groupId, { add: [memberId.trim()] })); setMemberId('');
          }); }}><input aria-label="Peer ID cần thêm" placeholder="Peer ID cần thêm" value={memberId} onChange={e => setMemberId(e.target.value)} /><button disabled={busy || !memberId.trim()}>Thêm thành viên</button></form>}
          <div className="messages" aria-label="Lịch sử tin nhắn" aria-live="polite">
            {!history.length && <p className="muted">Chưa có tin nhắn.</p>}
            {history.map(m => <article key={m.messageId} className={m.senderId === peerId ? 'message mine' : 'message'}>
              <small><strong>{m.senderId === peerId ? 'Bạn' : m.senderId}</strong> · {new Date(m.timestamp).toLocaleTimeString('vi-VN')}</small>
              <p>{m.content}</p>
              {m.direction === 'out' && <><small>{deliveryText(m.deliveries) || 'Nhóm chưa có người nhận khác'}</small>
                {m.deliveries.some(d => d.status !== 'received') && <button disabled={busy} onClick={() => run(async chat => summarize(await chat.retryMessage(m.messageId)))}>Thử gửi lại</button>}
              </>}
            </article>)}
          </div>
          <form className="inline-form" onSubmit={e => { e.preventDefault(); const text = content; run(async chat => {
            const result = await chat.sendGroupMessage(selected.groupId, text); setContent(''); summarize(result);
          }); }}><input aria-label="Nội dung tin nhắn" placeholder="Nhập tin nhắn…" value={content} onChange={e => setContent(e.target.value)} maxLength={4000} /><button disabled={busy || !content.trim()}>Gửi</button></form>
        </>}
      </div>
    </div>
  </section>;
}
