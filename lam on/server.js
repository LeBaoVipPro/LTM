const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Phục vụ file index.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Quản lý phòng bằng Map: { roomId: { players: [socket1, socket2], playerIds: [0, 1], playerNames: [name1, name2], spectators: [socket] } }
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', (data) => {
        try {
            const { roomId, playerName, role } = data;
            if (!roomId || typeof roomId !== 'string' || !playerName || typeof playerName !== 'string' || !['player', 'spectator'].includes(role)) {
                console.error(`Invalid room ID, player name, or role from ${socket.id}`);
                socket.emit('error', { message: 'Invalid room ID, player name, or role' });
                return;
            }

            let room = rooms.get(roomId);
            if (!room) {
                room = { players: [], playerIds: [], playerNames: [], spectators: [] };
                rooms.set(roomId, room);
                console.log(`Created room ${roomId}`);
            }

            if (role === 'player') {
                if (room.players.length >= 2) {
                    console.log(`Room ${roomId} is full for player ${socket.id}`);
                    socket.emit('room-full');
                    return;
                }

                room.players.push(socket);
                room.playerIds.push(room.players.length - 1);
                room.playerNames.push(playerName);
                socket.roomId = roomId;
                socket.role = 'player';
                socket.join(roomId);
                console.log(`Player ${socket.id} joined room ${roomId} as ${playerName}`);
                socket.emit('room-joined', { roomId, role: 'player' });

                if (room.players.length === 2) {
                    console.log(`Starting game in room ${roomId}`);
                    room.players.forEach((player, index) => {
                        player.emit('start-game', {
                            playerId: index,
                            playerIds: room.players.map(p => p.id),
                            playerNames: room.playerNames
                        });
                    });
                    // Thông báo cho khán giả rằng trò chơi bắt đầu
                    room.spectators.forEach(spectator => {
                        spectator.emit('game-started', { playerNames: room.playerNames });
                    });
                }
            } else {
                room.spectators.push(socket);
                socket.roomId = roomId;
                socket.role = 'spectator';
                socket.join(roomId);
                console.log(`Spectator ${socket.id} joined room ${roomId} as ${playerName}`);
                socket.emit('room-joined', { roomId, role: 'spectator' });

                // Gửi trạng thái trò chơi hiện tại nếu trò chơi đã bắt đầu
                if (room.players.length === 2) {
                    socket.emit('game-started', { playerNames: room.playerNames });
                }
            }
        } catch (error) {
            console.error(`Error in join-room for ${socket.id}:`, error);
            socket.emit('error', { message: 'Server error during room join' });
        }
    });

    socket.on('game-state', (data) => {
        try {
            if (!data || !data.roomId || !data.gameState || socket.role !== 'player') {
                console.error(`Invalid game state data from ${socket.id}`);
                socket.emit('error', { message: 'Invalid game state data' });
                return;
            }
            console.log(`Received game state from ${socket.id} for room ${data.roomId}`);
            const room = rooms.get(data.roomId);
            if (room) {
                // Chuyển tiếp gameState đến tất cả khán giả
                room.spectators.forEach(spectator => {
                    spectator.emit('game-state', { gameState: data.gameState });
                });
            }
        } catch (error) {
            console.error(`Error in game-state for ${socket.id}:`, error);
            socket.emit('error', { message: 'Server error during game state update' });
        }
    });

    socket.on('offer', (data) => {
        try {
            if (!data || !data.roomId || !data.offer) {
                console.error(`Invalid offer data from ${socket.id}`);
                socket.emit('error', { message: 'Invalid offer data' });
                return;
            }
            console.log(`Received offer from ${socket.id} for room ${data.roomId}`);
            socket.to(data.roomId).emit('offer', { offer: data.offer });
        } catch (error) {
            console.error(`Error in offer for ${socket.id}:`, error);
            socket.emit('error', { message: 'Server error during offer' });
        }
    });

    socket.on('answer', (data) => {
        try {
            if (!data || !data.roomId || !data.answer) {
                console.error(`Invalid answer data from ${socket.id}`);
                socket.emit('error', { message: 'Invalid answer data' });
                return;
            }
            console.log(`Received answer from ${socket.id} for room ${data.roomId}`);
            socket.to(data.roomId).emit('answer', { answer: data.answer });
        } catch (error) {
            console.error(`Error in answer for ${socket.id}:`, error);
            socket.emit('error', { message: 'Server error during answer' });
        }
    });

    socket.on('ice-candidate', (data) => {
        try {
            if (!data || !data.roomId || !data.candidate) {
                console.error(`Invalid ICE candidate data from ${socket.id}`);
                socket.emit('error', { message: 'Invalid ICE candidate data' });
                return;
            }
            console.log(`Received ICE candidate from ${socket.id} for room ${data.roomId}`);
            socket.to(data.roomId).emit('ice-candidate', { candidate: data.candidate });
        } catch (error) {
            console.error(`Error in ice-candidate for ${socket.id}:`, error);
            socket.emit('error', { message: 'Server error during ICE candidate' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.id} disconnected`);
        const room = socket.roomId ? rooms.get(socket.roomId) : null;
        if (room) {
            if (socket.role === 'player') {
                const index = room.players.findIndex(player => player.id === socket.id);
                if (index !== -1) {
                    room.players.splice(index, 1);
                    room.playerIds.splice(index, 1);
                    room.playerNames.splice(index, 1);
                    console.log(`Player ${socket.id} removed from room ${socket.roomId}`);
                    if (room.players.length === 0) {
                        console.log(`Room ${socket.roomId} is empty, deleting`);
                        rooms.delete(socket.roomId);
                    } else {
                        console.log(`Notifying remaining players and spectators in room ${socket.roomId}`);
                        socket.to(socket.roomId).emit('player-disconnected');
                    }
                }
            } else if (socket.role === 'spectator') {
                const index = room.spectators.findIndex(spectator => spectator.id === socket.id);
                if (index !== -1) {
                    room.spectators.splice(index, 1);
                    console.log(`Spectator ${socket.id} removed from room ${socket.roomId}`);
                    if (room.players.length === 0 && room.spectators.length === 0) {
                        console.log(`Room ${socket.roomId} is empty, deleting`);
                        rooms.delete(socket.roomId);
                    }
                }
            }
        }
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:3000');
});