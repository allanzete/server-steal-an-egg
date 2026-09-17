const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const players = {};
const bases = {};
let eggs = [
    { id: 'egg1', x: 400, y: 200, color: '#ffd700', name: 'Ovo Dourado', rarity: 'Raro' },
    { id: 'egg2', x: 250, y: 220, color: '#a855f7', name: 'Ovo Mágico', rarity: 'Épico' },
    { id: 'egg3', x: 550, y: 250, color: '#3b82f6', name: 'Ovo Comum', rarity: 'Comum' }
];

// Re-gera novos ovos na arena central se acabar
function checkAndRespawnEggs() {
    if (eggs.length < 3) {
        const types = [
            { color: '#3b82f6', name: 'Ovo Comum', rarity: 'Comum' },
            { color: '#a855f7', name: 'Ovo Mágico', rarity: 'Épico' },
            { color: '#ffd700', name: 'Ovo Dourado', rarity: 'Raro' }
        ];
        const randomType = types[Math.floor(Math.random() * types.length)];
        eggs.push({
            id: 'egg_' + Date.now(),
            x: 200 + Math.random() * 400,
            y: 180 + Math.random() * 100,
            ...randomType
        });
        io.emit('updateEggs', eggs);
    }
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        const playerName = data.name || `Player_${socket.id.substring(0, 4)}`;
        
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            x: 100 + (Object.keys(players).length * 80) % 600,
            y: 450,
            speed: 3, // Velocidade inicial
            coins: 0,
            color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
            hasEgg: null
        };

        // Posição fixa da base para cada jogador
        const baseIndex = Object.keys(bases).length;
        bases[socket.id] = {
            ownerId: socket.id,
            ownerName: playerName,
            x: 80 + (baseIndex * 140) % 700,
            y: 480,
            treadmillLevel: 1,
            pets: [] // Guardará os pets chocados que geram moedas
        };

        socket.emit('init', { id: socket.id, players, eggs, bases });
        socket.broadcast.emit('playerJoined', { player: players[socket.id], base: bases[socket.id] });
    });

    // Movimentação
    socket.on('move', (movement) => {
        const player = players[socket.id];
        if (!player) return;

        const spd = player.speed;
        if (movement.up && player.y > 160) player.y -= spd;
        if (movement.down && player.y < 570) player.y += spd;
        if (movement.left && player.x > 20) player.x -= spd;
        if (movement.right && player.x < 780) player.x += spd;

        if (player.hasEgg) {
            player.hasEgg.x = player.x;
            player.hasEgg.y = player.y - 10;
        }

        io.emit('playerMoved', { id: socket.id, x: player.x, y: player.y, hasEgg: player.hasEgg });
    });

    // Ações: Pegar ovo / Chocar na Base / Usar Esteira
    socket.on('interact', () => {
        const player = players[socket.id];
        const base = bases[socket.id];
        if (!player || !base) return;

        // 1. Usar a Esteira para treinar velocidade
        const distToTreadmill = Math.hypot(player.x - (base.x - 20), player.y - base.y);
        if (distToTreadmill < 25) {
            player.speed += 0.2; // Aumenta velocidade
            io.emit('speedUpgraded', { playerId: socket.id, speed: player.speed });
            return;
        }

        // 2. Chocar o Ovo na Incubadora da Base
        if (player.hasEgg) {
            const distToBase = Math.hypot(player.x - base.x, player.y - base.y);
            if (distToBase < 40) {
                // Transforma o ovo em um Pet que gera dinheiro!
                base.pets.push({
                    name: `Pet ${player.hasEgg.name}`,
                    color: player.hasEgg.color,
                    income: player.hasEgg.rarity === 'Épico' ? 5 : (player.hasEgg.rarity === 'Raro' ? 3 : 1)
                });
                player.hasEgg = null;
                io.emit('eggHatched', { playerId: socket.id, bases, hasEgg: null });
            }
            return;
        }

        // 3. Roubar Ovo do Centro
        eggs.forEach((egg, index) => {
            const dist = Math.hypot(player.x - egg.x, player.y - egg.y);
            if (dist < 30 && !player.hasEgg) {
                player.hasEgg = egg;
                eggs.splice(index, 1);
                io.emit('eggStolen', { playerId: socket.id, eggId: egg.id, eggs });
                setTimeout(checkAndRespawnEggs, 5000);
            }
        });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        delete bases[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// Loop Passivo: Pets geram moedas a cada 2 segundos
setInterval(() => {
    Object.keys(bases).forEach(socketId => {
        const base = bases[socketId];
        const player = players[socketId];
        if (base && player && base.pets.length > 0) {
            const totalIncome = base.pets.reduce((acc, pet) => acc + pet.income, 0);
            player.coins += totalIncome;
        }
    });
    io.emit('updateCoins', players);
}, 2000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
