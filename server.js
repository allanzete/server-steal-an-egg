const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const players = {};
const bases = {};

// Definição das Áreas do Mapa
const zones = {
    1: { name: 'Floresta Fácil', color: '#1b5e20', yStart: 400, yEnd: 800, eggColor: '#4caf50', bossSpeed: 2.5, rarity: 'Comum' },
    2: { name: 'Deserto Médio', color: '#e65100', yStart: 800, yEnd: 1200, eggColor: '#ff9800', bossSpeed: 3.5, rarity: 'Raro' },
    3: { name: 'Vulcão Difícil', color: '#b71c1c', yStart: 1200, yEnd: 1600, eggColor: '#f44336', bossSpeed: 4.8, rarity: 'Épico' }
};

// Bichos/Guardas de cada área
const bosses = {
    1: { id: 1, x: 1000, y: 600, visionRadius: 180, targetId: null, emoji: '🐊' },
    2: { id: 2, x: 1000, y: 1000, visionRadius: 220, targetId: null, emoji: '🦁' },
    3: { id: 3, x: 1000, y: 1400, visionRadius: 260, targetId: null, emoji: '🐉' }
};

// Ovos no mapa
let eggs = [
    { id: 'e1', zone: 1, x: 900, y: 650, color: '#4caf50', name: 'Ovo Comum' },
    { id: 'e2', zone: 2, x: 1100, y: 1050, color: '#ff9800', name: 'Ovo Raro' },
    { id: 'e3', zone: 3, x: 950, y: 1450, color: '#f44336', name: 'Ovo Vulcânico' }
];

const petEmojis = ['🐶', '🐱', '🦊', '🐼', '🐨', '🦄', '🤖', '👾', '🐲'];
const mutations = ['Nenhuma', 'Dourado ✨', 'Gigante 🐘', 'Radioativo ☢️', 'Cósmico 🌌'];

function checkAndRespawnEggs() {
    if (eggs.length < 5) {
        const z = Math.floor(Math.random() * 3) + 1;
        eggs.push({
            id: 'e_' + Date.now(),
            zone: z,
            x: 800 + Math.random() * 500,
            y: zones[z].yStart + 100 + Math.random() * 200,
            color: zones[z].eggColor,
            name: `Ovo ${zones[z].rarity}`
        });
        io.emit('updateEggs', eggs);
    }
}

// Loop IA dos Bichos (Chase System)
setInterval(() => {
    Object.keys(bosses).forEach(zoneId => {
        const boss = bosses[zoneId];
        const zone = zones[zoneId];
        let targetPlayer = null;

        Object.values(players).forEach(p => {
            if (p.hasEgg && p.hasEgg.zone == zoneId) {
                if (p.y > 350) {
                    const dist = Math.hypot(p.x - boss.x, p.y - boss.y);
                    if (dist < boss.visionRadius) targetPlayer = p;
                }
            }
        });

        if (targetPlayer) {
            const angle = Math.atan2(targetPlayer.y - boss.y, targetPlayer.x - boss.x);
            boss.x += Math.cos(angle) * zone.bossSpeed;
            boss.y += Math.sin(angle) * zone.bossSpeed;

            const hitDist = Math.hypot(targetPlayer.x - boss.x, targetPlayer.y - boss.y);
            if (hitDist < 30) {
                targetPlayer.hasEgg = null;
                const base = bases[targetPlayer.id];
                if (base) { targetPlayer.x = base.x; targetPlayer.y = base.y - 50; }
                io.emit('playerCaught', { playerId: targetPlayer.id, message: 'O bicho te pegou e roubou seu ovo!' });
            }
        }
    });

    io.emit('updateBosses', bosses);
}, 1000 / 30);

// Renda Passiva de Pets
setInterval(() => {
    Object.keys(bases).forEach(socketId => {
        const base = bases[socketId];
        const player = players[socketId];
        if (base && player && base.pets.length > 0) {
            const income = base.pets.reduce((acc, p) => acc + p.value, 0);
            player.coins += income;
        }
    });
    io.emit('updateCoins', players);
}, 2000);

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        const playerName = data.name || `Player_${socket.id.substring(0, 4)}`;
        const baseIndex = Object.keys(bases).length;
        
        const baseX = 200 + (baseIndex * 220);
        const baseY = 200;

        players[socket.id] = {
            id: socket.id,
            name: playerName,
            x: baseX,
            y: baseY + 50,
            speedStat: 10,
            level: 1,
            xp: 0,
            coins: 0,
            color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
            hasEgg: null,
            isSlow: false
        };

        bases[socket.id] = {
            ownerId: socket.id,
            ownerName: playerName,
            x: baseX,
            y: baseY,
            pets: []
        };

        socket.emit('init', { id: socket.id, players, eggs, bases, bosses });
        socket.broadcast.emit('playerJoined', { player: players[socket.id], base: bases[socket.id] });
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player) return;

        player.isSlow = !!data.slow;

        // Se estiver com Modo Lento ligado (SHIFT), anda a 30% da velocidade
        let realMoveSpeed = 3 + (player.speedStat * 0.15);
        if (player.isSlow) {
            realMoveSpeed *= 0.3;
        }

        if (data.up && player.y > 50) player.y -= realMoveSpeed;
        if (data.down && player.y < 1700) player.y += realMoveSpeed;
        if (data.left && player.x > 50) player.x -= realMoveSpeed;
        if (data.right && player.x < 1950) player.x += realMoveSpeed;

        if (player.hasEgg) {
            player.hasEgg.x = player.x;
            player.hasEgg.y = player.y - 15;
        }

        io.emit('playerMoved', { id: socket.id, x: player.x, y: player.y, hasEgg: player.hasEgg, isSlow: player.isSlow });
    });

    socket.on('interact', () => {
        const player = players[socket.id];
        const base = bases[socket.id];
        if (!player || !base) return;

        // Usar Esteira
        const distTreadmill = Math.hypot(player.x - (base.x - 30), player.y - base.y);
        if (distTreadmill < 40) {
            player.speedStat += 1;
            player.xp += 15;

            if (player.xp >= player.level * 100) {
                player.level += 1;
                player.xp = 0;
            }

            io.emit('playerUpgraded', { playerId: socket.id, player });
            return;
        }

        // Depositar Ovo
        if (player.hasEgg) {
            const distBase = Math.hypot(player.x - base.x, player.y - base.y);
            if (distBase < 50) {
                const petEmoji = petEmojis[Math.floor(Math.random() * petEmojis.length)];
                const hasMutation = Math.random() < 0.3;
                const mutation = hasMutation ? mutations[Math.floor(Math.random() * (mutations.length - 1)) + 1] : 'Nenhuma';
                const baseValue = player.hasEgg.zone * 5;
                const finalValue = hasMutation ? baseValue * 3 : baseValue;

                base.pets.push({
                    emoji: petEmoji,
                    mutation: mutation,
                    value: finalValue
                });

                player.xp += 50;
                player.hasEgg = null;

                io.emit('eggHatched', { playerId: socket.id, bases, player });
            }
            return;
        }

        // Pegar Ovo
        eggs.forEach((egg, idx) => {
            const dist = Math.hypot(player.x - egg.x, player.y - egg.y);
            if (dist < 35 && !player.hasEgg) {
                player.hasEgg = egg;
                eggs.splice(idx, 1);
                io.emit('eggStolen', { playerId: socket.id, eggId: egg.id, eggs });
                setTimeout(checkAndRespawnEggs, 4000);
            }
        });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        delete bases[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
