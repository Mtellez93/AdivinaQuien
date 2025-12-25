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
// Aquí guardaremos el nombre del personaje que cada jugador DEBE ADIVINAR
let targetsToGuess = { "JUGADOR 1": "", "JUGADOR 2": "" };

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jP73m0cs5RuxM_jNjsDH_tiwpdIH5zc6fM416NOIdHw/export?format=csv";

async function getCharactersFromSheet() {
    try {
        const response = await axios.get(`${SHEET_URL}&cachebuster=${Date.now()}`);
        const content = response.data.replace(/\r/g, "");
        const rows = content.split('\n').slice(1);
        return rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length >= 3) {
                return {
                    id: cols[0].replace(/"/g, '').trim(),
                    nombre: cols[1].replace(/"/g, '').trim().toUpperCase(),
                    url: cols[2].replace(/"/g, '').trim()
                };
            }
            return null;
        }).filter(p => p && p.nombre && p.url.startsWith('http'));
    } catch (e) {
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
        if (allChars.length < 16) return;

        // 1. Elegimos los dos secretos de la lista total
        const shuffled = [...allChars].sort(() => 0.5 - Math.random());
        const secret1 = shuffled[0]; // Lo que J1 debe adivinar (está en tablero J2)
        const secret2 = shuffled[1]; // Lo que J2 debe adivinar (está en tablero J1)

        // 2. Armamos tableros asegurando que el secreto del rival esté presente
        const pool = allChars.filter(p => p.id !== secret1.id && p.id !== secret2.id);
        
        const p1Board = [secret2, ...pool.sort(() => 0.5 - Math.random()).slice(0, 15)].sort(() => 0.5 - Math.random());
        const p2Board = [secret1, ...pool.sort(() => 0.5 - Math.random()).slice(0, 15)].sort(() => 0.5 - Math.random());

        // 3. Guardamos CORRECTAMENTE qué debe adivinar cada uno
        targetsToGuess["JUGADOR 1"] = secret1.nombre;
        targetsToGuess["JUGADOR 2"] = secret2.nombre;

        console.log(`> Partida Iniciada. J1 busca a: ${secret1.nombre} | J2 busca a: ${secret2.nombre}`);

        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') io.to(id).emit('game-setup', { board: p1Board, secret: secret2.nombre });
            if (role === 'JUGADOR 2') io.to(id).emit('game-setup', { board: p2Board, secret: secret1.nombre });
        }

        io.to('tv-room').emit('tv-setup', { p1Board, p2Board });
    });

    socket.on('discard-character', (data) => io.to('tv-room').emit('visual-discard', data));

    socket.on('declare-winner', (data) => {
        const myRole = data.player; // 'JUGADOR 1' o 'JUGADOR 2'
        const correctTarget = targetsToGuess[myRole];
        const userGuess = data.character.trim().toUpperCase();

        if (userGuess === correctTarget) {
            io.emit('game-over', { player: myRole, character: correctTarget });
        } else {
            socket.emit('guess-error', `INCORRECTO: "${userGuess}" NO ES EL OBJETIVO.`);
        }
    });

    socket.on('request-reset', () => io.emit('reset-game'));
    socket.on('disconnect', () => delete players[socket.id]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0');
