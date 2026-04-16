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
let socketToPlayerId = {};
const reconnectCleanupTimers = {};
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
// Guardamos quién es quién realmente
let playerIdentities = { "JUGADOR 1": "", "JUGADOR 2": "" };
let gameStarted = false;
let currentGameState = null;

function createLobbyCode(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

let lobbyCode = createLobbyCode();

function getLobbyPlayers() {
    return Object.values(players)
        .filter((player) => player.role !== 'ESPECTADOR')
        .sort((a, b) => a.role.localeCompare(b.role))
        .map((player) => ({ role: player.role, name: player.name }));
}

function getConnectedLobbyPlayers() {
    return Object.values(players)
        .filter((player) => player.role !== 'ESPECTADOR' && player.socketId)
        .sort((a, b) => a.role.localeCompare(b.role));
}

function getConnectedPlayerSocketIds() {
    return getConnectedLobbyPlayers()
        .map((player) => player.socketId)
        .filter(Boolean);
}

function resetLobbyState() {
    gameStarted = false;
    currentGameState = null;
    players = {};
    socketToPlayerId = {};
    playerIdentities = { "JUGADOR 1": "", "JUGADOR 2": "" };

    Object.keys(reconnectCleanupTimers).forEach((playerId) => {
        clearTimeout(reconnectCleanupTimers[playerId]);
        delete reconnectCleanupTimers[playerId];
    });
}

function attachSocketToPlayer(playerId, socketId) {
    const player = players[playerId];
    if (!player) return;

    if (player.socketId && player.socketId !== socketId) {
        delete socketToPlayerId[player.socketId];
    }

    player.socketId = socketId;
    clearTimeout(reconnectCleanupTimers[playerId]);
    delete reconnectCleanupTimers[playerId];
    socketToPlayerId[socketId] = playerId;
}

function scheduleDisconnectedPlayerCleanup(playerId) {
    clearTimeout(reconnectCleanupTimers[playerId]);
    reconnectCleanupTimers[playerId] = setTimeout(() => {
        const player = players[playerId];
        if (player && !player.socketId) {
            delete players[playerId];
            broadcastLobbyUpdate();
        }
        delete reconnectCleanupTimers[playerId];
    }, RECONNECT_GRACE_MS);
}

function broadcastLobbyUpdate() {
    const lobbyPlayers = getLobbyPlayers();
    const readyToStart = getConnectedLobbyPlayers().length === 2;
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

        if (gameStarted && currentGameState) {
            socket.emit('tv-setup', {
                p1Board: currentGameState.p1Board,
                p2Board: currentGameState.p2Board
            });

            for (const discard of currentGameState.discards) {
                socket.emit('visual-discard', discard);
            }
        }
    });

    socket.on('create-new-lobby', () => {
        resetLobbyState();
        lobbyCode = createLobbyCode();
        io.emit('reset-game');
        broadcastLobbyUpdate();
    });

    socket.on('join-lobby', (payload) => {
        const code = payload?.code?.trim().toUpperCase();
        const name = payload?.name?.trim().toUpperCase();
        const incomingPlayerId = payload?.playerId?.trim();

        if (!code || code !== lobbyCode) {
            socket.emit('join-error', 'CÓDIGO DE LOBBY INVÁLIDO');
            return;
        }

        if (!name) {
            socket.emit('join-error', 'INGRESA TU NOMBRE');
            return;
        }

        let playerId = incomingPlayerId;
        let existingPlayer = incomingPlayerId ? players[incomingPlayerId] : null;

        if (existingPlayer && existingPlayer.name !== name) {
            existingPlayer = null;
            playerId = null;
        }

        if (!existingPlayer) {
            playerId = `p_${Math.random().toString(36).slice(2, 12)}`;
            const takenRoles = Object.values(players)
                .filter((player) => player.role !== 'ESPECTADOR')
                .map((player) => player.role);

            const role = takenRoles.length < 2
                ? (takenRoles.includes('JUGADOR 1') ? 'JUGADOR 2' : 'JUGADOR 1')
                : 'ESPECTADOR';

            players[playerId] = { playerId, role, name, socketId: null };
        } else {
            existingPlayer.name = name;
        }

        attachSocketToPlayer(playerId, socket.id);

        const player = players[playerId];
        socket.emit('assign-role', { role: player.role, name: player.name, lobbyCode, playerId });

        if (gameStarted && currentGameState) {
            if (player.role === 'JUGADOR 1') {
                socket.emit('game-setup', {
                    board: currentGameState.p1Board,
                    secret: currentGameState.identityP1.nombre
                });
            }

            if (player.role === 'JUGADOR 2') {
                socket.emit('game-setup', {
                    board: currentGameState.p2Board,
                    secret: currentGameState.identityP2.nombre
                });
            }
        }

        broadcastLobbyUpdate();
    });

    socket.on('start-game', async () => {
        const lobbyPlayers = getConnectedLobbyPlayers();
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

        currentGameState = {
            p1Board,
            p2Board,
            identityP1,
            identityP2,
            discards: []
        };

        console.log(`> J1 ES ${identityP1.nombre} | J2 ES ${identityP2.nombre}`);

        for (const player of Object.values(players)) {
            if (!player.socketId) continue;

            if (player.role === 'JUGADOR 1') {
                // J1 sabe quién es él (P1) y busca al rival en su tablero (p1Board)
                io.to(player.socketId).emit('game-setup', { board: p1Board, secret: identityP1.nombre });
            }
            if (player.role === 'JUGADOR 2') {
                // J2 sabe quién es él (P2) y busca al rival en su tablero (p2Board)
                io.to(player.socketId).emit('game-setup', { board: p2Board, secret: identityP2.nombre });
            }
        }

        io.to('tv-room').emit('tv-setup', { p1Board, p2Board });
    });

    socket.on('discard-character', (data) => {
        if (gameStarted && currentGameState) {
            currentGameState.discards.push(data);
        }

        io.to('tv-room').emit('visual-discard', data);
    });

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
        const connectedPlayerSocketIds = getConnectedPlayerSocketIds();
        gameStarted = false;
        currentGameState = null;
        io.emit('reset-game');
        resetLobbyState();
        connectedPlayerSocketIds.forEach((socketId) => {
            io.sockets.sockets.get(socketId)?.disconnect(true);
        });
        broadcastLobbyUpdate();
    });

    socket.on('disconnect', () => {
        const playerId = socketToPlayerId[socket.id];
        if (!playerId) return;

        delete socketToPlayerId[socket.id];

        if (players[playerId] && players[playerId].socketId === socket.id) {
            players[playerId].socketId = null;
            scheduleDisconnectedPlayerCleanup(playerId);
        }

        broadcastLobbyUpdate();
    });
});

server.listen(process.env.PORT || 3000, '0.0.0.0');
