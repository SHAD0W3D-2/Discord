const socket = io();
let installPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const STORAGE_KEY = 'chat-sphere-state';
const SESSION_KEY = 'chat-sphere-session';

const state = {
  username: '',
  currentRoom: 'general',
  rooms: ['general'],
  friends: [],
  onlineUsers: [],
  friendRequests: [],
  roomLabels: { general: 'general' },
  roomMessages: { general: [] },
  notifications: [],
  userProfiles: {}
};

const voiceState = {
  stream: null,
  room: '',
  muted: false,
  peers: new Map(),
  audio: new Map()
};

function loadStoredState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Array.isArray(stored.friends)) {
      state.friends = stored.friends;
    }
    if (Array.isArray(stored.friendRequests)) {
      state.friendRequests = stored.friendRequests;
    }
    if (Array.isArray(stored.rooms) && stored.rooms.length) {
      state.rooms = stored.rooms;
    }
    if (stored.currentRoom) {
      state.currentRoom = stored.currentRoom;
    }
    if (stored.roomLabels && typeof stored.roomLabels === 'object') {
      state.roomLabels = { ...state.roomLabels, ...stored.roomLabels };
    }
    if (stored.roomMessages && typeof stored.roomMessages === 'object') {
      state.roomMessages = Object.fromEntries(
        Object.entries(stored.roomMessages).map(([room, messages]) => [
          room,
          Array.isArray(messages)
            ? messages.filter((message) => !(message.type === 'system' && /(joined|left) the room\.$/.test(message.text || '')))
            : []
        ])
      );
    }
    if (stored.username) {
      state.username = stored.username;
    }
    if (Array.isArray(stored.notifications)) {
      state.notifications = stored.notifications.slice(0, 30);
    }
    saveStoredState();
  } catch (error) {
    console.warn('Could not restore chat state:', error);
  }
}

function saveStoredState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    username: state.username,
    friends: state.friends,
    friendRequests: state.friendRequests,
    currentRoom: state.currentRoom,
    rooms: state.rooms,
    roomLabels: state.roomLabels,
    roomMessages: state.roomMessages,
    notifications: state.notifications
  }));
}

function restoreSession() {
  const savedUsername = localStorage.getItem(SESSION_KEY);
  if (savedUsername) {
    state.username = savedUsername;
    elements.joinModal.classList.remove('visible');
    const room = state.currentRoom || 'general';
    elements.activeRoom.textContent = room;
    socket.emit('join-room', { username: state.username, room });
    appendSystemMessage(`Welcome back, ${state.username}!`);
  }
}

