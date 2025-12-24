const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
const personajes = [
    "MICKEY MOUSE", "ELSA", "WOODY", "STITCH", "SIMBA", "MALEFICA", 
    "BUZZ LIGHTYEAR", "MOANA", "GOOFY", "DONALD", "MULAN", "PETER PAN", 
    "RAPUNZEL", "ALADDIN", "OLAF", "CENICIENTA"
];

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
        const p1Char = personajes[Math.floor(Math.random() * personajes.length)];
        const p2Char = personajes[Math.floor(Math.random() * personajes.length)];

        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') io.to(id).emit('secret-character', p1Char);
            if (role === 'JUGADOR 2') io.to(id).emit('secret-character', p2Char);
        }

        io.emit('start-timer');
        io.to('tv-room').emit('update-status', "¡PARTIDA INICIADA! TABLEROS INDEPENDIENTES LISTOS.");
    });

    socket.on('discard-character', (data) => {
        // data contiene el ID del personaje y el ROL del jugador
        io.to('tv-room').emit('visual-discard', data);
    });

    socket.on('declare-winner', (data) => {
        io.emit('game-over', data);
    });

    socket.on('request-reset', () => {
        io.emit('reset-game');
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo.`);
});
