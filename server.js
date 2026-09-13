const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createFriendRequestManager } = require('./friendRequestManager');
const { createAuthManager } = require('./authManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });
const friendRequestManager = createFriendRequestManager();
const authManager = createAuthManager(path.join(__dirname, 'data', 'users.json'));

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.use(express.json({ limit: '10mb' }));

app.get('/api/users', (_req, res) => {
  res.json(authManager.listUserProfiles());
});

app.post('/api/profile-picture', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const avatar = String(req.body?.avatar || '').trim();
  const result = authManager.setUserAvatar(username, avatar);

  if (!result.ok) {
    res.status(400).json(result);
    return;
  }

  io.emit('user-profiles', authManager.listUserProfiles());
  io.emit('profile-updated', result.profile);
  res.json(result);
});

app.use(express.static(publicDir));

const rooms = new Map();
const roomMessages = new Map();
const roomOwners = new Map();
const roomPasswords = new Map();

function ensureRoom(roomName, ownerUsername) {
  const safeName = (roomName || 'general').trim();
  if (!rooms.has(safeName)) {
    rooms.set(safeName, new Set());
    if (ownerUsername) {
      roomOwners.set(safeName, ownerUsername);
    }
  }
  if (!roomMessages.has(safeName)) {
    roomMessages.set(safeName, []);
  }
  return safeName;
}

function canDeleteRoom(roomName, username) {
  return roomName !== 'general' && roomOwners.get(roomName) === username;
}

function getDmRoomName(firstUsername, secondUsername) {
  return `dm:${[firstUsername, secondUsername].sort().join(':')}`;
}

function getFriendsForUser(username) {
  return friendRequestManager.getFriends(username);
}

function getRequestsForUser(username) {
  return friendRequestManager.getRequests(username);
}

function getOnlineUsers() {
  return [...new Set(
    [...io.sockets.sockets.values()]
      .map((socket) => socket.data.username)
      .filter((username) => username && username !== 'Guest')
  )].sort((a, b) => a.localeCompare(b));
}

function broadcastPresence() {
  io.emit('online-users', getOnlineUsers());
}

function emitFriendLists(username) {
  const targetSocket = [...io.sockets.sockets.values()].find((socket) => socket.data.username === username);
  if (targetSocket) {
    targetSocket.emit('friend-list', getFriendsForUser(username));
    targetSocket.emit('friend-request-list', getRequestsForUser(username));
  }
}