const elements = {
  appShell: document.querySelector('.app-shell'),
  sidebar: document.querySelector('.sidebar'),
  roomList: document.getElementById('room-list'),
  siteIcon: document.getElementById('site-icon'),
  dmList: document.getElementById('dm-list'),
  roomForm: document.getElementById('room-form'),
  roomName: document.getElementById('room-name'),
  roomPassword: document.getElementById('room-password'),
  activeRoom: document.getElementById('active-room'),
  joinModal: document.getElementById('join-modal'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginShowPassword: document.getElementById('login-show-password'),
  registerUsername: document.getElementById('register-username'),
  registerPassword: document.getElementById('register-password'),
  registerShowPassword: document.getElementById('register-show-password'),
  showLogin: document.getElementById('show-login'),
  showRegister: document.getElementById('show-register'),
  messages: document.getElementById('messages'),
  userList: document.getElementById('user-list'),
  chatForm: document.getElementById('chat-form'),
  messageInput: document.getElementById('message-input'),
  connectionStatus: document.getElementById('connection-status'),
  logoutButton: document.getElementById('logout-button'),
  friendForm: document.getElementById('friend-form'),
  friendName: document.getElementById('friend-name'),
  friendList: document.getElementById('friend-list'),
  friendRequestList: document.getElementById('friend-request-list'),
  clearChat: document.getElementById('clear-chat'),
  notificationToggle: document.getElementById('notification-toggle'),
  notificationCount: document.getElementById('notification-count'),
  notificationPanel: document.getElementById('notification-panel'),
  notificationList: document.getElementById('notification-list'),
  clearNotifications: document.getElementById('clear-notifications'),
  installApp: document.getElementById('install-app'),
  voiceToggle: document.getElementById('voice-toggle'),
  voiceMute: document.getElementById('voice-mute'),
  voiceStatus: document.getElementById('voice-status'),
  profileModal: document.getElementById('profile-modal'),
  profileAvatar: document.getElementById('profile-avatar'),
  profileTitle: document.getElementById('profile-title'),
  profileStatus: document.getElementById('profile-status'),
  profileUploadWrap: document.getElementById('profile-upload-wrap'),
  profileFileInput: document.getElementById('profile-file-input'),
  mobileSettingsToggle: document.getElementById('mobile-settings-toggle'),
  mobileSettingsPanel: document.getElementById('mobile-settings-panel'),
  mobileProfileFileInput: document.getElementById('mobile-profile-file-input'),
  profileDm: document.getElementById('profile-dm'),
  closeProfile: document.getElementById('close-profile')
};

function updateSiteIcon(unreadCount) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');

  context.fillStyle = '#8b5cf6';
  context.beginPath();
  context.arc(32, 32, 30, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(10, 20, 44, 27, 11);
  context.fill();
  context.fillRect(18, 15, 4, 20);
  context.fillRect(14, 23, 12, 4);
  context.fillStyle = '#8b5cf6';
  context.beginPath();
  context.arc(40, 29, 3, 0, Math.PI * 2);
  context.arc(48, 29, 3, 0, Math.PI * 2);
  context.fill();

  if (unreadCount > 0) {
    context.fillStyle = '#ef4444';
    context.beginPath();
    context.arc(51, 13, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = 'bold 13px sans-serif';
    context.fillText(unreadCount > 9 ? '9+' : String(unreadCount), 51, 14);
  }

  elements.siteIcon.href = canvas.toDataURL('image/png');
}

function renderNotifications() {
  elements.notificationList.innerHTML = '';

  if (!state.notifications.length) {
    const empty = document.createElement('li');
    empty.className = 'notification-empty';
    empty.textContent = 'No notifications yet';
    elements.notificationList.appendChild(empty);
  } else {
    state.notifications.forEach((notification) => {
      const item = document.createElement('li');
      item.className = `notification-item ${notification.read ? '' : 'unread'}`;
      item.innerHTML = `<strong>${notification.title}</strong><span>${notification.text}</span><small>${new Date(notification.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>`;
      elements.notificationList.appendChild(item);
    });
  }

  const unreadCount = state.notifications.filter((notification) => !notification.read).length;
  elements.notificationCount.textContent = unreadCount;
  elements.notificationCount.classList.toggle('hidden', unreadCount === 0);
  updateSiteIcon(unreadCount);
}

function addNotification(title, text) {
  state.notifications.unshift({ title, text, time: Date.now(), read: false });
  state.notifications = state.notifications.slice(0, 30);
  saveStoredState();
  renderNotifications();
}

function createDmRoomName(friendName) {
  const names = [state.username, friendName].filter(Boolean).sort();
  return `dm:${names.join(':')}`;
}

function isDmRoom(room) {
  return room.startsWith('dm:');
}

function getDmUser(room) {
  if (!isDmRoom(room)) {
    return '';
  }

  const participants = room.slice(3).split(':');
  return participants.find((participant) => participant !== state.username) || 'Direct message';
}

function getRoomLabel(room) {
  if (state.roomLabels[room]) {
    return state.roomLabels[room];
  }
  if (isDmRoom(room)) {
    return getDmUser(room);
  }
  return room;
}

function collapseMobileSidebar() {
  elements.appShell.classList.add('mobile-sidebar-collapsed');
}

function renderRooms() {
  elements.roomList.innerHTML = '';

  state.rooms.filter((room) => !isDmRoom(room)).forEach((room) => {
    const roomEntry = document.createElement('div');
    roomEntry.className = 'room-entry';

    const roomButton = document.createElement('button');
    roomButton.type = 'button';
    roomButton.className = `room-item ${room === state.currentRoom ? 'active' : ''}`;
    roomButton.textContent = `# ${getRoomLabel(room)}`;
    roomButton.addEventListener('click', (event) => {
      event.stopPropagation();
      collapseMobileSidebar();
      joinRoom(room, getRoomLabel(room));
    });

    roomEntry.appendChild(roomButton);

    if (room !== 'general' && state.username) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-room-button';
      deleteButton.textContent = 'Delete';
      deleteButton.title = 'Delete server';
      deleteButton.addEventListener('click', () => {
        if (confirm(`Delete the ${getRoomLabel(room)} server? This removes its chat history for everyone.`)) {
          socket.emit('delete-room', room);
        }
      });
      roomEntry.appendChild(deleteButton);
    }

    elements.roomList.appendChild(roomEntry);
  });
}

function renderDms() {
  elements.dmList.innerHTML = '';
  const dmRooms = state.rooms.filter(isDmRoom);

  if (!dmRooms.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = 'No direct messages yet';
    elements.dmList.appendChild(empty);
    return;
  }

  dmRooms.forEach((room) => {
    const dmButton = document.createElement('button');
    dmButton.type = 'button';
    dmButton.className = `room-item ${room === state.currentRoom ? 'active' : ''}`;
    dmButton.textContent = getRoomLabel(room);
    dmButton.addEventListener('click', (event) => {
      event.stopPropagation();
      collapseMobileSidebar();
      joinRoom(room, state.roomLabels[room] || dmButton.textContent);
    });
    elements.dmList.appendChild(dmButton);
  });
}

function renderMessages() {
  elements.messages.innerHTML = '';
  const roomMessages = state.roomMessages[state.currentRoom] || [];

  roomMessages.forEach((message) => {
    if (message.type === 'system') {
      appendSystemMessage(message.text);
      return;
    }

    appendMessage({
      username: message.username || 'Unknown',
      avatar: message.avatar || '',
      text: message.text,
      time: message.time || Date.now()
    }, message.username === state.username || message.self === true);
  });

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function getAvatarForUser(username, avatarOverride = '') {
  if (avatarOverride) {
    return avatarOverride;
  }

  const profile = state.userProfiles[username] || {};
  return profile.avatar || '';
}

function applyAvatarToElement(element, username, fallbackText = 'B', avatarOverride = '') {
  const avatar = getAvatarForUser(username, avatarOverride);
  element.innerHTML = '';
  element.classList.remove('has-image');

  if (avatar) {
    const img = document.createElement('img');
    img.src = avatar;
    img.alt = `${username} profile picture`;
    img.draggable = false;
    element.appendChild(img);
    element.classList.add('has-image');
    return;
  }

  element.textContent = (username || fallbackText).charAt(0).toUpperCase() || 'B';
}

function renderUsers(users) {
  elements.userList.innerHTML = '';
  users.forEach((user) => {
    const item = document.createElement('li');
    item.className = 'profile-link user-row';
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    applyAvatarToElement(avatar, user, user);
    const name = document.createElement('span');
    name.textContent = user === state.username ? `${user} (you)` : user;
    item.append(avatar, name);
    item.addEventListener('click', () => openProfile(user));
    elements.userList.appendChild(item);
  });
}

function openProfile(username) {
  const isSelf = username === state.username;
  const isOnline = state.onlineUsers.includes(username);
  applyAvatarToElement(elements.profileAvatar, username, username);
  elements.profileTitle.textContent = username;
  elements.profileStatus.textContent = isSelf ? 'Your profile' : (isOnline ? 'Online' : 'Offline');
  elements.profileUploadWrap.hidden = !isSelf;
  elements.profileDm.hidden = isSelf;
  elements.profileFileInput.value = '';
  elements.profileDm.onclick = () => {
    const dmRoom = createDmRoomName(username);
    if (!state.rooms.includes(dmRoom)) {
      state.rooms.push(dmRoom);
    }
    state.roomLabels[dmRoom] = username;
    saveStoredState();
    renderDms();
    elements.profileModal.classList.remove('visible');
    collapseMobileSidebar();
    joinRoom(dmRoom, username);
  };
  elements.profileModal.classList.add('visible');
}

function renderFriendRequests() {
  elements.friendRequestList.innerHTML = '';

  if (!state.friendRequests.length) {
    const empty = document.createElement('li');
    empty.className = 'friend-request-item';
    empty.innerHTML = '<span>No pending requests</span>';
    elements.friendRequestList.appendChild(empty);
    return;
  }

  state.friendRequests.forEach((requestUser) => {
    const item = document.createElement('li');
    item.className = 'friend-request-item';
    item.innerHTML = `<strong>${requestUser}</strong><div class="request-buttons"><button type="button" class="primary">Accept</button><button type="button" class="secondary">Decline</button></div>`;

    item.querySelector('.primary').addEventListener('click', () => {
      socket.emit('accept-friend-request', { requestUser });
    });

    item.querySelector('.secondary').addEventListener('click', () => {
      socket.emit('decline-friend-request', { requestUser });
    });

    elements.friendRequestList.appendChild(item);
  });
}

function renderFriends() {
  elements.friendList.innerHTML = '';

  if (!state.friends.length) {
    const empty = document.createElement('li');
    empty.className = 'friend-item';
    empty.innerHTML = '<span>No friends yet</span>';
    elements.friendList.appendChild(empty);
    return;
  }

  state.friends.forEach((friend) => {
    const item = document.createElement('li');
    item.className = 'friend-item';
    const friendDetails = document.createElement('span');
    const isOnline = state.onlineUsers.includes(friend);
    friendDetails.className = `friend-details ${isOnline ? 'online' : 'offline'}`;

    const friendAvatar = document.createElement('span');
    friendAvatar.className = 'user-avatar small';
    applyAvatarToElement(friendAvatar, friend, friend);

    const friendName = document.createElement('strong');
    friendName.textContent = friend;
    friendName.className = 'profile-link';
    friendName.addEventListener('click', () => openProfile(friend));

    const friendStatus = document.createElement('small');
    friendStatus.textContent = isOnline ? 'Online' : 'Offline';

    const directMessageButton = document.createElement('button');
    directMessageButton.type = 'button';
    directMessageButton.textContent = 'DM';

    directMessageButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const dmRoom = createDmRoomName(friend);
      if (!state.rooms.includes(dmRoom)) {
        state.rooms.push(dmRoom);
      }
      state.roomLabels[dmRoom] = friend;
      renderDms();
      collapseMobileSidebar();
      joinRoom(dmRoom, friend);
      appendSystemMessage(`Private chat with ${friend} opened.`);
    });

    const removeFriendButton = document.createElement('button');
    removeFriendButton.type = 'button';
    removeFriendButton.className = 'remove-friend-button';
    removeFriendButton.textContent = 'Remove';
    removeFriendButton.addEventListener('click', () => {
      if (confirm(`Remove ${friend} from your friends?`)) {
        state.friends = state.friends.filter((savedFriend) => savedFriend !== friend);
        saveStoredState();
        renderFriends();
        socket.emit('remove-friend', { friendName: friend });
      }
    });

    const friendActions = document.createElement('div');
    friendActions.className = 'friend-actions';
    friendActions.append(directMessageButton, removeFriendButton);

    const friendStatusRow = document.createElement('div');
    friendStatusRow.className = 'friend-status-row';
    friendStatusRow.append(friendStatus, friendActions);

    friendDetails.append(friendAvatar, friendName, friendStatusRow);
    item.append(friendDetails);
    elements.friendList.appendChild(item);
  });
}

