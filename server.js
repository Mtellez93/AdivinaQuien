const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentMatch = { "JUGADOR 1": "", "JUGADOR 2": "" };

const personajes = [
    "MICKEY", "ELSA", "WOODY", "STITCH", "SIMBA", "MALEFICA", 
    "BUZZ", "MOANA", "GOOFY", "DONALD", "MULAN", "PETER PAN", 
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

        currentMatch["JUGADOR 1"] = p1Char;
        currentMatch["JUGADOR 2"] = p2Char;

        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') io.to(id).emit('secret-character', p1Char);
            if (role === 'JUGADOR 2') io.to(id).emit('secret-character', p2Char);
        }

        io.emit('start-timer');
        io.to('tv-room').emit('update-status', "OBJETIVOS ASIGNADOS. INICIANDO RASTREO.");
    });

    socket.on('discard-character', (data) => {
        io.to('tv-room').emit('visual-discard', data);
    });

    socket.on('declare-winner', (data) => {
        const myRole = data.player;
        const rivalRole = myRole === 'JUGADOR 1' ? 'JUGADOR 2' : 'JUGADOR 1';
        const targetToGuess = currentMatch[rivalRole];

        if (data.character.trim().toUpperCase() === targetToGuess) {
            io.emit('game-over', { 
                player: myRole, 
                character: targetToGuess 
            });
        } else {
            socket.emit('guess-error', `EL OBJETIVO NO ES ${data.character}. SIGUE BUSCANDO.`);
        }
    });

    socket.on('request-reset', () => {
        currentMatch = { "JUGADOR 1": "", "JUGADOR 2": "" };
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
