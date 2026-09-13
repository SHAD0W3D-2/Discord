function createFriendRequestManager() {
  const requests = new Map();
  const friends = new Map();

  function normalize(value) {
    return String(value || '').trim();
  }

  function ensureSet(map, key) {
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    return map.get(key);
  }

  function addRequest(fromUsername, toUsername) {
    const sender = normalize(fromUsername);
    const receiver = normalize(toUsername);

    if (!sender || !receiver || sender === receiver) {
      return { ok: false, reason: 'Invalid friend request.' };
    }

    const receiverRequests = ensureSet(requests, receiver);
    if (receiverRequests.has(sender)) {
      return { ok: false, reason: 'Friend request already sent.' };
    }

    receiverRequests.add(sender);
    return { ok: true };
  }

  function acceptRequest(username, friendUsername) {
    const user = normalize(username);
    const friend = normalize(friendUsername);

    if (!user || !friend || user === friend) {
      return { ok: false, reason: 'Invalid friend acceptance.' };
    }

    const userRequests = requests.get(user) || new Set();
    if (!userRequests.has(friend)) {
      return { ok: false, reason: 'No request from that user.' };
    }

    userRequests.delete(friend);
    const userFriends = ensureSet(friends, user);
    const friendFriends = ensureSet(friends, friend);

    userFriends.add(friend);
    friendFriends.add(user);

    requests.set(user, userRequests);
    return { ok: true };
  }

  function getRequests(username) {
    return Array.from(requests.get(normalize(username)) || []).sort((a, b) => a.localeCompare(b));
  }

  function getFriends(username) {
    return Array.from(friends.get(normalize(username)) || []).sort((a, b) => a.localeCompare(b));
  }

  function removeFriend(username, friendUsername) {
    const user = normalize(username);
    const friend = normalize(friendUsername);

    if (!user || !friend || user === friend) {
      return { ok: false, reason: 'Invalid friend removal.' };
    }

    const userFriends = friends.get(user);
    const friendFriends = friends.get(friend);

    userFriends?.delete(friend);
    friendFriends?.delete(user);
    return { ok: true };
  }

  return {
    addRequest,
    acceptRequest,
    removeFriend,
    getRequests,
    getFriends
  };
}

module.exports = { createFriendRequestManager };
