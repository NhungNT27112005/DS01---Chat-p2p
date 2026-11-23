const clone = value => structuredClone(value);
export function fail(code) { throw new Error(code); }
export function peer(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) fail('INVALID_PEER_ID');
  return value;
}
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
export function validateGroup(g) {
  if (!g || !text(g.groupId) || !text(g.name) || !Number.isSafeInteger(g.version) ||
      g.version < 1 || !Number.isFinite(g.createdAt) || g.createdAt < 0 ||
      !Array.isArray(g.members) || !g.members.includes(g.createdBy) ||
      new Set(g.members).size !== g.members.length ||
      !Array.isArray(g.formerMembers ?? []) ||
      new Set(g.formerMembers ?? []).size !== (g.formerMembers ?? []).length ||
      (g.formerMembers ?? []).some(id => g.members.includes(id))) fail('INVALID_GROUP');
  peer(g.createdBy);
  [...g.members, ...(g.formerMembers ?? [])].forEach(peer);
  return clone({ groupId: g.groupId, name: g.name, createdBy: g.createdBy,
    members: g.members, formerMembers: g.formerMembers ?? [], version: g.version, createdAt: g.createdAt });
}
const canonical = g => JSON.stringify({ ...g, members: [...g.members].sort(), formerMembers: [...g.formerMembers].sort() });

// Mỗi nhà máy đều có một cửa hàng riêng. Các module xuất khẩu bên dưới giữ nguyên API cũ.
export function createGroupManager(initial = []) {
  const groups = new Map(initial.map(g => { const v = validateGroup(g); return [v.groupId, v]; }));
  const getGroup = id => clone(groups.get(id) ?? null);
  function createGroup(name, creatorId, memberIds = []) {
    peer(creatorId);
    if (!Array.isArray(memberIds)) fail('INVALID_MEMBERS');
    memberIds.forEach(peer);
    const g = validateGroup({ groupId: crypto.randomUUID(), name: typeof name === 'string' ? name.trim() : name,
      createdBy: creatorId, members: [...new Set([creatorId, ...memberIds])], formerMembers: [], version: 1, createdAt: Date.now() });
    groups.set(g.groupId, g);
    return clone(g);
  }
  function saveReceivedGroup(input, authenticatedSenderId = input?.createdBy) {
    const g = validateGroup(input), old = groups.get(g.groupId);
    if (authenticatedSenderId !== g.createdBy) fail('CREATOR_REQUIRED');
    if (old && (old.createdBy !== g.createdBy || old.createdAt !== g.createdAt)) fail('GROUP_IDENTITY_CONFLICT');
    if (old && old.version === g.version && canonical(old) !== canonical(g)) fail('VERSION_CONFLICT');
    if (old && old.version >= g.version) return { updated: false, group: clone(old) };
    groups.set(g.groupId, g);
    return { updated: true, group: clone(g) };
  }
  function getRecipients(id, senderId) {
    const g = groups.get(id);
    if (!g) fail('GROUP_NOT_FOUND');
    if (!g.members.includes(senderId)) fail('NOT_MEMBER');
    return g.members.filter(id => id !== senderId);
  }
  function updateMembers(id, actor, { add = [], remove = [] } = {}) {
    const g = getGroup(id);
    if (!g) fail('GROUP_NOT_FOUND');
    if (actor !== g.createdBy) fail('CREATOR_REQUIRED');
    if (!Array.isArray(add) || !Array.isArray(remove)) fail('INVALID_MEMBERS');
    [...add, ...remove].forEach(peer);
    if (remove.includes(g.createdBy)) fail('CANNOT_REMOVE_CREATOR');
    if (add.some(id => remove.includes(id))) fail('CONFLICTING_UPDATE');
    const members = [...new Set([...g.members, ...add])].filter(id => !remove.includes(id));
    if (JSON.stringify([...members].sort()) === JSON.stringify([...g.members].sort())) return g;
    const formerMembers = [...new Set([...g.formerMembers, ...g.members])].filter(id => !members.includes(id));
    return saveReceivedGroup({ ...g, members, formerMembers, version: g.version + 1 }, actor).group;
  }
  return { createGroup, getGroup, getRecipients, updateMembers, saveReceivedGroup,
    listGroups: () => [...groups.values()].map(clone) };
}
const defaultManager = createGroupManager();
export const { createGroup, getGroup, getRecipients, updateMembers, saveReceivedGroup, listGroups } = defaultManager;
