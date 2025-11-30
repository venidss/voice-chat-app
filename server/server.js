const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// THIS IS THE BULLETPROOF CONFIG
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",  // Vite
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,  // Critical for compatibility
  transports: ['polling', 'websocket'],  // Allow both
  pingTimeout: 60000,
  pingInterval: 25000
});

let waitingUser = null;

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('searchPartner', () => {
    if (waitingUser && waitingUser.id !== socket.id) {
      const partner = waitingUser;
      waitingUser = null;

      const initiator = Math.random() > 0.5 ? socket : partner;

      socket.emit('matchFound', {
        partnerId: partner.id,
        shouldInitiate: initiator.id === socket.id
      });

      partner.emit('matchFound', {
        partnerId: socket.id,
        shouldInitiate: initiator.id === partner.id
      });

      console.log('MATCH:', socket.id, '<->', partner.id);
    } else {
      waitingUser = socket;
      socket.emit('searching');
      console.log('Waiting for partner:', socket.id);
    }
  });

  socket.on('stopSearch', () => {
    if (waitingUser?.id === socket.id) waitingUser = null;
  });

  socket.on('offer', ({ offer, to }) => {
    console.log(`Relaying offer from ${socket.id} to ${to}`);
    io.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ answer, to }) => {
    console.log(`Relaying answer from ${socket.id} to ${to}`);
    io.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    console.log(`Relaying ICE candidate from ${socket.id} to ${to}`);
    io.to(to).emit('ice-candidate', { candidate });
  });

  socket.on('leaveCall', () => {
    socket.broadcast.emit('userLeft');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    if (waitingUser?.id === socket.id) waitingUser = null;
    socket.broadcast.emit('userLeft');
  });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nSERVER RUNNING`);
  console.log(`http://localhost:${PORT}`);
  console.log(`Accepting connections from http://localhost:5173\n`);
});