function appendMessage({ username, avatar: avatarOverride, text, time }, self = false) {
  const messageNode = document.createElement('article');
  messageNode.className = `message ${self ? 'self' : ''}`;

  const header = document.createElement('div');
  header.className = 'message-header';

  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  applyAvatarToElement(avatar, username, username, avatarOverride);

  const author = document.createElement('strong');
  author.textContent = username;

  const stamp = document.createElement('span');
  stamp.textContent = new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  header.append(avatar, author, stamp);

  const body = document.createElement('p');
  body.textContent = text;

  messageNode.append(header, body);
  elements.messages.appendChild(messageNode);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function addRoomMessage(message) {
  if (!state.roomMessages[state.currentRoom]) {
    state.roomMessages[state.currentRoom] = [];
  }
  state.roomMessages[state.currentRoom].push(message);
  saveStoredState();
}

function appendSystemMessage(text) {
  const messageNode = document.createElement('div');
  messageNode.className = 'system-message';
  messageNode.textContent = text;
  elements.messages.appendChild(messageNode);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function joinRoom(roomName, labelOverride, password = '') {
  const room = (roomName || state.currentRoom || 'general').trim();
  if (!room) {
    return;
  }

  if (voiceState.stream && voiceState.room !== room) {
    leaveVoice();
  }

  const label = labelOverride || getRoomLabel(room);
  const displayLabel = isDmRoom(room) ? getDmUser(room) : label;
  state.currentRoom = room;
  state.roomLabels[room] = displayLabel;
  if (!state.roomMessages[room]) {
    state.roomMessages[room] = [];
  }
  elements.activeRoom.textContent = displayLabel;
  renderRooms();
  renderDms();

  if (!state.username) {
    elements.joinModal.classList.add('visible');
    return;
  }

  saveStoredState();
  socket.emit('join-room', { username: state.username, room, password });
  renderMessages();
}

function syncRooms() {
  fetch('/api/rooms')
    .then((response) => response.json())
    .then((data) => {
      const savedServers = state.rooms.filter((room) => !isDmRoom(room));
      const savedDmRooms = state.rooms.filter(isDmRoom);
      const serverRooms = data.rooms.length ? data.rooms : ['general'];
      state.rooms = [...new Set([
        ...serverRooms.filter((room) => !isDmRoom(room)),
        ...savedServers,
        ...savedDmRooms
      ])];
      saveStoredState();
      renderRooms();
      renderDms();
    })
    .catch(() => {
      state.rooms = [...new Set(state.rooms)];
      renderRooms();
      renderDms();
    });
}

function syncUserProfiles() {
  fetch('/api/users')
    .then((response) => response.json())
    .then((profiles) => {
      updateUserProfiles(profiles || {});
    })
    .catch(() => {
      updateUserProfiles({});
    });
}

function updateUserProfiles(profiles) {
  state.userProfiles = profiles || {};

  if (state.username && state.userProfiles[state.username]) {
    applyAvatarToElement(elements.profileAvatar, state.username, state.username);
  }

  renderUsers(state.onlineUsers);
  renderFriends();
  renderMessages();
}

function updateVoiceStatus() {
  const participantCount = voiceState.peers.size + (voiceState.stream ? 1 : 0);
  elements.voiceStatus.textContent = participantCount ? `${participantCount} in voice` : '';
}

function removeVoicePeer(socketId) {
  const peer = voiceState.peers.get(socketId);
  if (peer) {
    peer.close();
    voiceState.peers.delete(socketId);
  }

  const audio = voiceState.audio.get(socketId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    voiceState.audio.delete(socketId);
  }
  updateVoiceStatus();
}

function createVoicePeer(socketId, initiator) {
  if (voiceState.peers.has(socketId) || !voiceState.stream) {
    return voiceState.peers.get(socketId);
  }

  const peer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  voiceState.peers.set(socketId, peer);
  voiceState.stream.getTracks().forEach((track) => peer.addTrack(track, voiceState.stream));

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('voice-ice-candidate', { target: socketId, candidate: event.candidate });
    }
  };

  peer.ontrack = (event) => {
    let audio = voiceState.audio.get(socketId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.controls = false;
      audio.setAttribute('aria-hidden', 'true');
      document.body.appendChild(audio);
      voiceState.audio.set(socketId, audio);
    }
    audio.srcObject = event.streams[0];
  };

  peer.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
      removeVoicePeer(socketId);
    }
  };

  if (initiator) {
    peer.createOffer()
      .then((offer) => peer.setLocalDescription(offer))
      .then(() => socket.emit('voice-offer', { target: socketId, offer: peer.localDescription }))
      .catch(() => removeVoicePeer(socketId));
  }

  updateVoiceStatus();
  return peer;
}

