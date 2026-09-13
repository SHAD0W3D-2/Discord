# BlueCord
https://automatic-garbanzo-q7jpqqjxxv56f665q-3000.app.github.dev/ 
BlueCord is a standalone real-time messaging website built with Node.js, Express, and Socket.IO.

## Run locally

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

The server listens on all network interfaces, so the site can also be opened from another device using the host machine's local IP address and port `3000`.

## Included features

- Account registration and login
- Persistent signed-in session
- Servers with separate chat threads
- Real-time messaging
- Direct messages and friends
- Friend requests
- Persistent browser chat history
- Notifications
- Clear-thread controls

## Project structure

- `server.js` serves the standalone site and handles Socket.IO events.
- `public/` contains the browser interface.
- `authManager.js` handles account registration and persistent password verification.
- `friendRequestManager.js` handles friends and requests.

This is a lightweight prototype. Friends, servers, and server-side message history are held in memory and reset when the Node process restarts. Registered accounts are stored locally in `data/users.json` with hashed passwords.