io.on('connection', (socket) => {
  socket.on('register-account', ({ username, password }) => {
    const result = authManager.register(username, password);
    if (result.ok) {
      socket.data.username = result.username;
      socket.data.avatar = result.profile.avatar || '';
      io.emit('user-profiles', authManager.listUserProfiles());
    }
    socket.emit('auth-result', result);
  });

  socket.on('login-account', ({ username, password }) => {
    const result = authManager.login(username, password);
    if (result.ok) {
      socket.data.username = result.username;
      socket.data.avatar = result.profile.avatar || '';
      io.emit('user-profiles', authManager.listUserProfiles());
      socket.emit('auth-result', result);
      return;
    }

    socket.emit('auth-result', result);
  });

  socket.on('update-profile-picture', ({ avatar }) => {
    const currentUser = (socket.data.username || '').trim();
    if (!currentUser) {
      socket.emit('profile-updated', { ok: false, reason: 'You need to be logged in first.' });
      return;
    }

    const result = authManager.setUserAvatar(currentUser, avatar);
    if (!result.ok) {
      socket.emit('profile-updated', result);
      return;
    }

    socket.data.avatar = result.profile.avatar || '';
    io.emit('user-profiles', authManager.listUserProfiles());
    io.emit('profile-updated', result.profile);
  });

  socket.on('join-room', ({ username, room, password }) => {
    const safeUsername = (username || 'Guest').trim().slice(0, 24) || 'Guest';
    const requestedRoom = (room || 'general').trim() || 'general';

    const isDirectMessage = requestedRoom.startsWith('dm:');
    if (requestedRoom !== 'general' && !isDirectMessage) {
      if (!rooms.has(requestedRoom)) {
        socket.emit('room-access-denied', { reason: 'That server does not exist.' });
        return;
      }

      const isOwner = roomOwners.get(requestedRoom) === safeUsername;
      if (!isOwner && roomPasswords.get(requestedRoom) !== String(password || '')) {
        socket.emit('room-access-required', { room: requestedRoom });
        return;
      }
    }

    const safeRoom = ensureRoom(requestedRoom);
    const previousRoom = socket.data.room;
    const previousUsername = socket.data.username;

    if (previousRoom && previousRoom !== safeRoom) {
      socket.leave(previousRoom);
      const previousUsers = rooms.get(previousRoom);
      if (previousUsers) {
        previousUsers.delete(previousUsername);
        io.to(previousRoom).emit('room-users', Array.from(previousUsers));
      }
    }

    socket.join(safeRoom);
    socket.data.username = safeUsername;
    socket.data.room = safeRoom;

    rooms.get(safeRoom).add(safeUsername);

    emitFriendLists(safeUsername);
    socket.emit('room-history', { room: safeRoom, messages: roomMessages.get(safeRoom) });
    io.to(safeRoom).emit('room-users', Array.from(rooms.get(safeRoom)));
    broadcastPresence();
  });

  socket.on('voice-join', () => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (!room || !username) {
      return;
    }

    socket.data.voiceRoom = room;
    socket.join(`voice:${room}`);
    socket.to(`voice:${room}`).emit('voice-user-joined', { socketId: socket.id, username });
    socket.emit('voice-users', [...io.sockets.sockets.values()]
      .filter((peer) => peer.data.voiceRoom === room && peer.id !== socket.id)
      .map((peer) => ({ socketId: peer.id, username: peer.data.username })));
  });

  socket.on('voice-leave', () => {
    const room = socket.data.voiceRoom;
    if (!room) {
      return;
    }

    socket.leave(`voice:${room}`);
    socket.to(`voice:${room}`).emit('voice-user-left', { socketId: socket.id });
    socket.data.voiceRoom = null;
  });

  socket.on('voice-offer', ({ target, offer }) => {
    if (target && offer) {
      io.to(target).emit('voice-offer', { sender: socket.id, offer });
    }
  });

  socket.on('voice-answer', ({ target, answer }) => {
    if (target && answer) {
      io.to(target).emit('voice-answer', { sender: socket.id, answer });
    }
  });

  socket.on('voice-ice-candidate', ({ target, candidate }) => {
    if (target && candidate) {
      io.to(target).emit('voice-ice-candidate', { sender: socket.id, candidate });
    }
  });

  socket.on('send-friend-request', ({ username, friendName }) => {
    const sender = (username || socket.data.username || '').trim();
    const target = (friendName || '').trim();

    if (!sender || !target || sender === target) {
      socket.emit('system-message', { text: 'Invalid friend request.', time: new Date().toISOString() });
      return;
    }

    const result = friendRequestManager.addRequest(sender, target);
    if (!result.ok) {
      socket.emit('system-message', { text: result.reason || 'Unable to send friend request.', time: new Date().toISOString() });
      return;
    }

    emitFriendLists(sender);
    emitFriendLists(target);
    socket.emit('system-message', { text: `Friend request sent to ${target}.`, time: new Date().toISOString() });
  });

  socket.on('accept-friend-request', ({ requestUser }) => {
    const currentUser = (socket.data.username || '').trim();
    const fromUser = (requestUser || '').trim();

    if (!currentUser || !fromUser) {
      socket.emit('system-message', { text: 'Invalid friend request acceptance.', time: new Date().toISOString() });
      return;
    }

    const result = friendRequestManager.acceptRequest(currentUser, fromUser);
    if (!result.ok) {
      socket.emit('system-message', { text: result.reason || 'Could not accept that request.', time: new Date().toISOString() });
      return;
    }

    emitFriendLists(currentUser);
    emitFriendLists(fromUser);
    socket.emit('system-message', { text: `You are now friends with ${fromUser}.`, time: new Date().toISOString() });
  });

  socket.on('decline-friend-request', ({ requestUser }) => {
    const currentUser = (socket.data.username || '').trim();
    const fromUser = (requestUser || '').trim();

    const requests = friendRequestManager.getRequests(currentUser);
    if (!requests.includes(fromUser)) {
      socket.emit('system-message', { text: `No pending request from ${fromUser}.`, time: new Date().toISOString() });
      return;
    }

    const result = friendRequestManager.acceptRequest(currentUser, fromUser);
    if (result.ok) {
      emitFriendLists(currentUser);
      emitFriendLists(fromUser);
    }

    socket.emit('system-message', { text: `Friend request from ${fromUser} was dismissed.`, time: new Date().toISOString() });
  });

  socket.on('remove-friend', ({ friendName }) => {
    const currentUser = (socket.data.username || '').trim();
    const friend = (friendName || '').trim();
    const result = friendRequestManager.removeFriend(currentUser, friend);

    if (!result.ok) {
      socket.emit('system-message', { text: result.reason || 'Could not remove that friend.', time: new Date().toISOString() });
      return;
    }

    const dmRoom = getDmRoomName(currentUser, friend);
    rooms.delete(dmRoom);
    roomMessages.delete(dmRoom);
    for (const dmSocket of io.sockets.sockets.values()) {
      if (dmSocket.data.room === dmRoom) {
        dmSocket.leave(dmRoom);
        dmSocket.data.room = null;
      }
    }

    emitFriendLists(currentUser);
    emitFriendLists(friend);
    for (const targetSocket of io.sockets.sockets.values()) {
      if (targetSocket.data.username === currentUser) {
        targetSocket.emit('friend-removed', { friendName: friend });
      } else if (targetSocket.data.username === friend) {
        targetSocket.emit('friend-removed', { friendName: currentUser });
      }
    }
    socket.emit('system-message', { text: `${friend} was removed from your friends.`, time: new Date().toISOString() });
  });

  socket.on('create-room', (roomName) => {
    const requestedRoom = typeof roomName === 'object' ? roomName.name : roomName;
    const password = typeof roomName === 'object' ? roomName.password : '';
    const safeRoomName = (requestedRoom || '').trim();
    const safePassword = String(password || '').trim();

    if (!socket.data.username || !safeRoomName || safeRoomName === 'general' || !safePassword) {
      socket.emit('room-create-result', { ok: false, reason: 'A server name and password are required.' });
      return;
    }

    if (rooms.has(safeRoomName)) {
      socket.emit('room-create-result', { ok: false, reason: 'That server already exists.' });
      return;
    }

    const safeRoom = ensureRoom(safeRoomName, socket.data.username);
    roomPasswords.set(safeRoom, safePassword);
    io.emit('room-available', safeRoom);
    socket.emit('room-created', safeRoom);
  });

  socket.on('delete-room', (roomName) => {
    const safeRoom = (roomName || '').trim();
    const username = socket.data.username;

    if (!rooms.has(safeRoom)) {
      socket.emit('room-delete-result', { ok: false, reason: 'That server does not exist.' });
      return;
    }

    if (!canDeleteRoom(safeRoom, username)) {
      socket.emit('room-delete-result', { ok: false, reason: 'Only the server owner can delete this server.' });
      return;
    }

    rooms.delete(safeRoom);
    roomMessages.delete(safeRoom);
    roomOwners.delete(safeRoom);
    roomPasswords.delete(safeRoom);

    for (const roomSocket of io.sockets.sockets.values()) {
      if (roomSocket.data.room === safeRoom) {
        roomSocket.leave(safeRoom);
        roomSocket.data.room = null;
      }
    }

    io.emit('room-deleted', { room: safeRoom });
    socket.emit('room-delete-result', { ok: true, room: safeRoom });
  });

  socket.on('send-message', (message) => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (!room || !username || !message?.text?.trim()) {
      return;
    }

    const profile = authManager.getUserProfile(username);
    const chatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username,
      avatar: profile?.avatar || '',
      room,
      text: message.text.trim(),
      time: new Date().toISOString()
    };
    roomMessages.get(room).push(chatMessage);
    io.to(room).emit('chat-message', chatMessage);
  });

  socket.on('clear-room-history', ({ room }) => {
    if (socket.data.username !== 'admin') {
      socket.emit('system-message', { text: 'Only the admin account can clear chat history.', time: new Date().toISOString() });
      return;
    }

    if (!room || room !== socket.data.room || !roomMessages.has(room)) {
      return;
    }

    roomMessages.set(room, []);
    io.to(room).emit('room-history', { room, messages: [] });
  });

  socket.on('disconnect', () => {
    if (socket.data.voiceRoom) {
      socket.to(`voice:${socket.data.voiceRoom}`).emit('voice-user-left', { socketId: socket.id });
    }
    const room = socket.data.room;
    const username = socket.data.username;

    if (!room || !username) {
      return;
    }

    const roomUsers = rooms.get(room);
    if (roomUsers) {
      roomUsers.delete(username);
      if (roomUsers.size === 0) {
        rooms.delete(room);
      } else {
        io.to(room).emit('room-users', Array.from(roomUsers));
      }
    }

    broadcastPresence();
  });
});

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: Array.from(rooms.keys()) });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Messaging platform running on http://localhost:${PORT}`);
});