async function joinVoice() {
  if (!state.username || !navigator.mediaDevices?.getUserMedia) {
    appendSystemMessage('Voice chat requires microphone permission and a secure connection.');
    elements.voiceStatus.textContent = 'Microphone unavailable';
    return;
  }

  try {
    voiceState.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    voiceState.room = state.currentRoom;
    voiceState.muted = false;
    elements.voiceToggle.textContent = 'Leave voice';
    elements.voiceMute.hidden = false;
    elements.voiceMute.textContent = 'Mute';
    socket.emit('voice-join');
    updateVoiceStatus();
  } catch (error) {
    elements.voiceStatus.textContent = 'Microphone access failed';
    appendSystemMessage(error.name === 'NotAllowedError'
      ? 'Microphone permission was denied.'
      : 'Could not access your microphone.');
  }
}

function leaveVoice() {
  if (!voiceState.stream) {
    return;
  }

  socket.emit('voice-leave');
  voiceState.peers.forEach((peer) => peer.close());
  voiceState.peers.clear();
  voiceState.audio.forEach((audio) => audio.remove());
  voiceState.audio.clear();
  voiceState.stream.getTracks().forEach((track) => track.stop());
  voiceState.stream = null;
  voiceState.room = '';
  voiceState.muted = false;
  elements.voiceToggle.textContent = 'Join voice';
  elements.voiceMute.hidden = true;
  elements.voiceStatus.textContent = '';
}

