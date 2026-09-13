const assert = require('node:assert/strict');
const { createAuthManager } = require('../authManager');

const manager = createAuthManager();

const firstRegister = manager.register('alice', 'secret123');
assert.equal(firstRegister.ok, true, 'first registration should succeed');

const duplicateRegister = manager.register('alice', 'otherpass');
assert.equal(duplicateRegister.ok, false, 'duplicate username should fail');

const validLogin = manager.login('alice', 'secret123');
assert.equal(validLogin.ok, true, 'valid login should succeed');

const avatarRegister = manager.register('bob', 'pass456', 'data:image/png;base64,avatar');
assert.equal(avatarRegister.ok, true, 'avatar registration should succeed');

const avatarProfile = manager.getUserProfile('bob');
assert.equal(avatarProfile.avatar, 'data:image/png;base64,avatar', 'avatar should be stored for the user');

const invalidLogin = manager.login('alice', 'wrongpass');
assert.equal(invalidLogin.ok, false, 'wrong password should fail');

console.log('auth tests passed');
