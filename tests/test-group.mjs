import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupManager, createGroup, getGroup, getRecipients, saveReceivedGroup } from '../src/web-peer/services/groupManager.js';

test('legacy API and isolated stores, defensive copies', () => {
  const g = createGroup('Study', 'a', ['b', 'b']);
  assert.deepEqual(getRecipients(g.groupId, 'a'), ['b']);
  assert.equal(saveReceivedGroup(g).updated, false);
  g.members.push('c');
  assert.deepEqual(getGroup(g.groupId).members, ['a', 'b']);
  assert.equal(createGroupManager().getGroup(g.groupId), null);
});
test('validation, creator permissions, versions and conflicting snapshots', () => {
  const m = createGroupManager();
  assert.throws(() => m.createGroup('', 'a'), /INVALID_GROUP/);
  assert.throws(() => m.createGroup('x', 'bad peer'), /INVALID_PEER_ID/);
  assert.throws(() => m.createGroup('x', 'a', 'b'), /INVALID_MEMBERS/);
  const g = m.createGroup('x', 'a', ['b']);
  assert.throws(() => m.getRecipients(g.groupId, 'z'), /NOT_MEMBER/);
  assert.throws(() => m.updateMembers(g.groupId, 'b', { add: ['c'] }), /CREATOR_REQUIRED/);
  assert.throws(() => m.updateMembers(g.groupId, 'a', { remove: ['a'] }), /CANNOT_REMOVE_CREATOR/);
  assert.equal(m.updateMembers(g.groupId, 'a', { add: ['b'] }).version, 1);
  const next = m.updateMembers(g.groupId, 'a', { add: ['c'], remove: ['b'] });
  assert.equal(next.version, 2);
  assert.deepEqual(next.formerMembers, ['b']);
  assert.equal(m.saveReceivedGroup(g, 'a').updated, false);
  assert.throws(() => m.saveReceivedGroup({ ...next, name: 'other' }, 'a'), /VERSION_CONFLICT/);
  assert.throws(() => m.saveReceivedGroup({ ...next, version: 3, createdBy: 'c' }, 'c'), /GROUP_IDENTITY_CONFLICT/);
  assert.throws(() => m.saveReceivedGroup({ ...next, version: 3 }, 'b'), /CREATOR_REQUIRED/);
  assert.throws(() => m.saveReceivedGroup({ ...next, members: ['a', 'a'] }), /INVALID_GROUP/);
  assert.throws(() => m.saveReceivedGroup({ ...next, version: 0 }), /INVALID_GROUP/);
});