elements.voiceToggle.addEventListener('click', () => {
  if (voiceState.stream) {
    leaveVoice();
  } else {
    joinVoice();
  }
});

elements.voiceMute.addEventListener('click', () => {
  if (!voiceState.stream) {
    return;
  }

  voiceState.muted = !voiceState.muted;
  voiceState.stream.getAudioTracks().forEach((track) => {
    track.enabled = !voiceState.muted;
  });
  elements.voiceMute.textContent = voiceState.muted ? 'Unmute' : 'Mute';
});

socket.on('voice-users', (users) => {
  users.forEach(({ socketId }) => createVoicePeer(socketId, true));
});

socket.on('voice-user-joined', () => {
  updateVoiceStatus();
});

socket.on('voice-user-left', ({ socketId }) => {
  removeVoicePeer(socketId);
});

socket.on('voice-offer', async ({ sender, offer }) => {
  if (!voiceState.stream) {
    return;
  }

  const peer = createVoicePeer(sender, false);
  try {
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('voice-answer', { target: sender, answer: peer.localDescription });
  } catch (error) {
    removeVoicePeer(sender);
  }
});

socket.on('voice-answer', async ({ sender, answer }) => {
  const peer = voiceState.peers.get(sender);
  if (!peer) {
    return;
  }

  try {
    await peer.setRemoteDescription(answer);
  } catch (error) {
    removeVoicePeer(sender);
  }
});

socket.on('voice-ice-candidate', async ({ sender, candidate }) => {
  const peer = voiceState.peers.get(sender);
  if (!peer) {
    return;
  }

  try {
    await peer.addIceCandidate(candidate);
  } catch (error) {
    removeVoicePeer(sender);
  }
});

socket.on('connect', () => {
  elements.connectionStatus.textContent = 'Connected';
  elements.connectionStatus.className = 'status online';
  joinRoom(state.currentRoom);
});

