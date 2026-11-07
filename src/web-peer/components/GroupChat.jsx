import { useState } from 'react';

export default function GroupChat({ client, state, statusLabels }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState('');
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = state.currentPeer?.peerId;
  const archived = [...new Set(state.messages.filter(message => message.type === 'GROUP_MESSAGE').map(message => message.groupId))].filter(id => !state.groups.some(group => group.groupId === id)).map(groupId => ({ groupId, name: `Lịch sử nhóm ${groupId}`, members: [], ownerId: null, archived: true }));
  const group = [...state.groups, ...archived].find(item => item.groupId === selected);
  const online = id => state.onlinePeers.some(peer => peer.peerId === id);
  const run = async action => { setError(''); setBusy(true); try { await action(); } catch (error) { setError(error.message); } finally { setBusy(false); } };
  if (!owner) return null;
  return <section aria-label="Chat nhóm">
    <h2>Chat nhóm</h2>
    <form onSubmit={event => { event.preventDefault(); run(async () => {
      const result = await client.createGroup(name, members); setSelected(result.group.groupId); setName(''); setMembers([]);
    }); }}>
      <label>Tên nhóm: <input aria-label="Tên nhóm" value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label>
      <fieldset><legend>Thành viên nhóm mới</legend>
        {state.onlinePeers.filter(peer => peer.peerId !== owner).map(peer => <label key={peer.peerId} className="member-choice">
          <input type="checkbox" checked={members.includes(peer.peerId)} onChange={event => setMembers(previous => event.target.checked ? [...previous, peer.peerId] : previous.filter(id => id !== peer.peerId))} /> {peer.displayName} ({peer.peerId})
        </label>)}
      </fieldset>
      <button disabled={busy || !name.trim()}>Tạo nhóm</button>
    </form>
    <ul>{[...state.groups, ...archived].map(item => <li key={item.groupId}><button type="button" onClick={() => setSelected(item.groupId)}>{item.name}</button> {item.archived ? '(đã lưu cục bộ)' : `(${item.members.length} thành viên)`}</li>)}</ul>
    {group && <div>
      <h3>{group.name}</h3>
      {group.archived ? <p>Bạn có thể xem lịch sử đã lưu của nhóm này.</p> : <p>Chủ nhóm: {group.ownerId}</p>}
      {!group.archived && <fieldset><legend>Thành viên hiện tại</legend>
        {[...new Set([...group.members, ...state.onlinePeers.map(peer => peer.peerId)])].map(id => <label key={id} className="member-choice">
          <input type="checkbox" checked={group.members.includes(id)} disabled={busy || group.ownerId !== owner || id === group.ownerId}
            onChange={event => { const checked = event.target.checked; run(() => client.updateGroup(group.groupId, checked ? [...group.members, id] : group.members.filter(member => member !== id))); }} />
          {id} — {online(id) ? 'ONLINE' : 'OFFLINE'}
        </label>)}
      </fieldset>}
      <p>Thành viên offline được giữ trong nhóm; tin gửi khi họ offline được báo thất bại, không lưu chuyển tiếp trên server.</p>
      <ul aria-label="Tin nhắn nhóm">{state.messages.filter(message => message.groupId === group.groupId).map(message => <li key={JSON.stringify([message.senderId, message.messageId])}>
        <strong>{message.senderId === owner ? 'Bạn' : message.senderId}</strong>: {message.content}
        {message.deliveries ? <ul>{Object.entries(message.deliveries).map(([id, delivery]) => <li key={id}>{id}: {statusLabels[delivery.status]} [{delivery.deliveryMode}]{delivery.error && ` (${delivery.error})`}</li>)}</ul> : <small> [{message.deliveryMode}]</small>}
      </li>)}</ul>
      {!group.archived && <form onSubmit={event => { event.preventDefault(); try { client.sendGroup(group.groupId, drafts[group.groupId] || ''); setDrafts(previous => ({ ...previous, [group.groupId]: '' })); setError(''); } catch (error) { setError(error.message); } }}>
        <label>Tin nhắn nhóm: <input aria-label="Tin nhắn nhóm" maxLength={8000} value={drafts[group.groupId] || ''} onChange={event => { const value = event.target.value; setDrafts(previous => ({ ...previous, [group.groupId]: value })); }} /></label>
        <button disabled={!(drafts[group.groupId] || '').trim()}>Gửi nhóm</button>
      </form>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
