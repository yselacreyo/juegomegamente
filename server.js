import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// --- Game State ---
const games = {};
const playerColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const avatars = ['👤', '🤖', '👽', '🦸', '🕵️', '🦁'];

function checkWinner(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(c => c) ? 'draw' : null;
}

function getRoom(roomId) {
  if (!games[roomId]) {
    games[roomId] = {
      players: [],
      board: Array(9).fill(null),
      turn: 'X',
      gameOver: false,
      winner: null,
    };
  }
  return games[roomId];
}

// --- Socket Events ---
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayer = null;

  socket.on('join-game', ({ name, avatar }) => {
    let roomId = null;

    // Find an available room or create one
    for (const rid in games) {
      if (games[rid].players.length < 2) {
        roomId = rid;
        break;
      }
    }
    if (!roomId) {
      roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    }

    const room = getRoom(roomId);
    const symbol = room.players.length === 0 ? 'X' : 'O';
    const color = playerColors[room.players.length % playerColors.length];
    const assignedAvatar = avatar || avatars[Math.floor(Math.random() * avatars.length)];

    currentRoom = roomId;
    currentPlayer = { id: socket.id, name, avatar: assignedAvatar, color, symbol, score: 0 };

    room.players.push(currentPlayer);
    socket.join(roomId);

    socket.emit('assign-symbol', { symbol, color, name, avatar: assignedAvatar });

    if (room.players.length === 2) {
      io.to(roomId).emit('game-start', { message: '¡Juego Iniciado!', turn: room.turn });
    }

    io.to(roomId).emit('update-players', room.players);
    io.to(roomId).emit('update-scores', room.players);
  });

  socket.on('make-move', (index) => {
    if (!currentRoom || !currentPlayer) return;
    const room = games[currentRoom];
    if (!room || room.gameOver) return;
    if (room.turn !== currentPlayer.symbol) return;
    if (room.board[index]) return;

    room.board[index] = currentPlayer.symbol;
    io.to(currentRoom).emit('update-board-visual', room.board);

    const winner = checkWinner(room.board);
    if (winner) {
      room.gameOver = true;
      room.winner = winner;

      if (winner !== 'draw') {
        const winningPlayer = room.players.find(p => p.symbol === winner);
        if (winningPlayer) winningPlayer.score += 100;
        io.to(currentRoom).emit('update-scores', room.players);
      }

      setTimeout(() => {
        io.to(currentRoom).emit('game-over', { winner, board: room.board });
      }, 300);

      io.to(currentRoom).emit('update-turn', { turn: null, message: winner === 'draw' ? '¡Empate!' : `¡Ganador: ${winner}!` });
      return;
    }

    room.turn = room.turn === 'X' ? 'O' : 'X';
    io.to(currentRoom).emit('update-turn', { turn: room.turn });
  });

  socket.on('chat-message', (text) => {
    if (!currentRoom || !currentPlayer || !text.trim()) return;
    io.to(currentRoom).emit('chat-message', {
      name: currentPlayer.name,
      avatar: currentPlayer.avatar,
      text: text.trim(),
      color: currentPlayer.color,
    });
  });

  socket.on('reset-game', () => {
    if (!currentRoom) return;
    const room = games[currentRoom];
    if (!room) return;
    room.board = Array(9).fill(null);
    room.turn = 'X';
    room.gameOver = false;
    room.winner = null;
    io.to(currentRoom).emit('reset-board');
    io.to(currentRoom).emit('update-turn', { turn: 'X' });
  });

  socket.on('disconnect', () => {
    if (currentRoom && games[currentRoom]) {
      const room = games[currentRoom];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(currentRoom).emit('update-players', room.players);

      if (room.players.length === 0) {
        delete games[currentRoom];
      } else {
        room.board = Array(9).fill(null);
        room.turn = 'X';
        room.gameOver = false;
        room.winner = null;
        io.to(currentRoom).emit('reset-board');
        io.to(currentRoom).emit('update-turn', { turn: 'X' });
        io.to(currentRoom).emit('player-disconnected', { message: 'El oponente se desconectó' });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
