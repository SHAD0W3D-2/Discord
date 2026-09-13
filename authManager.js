const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createAuthManager(storagePath = null) {
  const users = new Map();

  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  function passwordsMatch(password, storedPassword) {
    const [salt, storedHash] = String(storedPassword || '').split(':');
    if (!salt || !storedHash) {
      return false;
    }

    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  }

  function sanitizeAvatar(value) {
    const avatar = String(value || '').trim();
    if (!avatar || !avatar.startsWith('data:image/')) {
      return '';
    }
    return avatar.length > 250000 ? avatar.slice(0, 250000) : avatar;
  }

  function normalizeProfileRecord(record) {
    if (typeof record === 'string') {
      return { password: record, avatar: '' };
    }

    if (record && typeof record === 'object') {
      return {
        password: String(record.password || ''),
        avatar: sanitizeAvatar(record.avatar || '')
      };
    }

    return { password: '', avatar: '' };
  }

  function loadUsers() {
    if (!storagePath) {
      return;
    }

    try {
      const storedUsers = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      Object.entries(storedUsers).forEach(([username, record]) => {
        const profile = normalizeProfileRecord(record);
        if (profile.password) {
          users.set(username, profile);
        }
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Could not restore accounts:', error.message);
      }
    }
  }

  function saveUsers() {
    if (!storagePath) {
      return;
    }

    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, JSON.stringify(Object.fromEntries(
      [...users].map(([username, profile]) => [username, {
        password: profile.password || '',
        avatar: sanitizeAvatar(profile.avatar || '')
      }])
    ), null, 2));
  }

  loadUsers();

  function normalizeUsername(value) {
    return String(value || '').trim();
  }

  function register(username, password, avatar = '') {
    const safeUsername = normalizeUsername(username);
    const safePassword = String(password || '').trim();

    if (!safeUsername || !safePassword) {
      return { ok: false, reason: 'Username and password are required.' };
    }

    if (users.has(safeUsername)) {
      return { ok: false, reason: 'Username already exists.' };
    }

    const safeAvatar = sanitizeAvatar(avatar);
    users.set(safeUsername, {
      password: hashPassword(safePassword),
      avatar: safeAvatar
    });
    saveUsers();
    return { ok: true, username: safeUsername, profile: { username: safeUsername, avatar: safeAvatar } };
  }

  function login(username, password) {
    const safeUsername = normalizeUsername(username);
    const safePassword = String(password || '').trim();

    const storedProfile = users.get(safeUsername);
    if (!storedProfile || !passwordsMatch(safePassword, storedProfile.password)) {
      return { ok: false, reason: 'Invalid username or password.' };
    }

    return {
      ok: true,
      username: safeUsername,
      profile: {
        username: safeUsername,
        avatar: sanitizeAvatar(storedProfile.avatar || '')
      }
    };
  }

  function getUserProfile(username) {
    const safeUsername = normalizeUsername(username);
    const storedProfile = users.get(safeUsername);
    if (!storedProfile) {
      return null;
    }

    return {
      username: safeUsername,
      avatar: sanitizeAvatar(storedProfile.avatar || '')
    };
  }

  function listUserProfiles() {
    return Object.fromEntries(
      [...users].map(([username, profile]) => [username, { avatar: sanitizeAvatar(profile.avatar || '') }])
    );
  }

  function setUserAvatar(username, avatar) {
    const safeUsername = normalizeUsername(username);
    const record = users.get(safeUsername);
    if (!record) {
      return { ok: false, reason: 'User not found.' };
    }

    const safeAvatar = sanitizeAvatar(avatar);
    record.avatar = safeAvatar;
    saveUsers();
    return { ok: true, profile: { username: safeUsername, avatar: safeAvatar } };
  }

  return { register, login, getUserProfile, listUserProfiles, setUserAvatar };
}

module.exports = { createAuthManager };