socket.on('disconnect', () => {
  elements.connectionStatus.textContent = 'Reconnecting';
  elements.connectionStatus.className = 'status';
});

socket.on('room-created', (room) => {
  if (!state.rooms.includes(room)) {
    state.rooms.push(room);
  }
  state.currentRoom = room;
  elements.activeRoom.textContent = room;
  renderRooms();
  renderDms();
  joinRoom(room);
});

socket.on('room-available', (room) => {
  if (!room || state.rooms.includes(room)) {
    return;
  }

  state.rooms.push(room);
  saveStoredState();
  renderRooms();
});

socket.on('room-create-result', (result) => {
  if (!result.ok) {
    appendSystemMessage(result.reason || 'Unable to create that server.');
  }
});

socket.on('room-access-required', ({ room }) => {
  const password = prompt(`Enter the password for ${getRoomLabel(room)}:`);
  if (password !== null) {
    joinRoom(room, getRoomLabel(room), password);
  }
});

socket.on('room-access-denied', ({ reason }) => {
  appendSystemMessage(reason || 'You cannot join that server.');
});

socket.on('room-delete-result', (result) => {
  if (!result.ok) {
    appendSystemMessage(result.reason || 'Unable to delete that server.');
  }
});

socket.on('room-deleted', ({ room }) => {
  if (!room) {
    return;
  }

  state.rooms = state.rooms.filter((savedRoom) => savedRoom !== room);
  delete state.roomLabels[room];
  delete state.roomMessages[room];

  if (state.currentRoom === room) {
    state.currentRoom = 'general';
    elements.activeRoom.textContent = 'general';
    joinRoom('general');
  } else {
    saveStoredState();
    renderRooms();
    renderDms();
  }
});

socket.on('room-users', (users) => {
  renderUsers(users);
});

socket.on('friend-list', (friends) => {
  const nextFriends = Array.isArray(friends) ? friends : [];
  const previousFriends = new Set(state.friends);
  const newFriends = nextFriends.filter((friend) => !previousFriends.has(friend));
  state.friends = nextFriends;
  saveStoredState();
  renderFriends();

  newFriends.forEach((friend) => {
    addNotification('New friend', `You are now friends with ${friend}.`);
  });
});

socket.on('friend-removed', ({ friendName }) => {
  if (!friendName) {
    return;
  }

  const dmRoom = createDmRoomName(friendName);
  state.rooms = state.rooms.filter((room) => room !== dmRoom);
  delete state.roomLabels[dmRoom];
  delete state.roomMessages[dmRoom];

  if (state.currentRoom === dmRoom) {
    state.currentRoom = 'general';
    joinRoom('general');
  } else {
    saveStoredState();
    renderRooms();
    renderDms();
  }
});

socket.on('online-users', (users) => {
  state.onlineUsers = Array.isArray(users) ? users : [];
  renderFriends();
  renderUsers(state.onlineUsers);
});

socket.on('user-profiles', (profiles) => {
  updateUserProfiles(profiles);
});

socket.on('profile-updated', (profile) => {
  if (!profile || !profile.username) {
    if (profile && profile.reason) {
      appendSystemMessage(profile.reason);
    }
    return;
  }

  if (profile.reason) {
    appendSystemMessage(profile.reason);
    return;
  }

  state.userProfiles[profile.username] = { avatar: profile.avatar || '' };
  if (profile.username === state.username) {
    applyAvatarToElement(elements.profileAvatar, profile.username, profile.username);
  }
  renderUsers(state.onlineUsers);
  renderFriends();
  renderMessages();
});

socket.on('friend-request-list', (requests) => {
  const nextRequests = Array.isArray(requests) ? requests : [];
  const previousRequests = new Set(state.friendRequests);
  const newRequests = nextRequests.filter((requestUser) => !previousRequests.has(requestUser));
  state.friendRequests = nextRequests;
  saveStoredState();
  renderFriendRequests();
  newRequests.forEach((requestUser) => {
    addNotification('Friend request', `${requestUser} sent you a friend request.`);
  });
});

socket.on('room-history', ({ room, messages }) => {
  if (!room || !Array.isArray(messages)) {
    return;
  }

  if (!messages.length) {
    state.roomMessages[room] = [];
    saveStoredState();
    if (room === state.currentRoom) {
      renderMessages();
    }
    return;
  }

  if (!state.roomMessages[room]) {
    state.roomMessages[room] = [];
  }

  const existingMessages = new Set(state.roomMessages[room].map((message) => (
    message.id || `${message.username}|${message.text}|${message.time}`
  )));
  messages.forEach((message) => {
    const messageKey = message.id || `${message.username}|${message.text}|${message.time}`;
    if (!existingMessages.has(messageKey)) {
      state.roomMessages[room].push({ ...message, type: 'message' });
      existingMessages.add(messageKey);
    }
  });
  saveStoredState();
  if (room === state.currentRoom) {
    renderMessages();
  }
});

