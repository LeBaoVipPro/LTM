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

// Quản lý phòng bằng Map: { roomId: { players: [socket1, socket2], playerIds: [0, 1] } }
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', (roomId) => {
        try {
            if (!roomId || typeof roomId !== 'string') {
                console.error(`Invalid room ID from ${socket.id}`);
                socket.emit('error', { message: 'Invalid room ID' });
                return;
            }

            let room = rooms.get(roomId);
            if (!room) {
                room = { players: [], playerIds: [] };
                rooms.set(roomId, room);
                console.log(`Created room ${roomId}`);
            }

            if (room.players.length >= 2) {
                console.log(`Room ${roomId} is full for ${socket.id}`);
                socket.emit('room-full');
                return;
            }

            room.players.push(socket);
            room.playerIds.push(room.players.length - 1);
            socket.roomId = roomId;
            socket.join(roomId);
            console.log(`Player ${socket.id} joined room ${roomId} as Player ${room.players.length - 1}`);
            socket.emit('room-joined', { roomId });

            if (room.players.length === 2) {
                console.log(`Starting game in room ${roomId}`);
                room.players.forEach((player, index) => {
                    player.emit('start-game', {
                        playerId: index,
                        playerIds: room.players.map(p => p.id)
                    });
                });
            }
        } catch (error) {
            console.error(`Error in join-room for ${socket.id}:`, error);
            socket.emit('error', { message: 'Server error during room join' });
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
        console.log(`Player ${socket.id} disconnected`);
        const room = socket.roomId ? rooms.get(socket.roomId) : null;
        if (room) {
            room.players = room.players.filter(player => player.id !== socket.id);
            room.playerIds = room.players.map((_, index) => index);
            console.log(`Player ${socket.id} removed from room ${socket.roomId}`);
            if (room.players.length === 0) {
                console.log(`Room ${socket.roomId} is empty, deleting`);
                rooms.delete(socket.roomId);
            } else {
                console.log(`Notifying remaining players in room ${socket.roomId}`);
                socket.to(socket.roomId).emit('player-disconnected');
            }
        }
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:3000');
});