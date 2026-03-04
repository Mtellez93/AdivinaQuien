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
// Guardamos quién es quién realmente
let playerIdentities = { "JUGADOR 1": "", "JUGADOR 2": "" };
let gameStarted = false;

function createLobbyCode(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const lobbyCode = createLobbyCode();

function getLobbyPlayers() {
    return Object.values(players)
        .filter((player) => player.role !== 'ESPECTADOR')
        .sort((a, b) => a.role.localeCompare(b.role))
        .map((player) => ({ role: player.role, name: player.name }));
}

function broadcastLobbyUpdate() {
    const lobbyPlayers = getLobbyPlayers();
    const readyToStart = lobbyPlayers.length === 2;
    io.to('tv-room').emit('lobby-update', { players: lobbyPlayers, readyToStart, lobbyCode });
    io.emit('waiting-room-update', { players: lobbyPlayers, readyToStart, gameStarted });
}

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
    socket.on('register-tv', () => {
        socket.join('tv-room');
        socket.emit('lobby-info', { lobbyCode, players: getLobbyPlayers(), readyToStart: getLobbyPlayers().length === 2 });
    });

    socket.on('join-lobby', (payload) => {
        const code = payload?.code?.trim().toUpperCase();
        const name = payload?.name?.trim().toUpperCase();

        if (!code || code !== lobbyCode) {
            socket.emit('join-error', 'CÓDIGO DE LOBBY INVÁLIDO');
            return;
        }

        if (!name) {
            socket.emit('join-error', 'INGRESA TU NOMBRE');
            return;
        }

        const takenRoles = Object.values(players).map((player) => player.role);
        const role = takenRoles.length < 2
            ? (takenRoles.includes('JUGADOR 1') ? 'JUGADOR 2' : 'JUGADOR 1')
            : 'ESPECTADOR';

        players[socket.id] = { role, name };
        socket.emit('assign-role', { role, name, lobbyCode });
        broadcastLobbyUpdate();
    });

    socket.on('start-game', async () => {
        const lobbyPlayers = getLobbyPlayers();
        if (lobbyPlayers.length < 2) return;

        const allChars = await getCharactersFromSheet();
        if (allChars.length < 16) return;
        gameStarted = true;

        const shuffled = [...allChars].sort(() => 0.5 - Math.random());
        
        // IDENTIDADES REALES (Quién es quién)
        const identityP1 = shuffled[0]; 
        const identityP2 = shuffled[1]; 

        playerIdentities["JUGADOR 1"] = identityP1.nombre;
        playerIdentities["JUGADOR 2"] = identityP2.nombre;

        const pool = allChars.filter(p => p.id !== identityP1.id && p.id !== identityP2.id);
        
        // TABLEROS: Cada jugador ve en su pantalla al rival mezclado con otros
        const p1Board = [identityP2, ...pool.sort(() => 0.5 - Math.random()).slice(0, 15)].sort(() => 0.5 - Math.random());
        const p2Board = [identityP1, ...pool.sort(() => 0.5 - Math.random()).slice(0, 15)].sort(() => 0.5 - Math.random());

        console.log(`> J1 ES ${identityP1.nombre} | J2 ES ${identityP2.nombre}`);

        for (const [id, player] of Object.entries(players)) {
            if (player.role === 'JUGADOR 1') {
                // J1 sabe quién es él (P1) y busca al rival en su tablero (p1Board)
                io.to(id).emit('game-setup', { board: p1Board, secret: identityP1.nombre });
            }
            if (player.role === 'JUGADOR 2') {
                // J2 sabe quién es él (P2) y busca al rival en su tablero (p2Board)
                io.to(id).emit('game-setup', { board: p2Board, secret: identityP2.nombre });
            }
        }

        io.to('tv-room').emit('tv-setup', { p1Board, p2Board });
    });

    socket.on('discard-character', (data) => io.to('tv-room').emit('visual-discard', data));

    socket.on('declare-winner', (data) => {
        const myRole = data.player;
        const rivalRole = (myRole === 'JUGADOR 1') ? 'JUGADOR 2' : 'JUGADOR 1';
        const target = playerIdentities[rivalRole]; // Se valida contra el nombre del rival
        
        const guess = data.character.trim().toUpperCase();

        if (guess === target) {
            io.emit('game-over', { player: myRole, character: target });
        } else {
            socket.emit('guess-error', `INCORRECTO. EL RIVAL NO ES "${guess}"`);
        }
    });

    socket.on('request-reset', () => {
        gameStarted = false;
        io.emit('reset-game');
        broadcastLobbyUpdate();
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        broadcastLobbyUpdate();
    });
});

server.listen(process.env.PORT || 3000, '0.0.0.0');
