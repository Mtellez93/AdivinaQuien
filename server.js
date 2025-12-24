const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};

io.on('connection', (socket) => {
    socket.on('register-device', (type) => {
        if (type === 'tv') {
            socket.join('tv-room');
        } else {
            const role = Object.keys(players).length < 2 ? 
                         (Object.values(players).includes('JUGADOR 1') ? 'JUGADOR 2' : 'JUGADOR 1') : 'ESPECTADOR';
            players[socket.id] = role;
            socket.emit('assign-role', role);
            io.to('tv-room').emit('update-status', `${role} CONECTADO.`);
        }
    });

    socket.on('start-game', () => {
        io.emit('start-timer');
        io.to('tv-room').emit('update-status', "CRONÓMETRO INICIADO.");
    });

    socket.on('discard-character', (data) => {
        io.to('tv-room').emit('visual-discard', data);
    });

    socket.on('declare-winner', (data) => {
        io.emit('game-over', data);
    });

    // NUEVO: Evento para reiniciar todo
    socket.on('request-reset', () => {
        io.emit('reset-game');
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