socket.on('system-message', (payload) => {
  if (!state.roomMessages[state.currentRoom]) {
    state.roomMessages[state.currentRoom] = [];
  }
  state.roomMessages[state.currentRoom].push({ type: 'system', text: payload.text, time: payload.time || Date.now() });
  saveStoredState();
  renderMessages();
});

socket.on('chat-message', (payload) => {
  const messageRoom = payload.room || state.currentRoom;
  if (!state.roomMessages[messageRoom]) {
    state.roomMessages[messageRoom] = [];
  }
  state.roomMessages[messageRoom].push({ ...payload, type: 'message' });
  saveStoredState();
  if (messageRoom === state.currentRoom) {
    renderMessages();
  }
  if (payload.username !== state.username && messageRoom !== state.currentRoom) {
    addNotification(`New message in ${getRoomLabel(messageRoom)}`, `${payload.username}: ${payload.text}`);
  }
});

function setAuthView(mode) {
  const isLogin = mode === 'login';
  elements.loginForm.classList.toggle('visible', isLogin);
  elements.registerForm.classList.toggle('visible', !isLogin);
  elements.showLogin.classList.toggle('active', isLogin);
  elements.showRegister.classList.toggle('active', !isLogin);
}

function updatePasswordVisibility(input, toggle) {
  input.type = toggle.checked ? 'text' : 'password';
}

function updateAdminControls() {
  elements.clearChat.hidden = state.username !== 'admin';
}

function logOut() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(STORAGE_KEY);

  state.username = '';
  state.currentRoom = 'general';
  state.rooms = ['general'];
  state.friends = [];
  state.onlineUsers = [];
  state.friendRequests = [];
  state.roomLabels = { general: 'general' };
  state.roomMessages = { general: [] };
  state.notifications = [];
  updateAdminControls();

  elements.activeRoom.textContent = 'general';
  elements.messages.innerHTML = '';
  elements.userList.innerHTML = '';
  elements.loginUsername.value = '';
  elements.loginPassword.value = '';
  elements.registerUsername.value = '';
  elements.registerPassword.value = '';
  elements.joinModal.classList.add('visible');

  renderRooms();
  renderDms();
  renderFriends();
  renderFriendRequests();
  renderNotifications();
  setAuthView('login');

  socket.disconnect();
  socket.connect();
}

socket.on('auth-result', (result) => {
  if (!result.ok) {
    appendSystemMessage(result.reason || 'Authentication failed.');
    return;
  }

  const currentUsername = result.username || state.username;
  state.username = currentUsername;
  updateAdminControls();
  localStorage.setItem(SESSION_KEY, currentUsername);
  saveStoredState();
  const room = state.currentRoom || 'general';
  elements.joinModal.classList.remove('visible');
  elements.activeRoom.textContent = room;
  socket.emit('join-room', { username: state.username, room });
  elements.messages.innerHTML = '';
  appendSystemMessage(`Welcome back, ${state.username}!`);
  if (!state.rooms.includes(room)) {
    state.rooms.push(room);
  }
  renderRooms();
  renderDms();
});

elements.showLogin.addEventListener('click', () => setAuthView('login'));
elements.showRegister.addEventListener('click', () => setAuthView('register'));
elements.closeProfile.addEventListener('click', () => elements.profileModal.classList.remove('visible'));
elements.profileModal.addEventListener('click', (event) => {
  if (event.target === elements.profileModal) {
    elements.profileModal.classList.remove('visible');
  }
});
elements.loginShowPassword.addEventListener('change', () => {
  updatePasswordVisibility(elements.loginPassword, elements.loginShowPassword);
});
elements.registerShowPassword.addEventListener('change', () => {
  updatePasswordVisibility(elements.registerPassword, elements.registerShowPassword);
});

elements.logoutButton.addEventListener('click', logOut);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  elements.installApp.hidden = false;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  elements.installApp.hidden = true;
});

