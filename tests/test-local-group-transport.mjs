import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalGroupTransport } from '../src/web-peer/services/localGroupTransport.js';
import { createGroupChat } from '../src/web-peer/services/groupChat.js';

test('BroadcastChannel demo: actual channel sync, chat, removal and offline timeout', async () => {
  const instances = [], chats = {};
  try {
    for (const id of ['local-a', 'local-b', 'local-c']) {
      const transport = createLocalGroupTransport(id, { timeoutMs: 100,
        onReceive: (m, sender) => chats[id].receive(m, sender) });
      instances.push(transport);
      chats[id] = createGroupChat({ peerId: id, sendToPeer: transport.sendToPeer, retries: 0, timeoutMs: 500 });
    }
    const { group, deliveries } = await chats['local-a'].createGroup('Local demo', ['local-b', 'local-c']);
    assert.ok(deliveries.every(d => d.status === 'received'));
    const result = await chats['local-b'].sendGroupMessage(group.groupId, 'hello tabs');
    assert.ok(result.deliveries.every(d => d.deliveryMode === 'LOCAL_DEMO'));
    assert.equal(chats['local-c'].getHistory(group.groupId)[0].content, 'hello tabs');
    await chats['local-a'].updateMembers(group.groupId, { remove: ['local-c'] });
    assert.equal(chats['local-c'].listGroups().length, 0);
    instances[1].close();
    const failure = await chats['local-a'].sendGroupMessage(group.groupId, 'offline');
    assert.equal(failure.deliveries[0].error, 'PEER_OFFLINE_OR_NOT_IN_THIS_BROWSER');
  } finally { instances.forEach(t => t.close()); }
});
