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
let whatPlayerMustGuess = { "JUGADOR 1": "", "JUGADOR 2": "" };

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
    } catch (e) { return []; }
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

        const shuffled = [...allChars].sort(() => 0.5 - Math.random());
        
        const identityP1 = shuffled[0]; 
        const identityP2 = shuffled[1]; 

        // J1 debe adivinar la identidad del J2 y viceversa
        whatPlayerMustGuess["JUGADOR 1"] = identityP2.nombre; 
        whatPlayerMustGuess["JUGADOR 2"] = identityP1.nombre;

        const pool = allChars.filter(p => p.id !== identityP1.id && p.id !== identityP2.id);
        
        const p1Board = [identityP2, ...pool.sort(() => 0.5 - Math.random()).slice(0, 15)].sort(() => 0.5 - Math.random());
        const p2Board = [identityP1, ...pool.sort(() => 0.5 - Math.random()).slice(0, 15)].sort(() => 0.5 - Math.random());

        // IMPORTANTE: io.to(id) asegura que el emisor también reciba el mensaje
        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') {
                io.to(id).emit('game-setup', { board: p1Board, secret: identityP2.nombre });
            }
            if (role === 'JUGADOR 2') {
                io.to(id).emit('game-setup', { board: p2Board, secret: identityP1.nombre });
            }
        }

        io.to('tv-room').emit('tv-setup', { p1Board, p2Board });
    });

    socket.on('discard-character', (data) => io.to('tv-room').emit('visual-discard', data));

    socket.on('declare-winner', (data) => {
        const target = whatPlayerMustGuess[data.player];
        if (data.character.trim().toUpperCase() === target) {
            io.emit('game-over', { player: data.player, character: target });
        } else {
            socket.emit('guess-error', `INCORRECTO. EL RIVAL NO ES "${data.character.toUpperCase()}"`);
        }
    });

    socket.on('request-reset', () => io.emit('reset-game'));
    socket.on('disconnect', () => delete players[socket.id]);
});

server.listen(process.env.PORT || 3000, '0.0.0.0');
