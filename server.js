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

// URL de Google Sheets en formato CSV (Usando export para mayor estabilidad)
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jP73m0cs5RuxM_jNjsDH_tiwpdIH5zc6fM416NOIdHw/export?format=csv";

async function getCharactersFromSheet() {
    try {
        // Cachebuster para obtener siempre datos frescos
        const response = await axios.get(`${SHEET_URL}&cachebuster=${Date.now()}`);
        const content = response.data.replace(/\r/g, "");
        const rows = content.split('\n').slice(1); // Omitir cabecera

        const items = rows.map(row => {
            // Regex para separar por comas respetando contenidos entre comillas
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

        console.log(`> Sistema: ${items.length} personajes cargados desde la nube.`);
        return items;
    } catch (e) {
        console.error("> Error Crítico: No se pudo acceder al Google Sheet.", e.message);
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
            console.log(`> Dispositivo registrado como: ${role}`);
        }
    });

    socket.on('start-game', async () => {
        console.log("> Iniciando nueva partida con lógica de asignación cruzada...");
        const allChars = await getCharactersFromSheet();
        
        if (allChars.length < 16) {
            console.log("> Error: Se necesitan al menos 16 personajes en el Excel.");
            return;
        }

        // 1. Generar tableros aleatorios para cada jugador
        const p1Board = [...allChars].sort(() => 0.5 - Math.random()).slice(0, 16);
        const p2Board = [...allChars].sort(() => 0.5 - Math.random()).slice(0, 16);

        // 2. LÓGICA DE ASIGNACIÓN CRUZADA:
        // El personaje que J1 debe adivinar se elige del tablero de J2.
        // El personaje que J2 debe adivinar se elige del tablero de J1.
        const p1Target = p2Board[Math.floor(Math.random() * 16)].nombre;
        const p2Target = p1Board[Math.floor(Math.random() * 16)].nombre;

        // Guardamos en el servidor quién debe adivinar a quién
        currentMatch["JUGADOR 1"] = p1Target; 
        currentMatch["JUGADOR 2"] = p2Target; 

        // 3. Notificar a los móviles
        for (const [id, role] of Object.entries(players)) {
            if (role === 'JUGADOR 1') {
                // J1 recibe su tablero y el personaje que EL RIVAL debe adivinar (p2Target)
                io.to(id).emit('game-setup', { board: p1Board, secret: p2Target });
            }
            if (role === 'JUGADOR 2') {
                // J2 recibe su tablero y el personaje que EL RIVAL debe adivinar (p1Target)
                io.to(id).emit('game-setup', { board: p2Board, secret: p1Target });
            }
        }

        // 4. Notificar a la TV para dibujar los tableros
        io.to('tv-room').emit('tv-setup', { p1Board, p2Board });
        io.emit('start-timer');
    });

    socket.on('discard-character', (data) => {
        io.to('tv-room').emit('visual-discard', data);
    });

    socket.on('declare-winner', (data) => {
        const myRole = data.player;
        const targetToGuess = currentMatch[myRole];

        if (data.character.trim().toUpperCase() === targetToGuess.toUpperCase()) {
            io.emit('game-over', { 
                player: myRole, 
                character: targetToGuess 
            });
        } else {
            socket.emit('guess-error', `EL PERSONAJE "${data.character}" NO ES EL OBJETIVO.`);
        }
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
    console.log(`>>> SERVIDOR ACTIVO EN PUERTO ${PORT} <<<`);
});
