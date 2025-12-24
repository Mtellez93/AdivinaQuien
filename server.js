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

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jP73m0cs5RuxM_jNjsDH_tiwpdIH5zc6fM416NOIdHw/export?format=csv";

async function getCharactersFromSheet() {
    try {
        const response = await axios.get(`${SHEET_URL}&cachebuster=${Date.now()}`);
        const content = response.data.replace(/\r/g, "");
        const rows = content.split('\n').slice(1);

        const items = rows.map(row => {
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

        return items;
    } catch (e) {
        console.error("> Error Sheets:", e.message);
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
        if (allChars.length < 20) return; // Seguridad mínima

        // 1. Elegimos los 2 personajes secretos de la lista completa primero
        const shuffledAll = [...allChars].sort(() => 0.5 - Math.random());
        const secretForP1toGuess = shuffledAll[0]; // Estará en el tablero de J2
        const secretForP2toGuess = shuffledAll[1]; // Estará en el tablero de J1

        // 2. Creamos el tablero para J1:
        // Debe contener obligatoriamente el personaje que J2 tiene que adivinar (secretForP2toGuess)
        // y 15 personajes más que NO sean el secreto que J1 debe adivinar (para evitar confusiones)
        const poolForP1 = allChars.filter(p => p.id !== secretForP1toGuess.id && p.id !== secretForP2toGuess.id);
        const p1Board = [secretForP2toGuess, ...poolForP1.sort(() => 0.5 - Math.random()).slice(0, 15)];

        // 3. Creamos el tablero para J2:
        // Debe contener el personaje que J1 tiene que adivinar (secretForP1toGuess)
        const poolForP2 = allChars.filter(p => p.id !== secretForP1toGuess.id && p.id !== secretForP2toGuess.id);
        const p2Board = [secretForP1toGuess, ...poolForP2.sort(() => 0.5 - Math.random()).slice(0, 15)];

        // 4. Barajamos los tableros finales para que el secreto no esté siempre en la primera posición
        const finalP1Board = p1Board.sort(() => 0.5 - Math.random());
        const finalP2Board = p2Board.sort(() => 0.5 - Math.random());

        currentMatch["JUGADOR 1"] = secretForP1toGuess.nombre;
        currentMatch["JUGADOR 2"] = secretForP2toGuess.nombre;

        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') io.to(id).emit('game-setup', { board: finalP1Board, secret: secretForP1toGuess.nombre });
            if (role === 'JUGADOR 2') io.to(id).emit('game-setup', { board: finalP2Board, secret: secretForP2toGuess.nombre });
        }

        io.to('tv-room').emit('tv-setup', { p1Board: finalP1Board, p2Board: finalP2Board });
        io.emit('start-timer');
    });

    socket.on('discard-character', (data) => io.to('tv-room').emit('visual-discard', data));
    socket.on('declare-winner', (data) => {
        if (data.character.trim().toUpperCase() === currentMatch[data.player].toUpperCase()) {
            io.emit('game-over', { player: data.player, character: currentMatch[data.player] });
        } else {
            socket.emit('guess-error', `ERROR: EL RIVAL NO TIENE A ${data.character}`);
        }
    });

    socket.on('request-reset', () => io.emit('reset-game'));
    socket.on('disconnect', () => delete players[socket.id]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Servidor Corregido en Puerto ${PORT}`));
