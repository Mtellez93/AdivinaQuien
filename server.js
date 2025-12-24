const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentMatch = { "JUGADOR 1": "", "JUGADOR 2": "" };

// Tu URL de Google Sheets (formato CSV para lectura directa)
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jP73m0cs5RuxM_jNjsDH_tiwpdIH5zc6fM416NOIdHw/gviz/tq?tqx=out:csv";

async function getCharactersFromSheet() {
    try {
        const response = await axios.get(SHEET_URL);
        // Dividir por líneas y limpiar comillas
        const rows = response.data.split('\n').slice(1); 
        return rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/"/g, '').trim());
            return { id: cols[0], nombre: cols[1], url: cols[2] };
        }).filter(p => p.nombre && p.url);
    } catch (e) {
        console.error("Error leyendo Google Sheets:", e);
        return [];
    }
}

io.on('connection', (socket) => {
    socket.on('register-device', (type) => {
        if (type === 'tv') {
            socket.join('tv-room');
        } else {
            const role = Object.keys(players).length < 2 ? 
                         (Object.values(players).includes('JUGADOR 1') ? 'JUGADOR 2' : 'JUGADOR 1') : 'ESPECTADOR';
            players[socket.id] = role;
            socket.emit('assign-role', role);
        }
    });

    socket.on('start-game', async () => {
        const allChars = await getCharactersFromSheet();
        if (allChars.length < 16) {
            return io.emit('update-status', "ERROR: Faltan personajes en el Excel.");
        }

        // Crear dos tableros diferentes de 16 personajes cada uno
        const p1Board = [...allChars].sort(() => 0.5 - Math.random()).slice(0, 16);
        const p2Board = [...allChars].sort(() => 0.5 - Math.random()).slice(0, 16);

        // El personaje secreto de J1 se elige de SU propio tablero (es el que J2 debe adivinar)
        const p1Secret = p1Board[Math.floor(Math.random() * 16)].nombre;
        const p2Secret = p2Board[Math.floor(Math.random() * 16)].nombre;

        currentMatch["JUGADOR 1"] = p1Secret;
        currentMatch["JUGADOR 2"] = p2Secret;

        // Enviar a cada móvil su configuración
        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') io.to(id).emit('game-setup', { board: p1Board, secret: p1Secret });
            if (role === 'JUGADOR 2') io.to(id).emit('game-setup', { board: p2Board, secret: p2Secret });
        }

        // Enviar a la TV ambos tableros
        io.to('tv-room').emit('tv-setup', { p1Board, p2Board });
        io.emit('start-timer');
    });

    socket.on('discard-character', (data) => io.to('tv-room').emit('visual-discard', data));

    socket.on('declare-winner', (data) => {
        const rivalRole = data.player === 'JUGADOR 1' ? 'JUGADOR 2' : 'JUGADOR 1';
        const target = currentMatch[rivalRole];
        if (data.character.trim().toUpperCase() === target.toUpperCase()) {
            io.emit('game-over', { player: data.player, character: target });
        } else {
            socket.emit('guess-error', `EL RIVAL NO TIENE A ${data.character}`);
        }
    });

    socket.on('request-reset', () => io.emit('reset-game'));
    socket.on('disconnect', () => delete players[socket.id]);
});

server.listen(3000, '0.0.0.0', () => console.log("Servidor iniciado con Google Sheets"));
