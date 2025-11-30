# VoiceChat App

Random voice chat application using React, Socket.IO, and WebRTC.

## Project Structure

```
voicechat-app/
├── client/                ← React app (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── index.jsx
│   │   └── index.css
│   ├── public/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── postcss.config.js
├── server/
│   ├── server.js
│   └── package.json
└── README.md
```

## Setup

### Client Setup
```bash
cd client
npm install
npm run dev
```

The client will run on `http://localhost:3000`

### Server Setup
```bash
cd server
npm install
npm start
```

The server will run on `http://localhost:3001`

## Usage

1. Start the server first
2. Start the client
3. Open two browser tabs at `http://localhost:3000`
4. Click "Find a Partner" in both tabs
5. Allow microphone access
6. Start talking!

## Features

- Random voice chat matching
- WebRTC peer-to-peer audio
- Socket.IO signaling server
- Real-time connection status
- Mute/unmute functionality
- Call timer

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS
- **Backend**: Node.js, Express, Socket.IO
- **Communication**: WebRTC for audio, Socket.IO for signaling