elements.installApp.addEventListener('click', async () => {
  if (!installPrompt) {
    appendSystemMessage('Use your browser menu and choose Add to Home screen or Install app.');
    return;
  }

  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  elements.installApp.hidden = true;
});

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !(file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png' || file.type === 'image/webp')) {
      reject(new Error('Please upload a valid JPG, JPEG, PNG, or WebP image.'));
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('Please choose an image smaller than 2 MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 320;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const context = canvas.getContext('2d');
        context.fillStyle = '#0f172a';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(img, 0, 0, canvas.width, canvas.height);

        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outputType, 0.8);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function handleProfileImageSelection(event) {
  const [file] = event.target.files || [];
  if (!file || !state.username) {
    appendSystemMessage('You need to be logged in before changing your profile picture.');
    return;
  }

  resizeAvatar(file)
    .then((dataUrl) => fetch('/api/profile-picture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.username, avatar: dataUrl })
    }))
    .then(async (response) => {
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json() : { ok: false, reason: await response.text() || 'Profile picture upload failed.' };

      if (!response.ok || !payload || !payload.ok) {
        throw new Error(payload?.reason || 'Profile picture upload failed.');
      }

      return payload;
    })
    .then((result) => {
      state.userProfiles[state.username] = { avatar: result.profile.avatar || '' };
      applyAvatarToElement(elements.profileAvatar, state.username, state.username);
      renderUsers(state.onlineUsers);
      renderFriends();

      if (elements.mobileSettingsPanel) {
        elements.mobileSettingsPanel.hidden = true;
        elements.mobileSettingsToggle.setAttribute('aria-expanded', 'false');
      }
      if (elements.profileFileInput) {
        elements.profileFileInput.value = '';
      }
      if (elements.mobileProfileFileInput) {
        elements.mobileProfileFileInput.value = '';
      }
    })
    .catch((error) => {
      appendSystemMessage(error.message || 'Profile picture upload failed.');
    });
}

elements.profileFileInput.addEventListener('change', handleProfileImageSelection);
elements.mobileProfileFileInput.addEventListener('change', handleProfileImageSelection);
elements.mobileSettingsToggle.addEventListener('click', () => {
  const isOpen = !elements.mobileSettingsPanel.hidden;
  elements.mobileSettingsPanel.hidden = isOpen;
  elements.mobileSettingsToggle.setAttribute('aria-expanded', String(!isOpen));
});

elements.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value.trim();
  if (!username || !password) {
    return;
  }
  state.username = username;
  socket.emit('login-account', { username, password });
  elements.loginPassword.value = '';
});

elements.registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = elements.registerUsername.value.trim();
  const password = elements.registerPassword.value.trim();
  if (!username || !password) {
    return;
  }
  state.username = username;
  socket.emit('register-account', { username, password });
  elements.registerPassword.value = '';
});

elements.roomForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const roomName = elements.roomName.value.trim();
  const roomPassword = elements.roomPassword.value.trim();
  if (!roomName || !roomPassword || !state.username) {
    return;
  }

  socket.emit('create-room', { name: roomName, password: roomPassword });
  elements.roomName.value = '';
  elements.roomPassword.value = '';
});

elements.friendForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const friendName = elements.friendName.value.trim();
  if (!friendName || !state.username) {
    return;
  }

  socket.emit('send-friend-request', { username: state.username, friendName });
  elements.friendName.value = '';
});

elements.chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  socket.emit('send-message', { text });
  elements.messageInput.value = '';
});

elements.clearChat.addEventListener('click', () => {
  if (state.username !== 'admin' || !confirm(`Clear the ${getRoomLabel(state.currentRoom)} chat for everyone?`)) {
    return;
  }

  socket.emit('clear-room-history', { room: state.currentRoom });
});

elements.notificationToggle.addEventListener('click', () => {
  const isOpen = !elements.notificationPanel.hidden;
  elements.notificationPanel.hidden = isOpen;
  elements.notificationToggle.setAttribute('aria-expanded', String(!isOpen));
  if (!isOpen) {
    state.notifications.forEach((notification) => {
      notification.read = true;
    });
    saveStoredState();
    renderNotifications();
  }
});

document.addEventListener('click', (event) => {
  if (elements.notificationPanel.hidden) {
    return;
  }

  if (!elements.notificationPanel.contains(event.target) && !elements.notificationToggle.contains(event.target)) {
    elements.notificationPanel.hidden = true;
    elements.notificationToggle.setAttribute('aria-expanded', 'false');
  }
});

elements.clearNotifications.addEventListener('click', () => {
  state.notifications = [];
  saveStoredState();
  renderNotifications();
});

setAuthView('login');

elements.sidebar.addEventListener('click', () => {
  if (elements.appShell.classList.contains('mobile-sidebar-collapsed')) {
    elements.appShell.classList.remove('mobile-sidebar-collapsed');
  }
});

elements.roomList.addEventListener('click', (event) => {
  if (event.target.closest('.room-item')) {
    collapseMobileSidebar();
  }
}, true);

elements.dmList.addEventListener('click', (event) => {
  if (event.target.closest('.room-item')) {
    collapseMobileSidebar();
  }
}, true);

loadStoredState();
restoreSession();
updateAdminControls();
syncUserProfiles();
syncRooms();
renderRooms();
renderDms();
renderFriends();
renderFriendRequests();
renderNotifications();
renderMessages();
