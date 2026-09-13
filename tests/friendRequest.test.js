const assert = require('node:assert/strict');
const { createFriendRequestManager } = require('../friendRequestManager');

const manager = createFriendRequestManager();

const sent = manager.addRequest('alice', 'bob');
assert.equal(sent.ok, true, 'friend request should be sent');
assert.deepEqual(manager.getRequests('bob'), ['alice']);

const duplicate = manager.addRequest('alice', 'bob');
assert.equal(duplicate.ok, false, 'duplicate request should be rejected');

const accepted = manager.acceptRequest('bob', 'alice');
assert.equal(accepted.ok, true, 'request should be accepted');
assert.deepEqual(manager.getFriends('alice'), ['bob']);
assert.deepEqual(manager.getFriends('bob'), ['alice']);

console.log('friend request tests passed');
