const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos (HTML, CSS, JS de la carpeta 'public')
app.use(express.static(path.join(__dirname, 'public')));

// Estado básico del juego
let players = {};

io.on('connection', (socket) => {
    console.log('Dispositivo conectado:', socket.id);

    // Identificar si es Pantalla TV o Celular
    socket.on('register-device', (type) => {
        if (type === 'tv') {
            socket.join('tv-room');
            console.log('TV registrada en el sistema.');
        } else {
            // Asignar rol (Jugador 1 o 2)
            const role = Object.keys(players).length < 2 ? 
                         (Object.values(players).includes('P1') ? 'P2' : 'P1') : 'Espectador';
            players[socket.id] = role;
            socket.emit('assign-role', role);
            console.log(`Celular conectado como: ${role}`);
        }
    });

    // Cuando un jugador elige su personaje secreto
    socket.on('character-selected', (data) => {
        // data = { role: 'P1', characterName: 'Mickey' }
        io.to('tv-room').emit('update-status', `${data.role} ha elegido personaje.`);
    });

    // Cuando un jugador descarta a alguien en su pantalla
    socket.on('discard-character', (data) => {
        // Reenvía a la TV para que lo marque visualmente si quieres
        io.to('tv-room').emit('visual-discard', data);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        console.log('Dispositivo desconectado');
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`>>> SERVIDOR INICIADO`);
    console.log(`>>> TV: http://TU_IP_LOCAL:${PORT}`);
    console.log(`>>> Celulares: http://TU_IP_LOCAL:${PORT}/mobile.html`);
});
