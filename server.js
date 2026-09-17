const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000
});

// Serve o frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====================== CONFIGURAÇÕES ======================
const CONFIG = {
    TICK_RATE: 1000 / 30,          // 30 FPS
    INCOME_INTERVAL: 2000,
    MAP_WIDTH: 2000,
    MAP_HEIGHT: 1800,
    SAFE_ZONE_Y: 350,
    BASE_Y: 180,
    BASE_SPACING: 240,
    PLAYER_RADIUS: 16,
    EGG_PICKUP_RADIUS: 38,
    BOSS_HIT_RADIUS: 32,
    TREADMILL_RADIUS: 45,
    DEPOSIT_RADIUS: 55,
    MAX_EGGS: 6,
    EGG_RESPAWN_DELAY: 3500
};

const ZONES = {
    1: {
        name: 'Floresta Fácil',
        color: '#1b5e20',
        yStart: 400,
        yEnd: 800,
        eggColor: '#4caf50',
        bossSpeed: 2.4,
        rarity: 'Comum',
        valueMultiplier: 1
    },
    2: {
        name: 'Deserto Médio',
        color: '#e65100',
        yStart: 800,
        yEnd: 1200,
        eggColor: '#ff9800',
        bossSpeed: 3.3,
        rarity: 'Raro',
        valueMultiplier: 2
    },
    3: {
        name: 'Vulcão Difícil',
        color: '#b71c1c',
        yStart: 1200,
        yEnd: 1700,
        eggColor: '#f44336',
        bossSpeed: 4.6,
        rarity: 'Épico',
        valueMultiplier: 3
    }
};

const PET_EMOJIS = ['🐶', '🐱', '🦊', '🐼', '🐨', '🦄', '🤖', '👾', '🐲', '🦁', '🐯', '🐸'];
const MUTATIONS = [
    { name: 'Nenhuma', multiplier: 1 },
    { name: 'Dourado ✨', multiplier: 2.5 },
    { name: 'Gigante 🐘', multiplier: 2 },
    { name: 'Radioativo ☢️', multiplier: 3 },
    { name: 'Cósmico 🌌', multiplier: 4 }
];

// ====================== ESTADO DO JOGO ======================
const players = {};
const bases = {};
let eggs = [];
let nextEggId = 1;

const bosses = {
    1: { id: 1, x: 1000, y: 600, visionRadius: 190, targetId: null, emoji: '🐊' },
    2: { id: 2, x: 1000, y: 1000, visionRadius: 230, targetId: null, emoji: '🦁' },
    3: { id: 3, x: 1000, y: 1450, visionRadius: 270, targetId: null, emoji: '🐉' }
};

// ====================== FUNÇÕES AUXILIARES ======================
function createPlayer(socketId, name) {
    const baseIndex = Object.keys(bases).length;
    const baseX = 180 + (baseIndex * CONFIG.BASE_SPACING);

    players[socketId] = {
        id: socketId,
        name: name.substring(0, 12) || `Player_${socketId.substring(0, 4)}`,
        x: baseX,
        y: CONFIG.BASE_Y + 60,
        speedStat: 10,
        level: 1,
        xp: 0,
        coins: 0,
        color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
        hasEgg: null,
        isSlow: false
    };

    bases[socketId] = {
        ownerId: socketId,
        ownerName: players[socketId].name,
        x: baseX,
        y: CONFIG.BASE_Y,
        pets: []
    };

    return { player: players[socketId], base: bases[socketId] };
}

function spawnEgg(forceZone = null) {
    if (eggs.length >= CONFIG.MAX_EGGS) return;

    const zoneId = forceZone || (Math.floor(Math.random() * 3) + 1);
    const zone = ZONES[zoneId];

    const egg = {
        id: `e${nextEggId++}`,
        zone: zoneId,
        x: 600 + Math.random() * 900,
        y: zone.yStart + 80 + Math.random() * (zone.yEnd - zone.yStart - 160),
        color: zone.eggColor,
        name: `Ovo ${zone.rarity}`
    };

    eggs.push(egg);
    io.emit('updateEggs', eggs);
}

function dropEgg(player) {
    if (!player.hasEgg) return;

    const dropped = {
        ...player.hasEgg,
        x: player.x + (Math.random() * 40 - 20),
        y: player.y + (Math.random() * 40 - 20)
    };

    eggs.push(dropped);
    player.hasEgg = null;
    io.emit('updateEggs', eggs);
}

function calculateIncome(base) {
    return base.pets.reduce((sum, pet) => sum + pet.value, 0);
}

function addXP(player, amount) {
    player.xp += amount;
    while (player.xp >= player.level * 100) {
        player.xp -= player.level * 100;
        player.level += 1;
    }
}

// ====================== LOOPS DO JOGO ======================

// IA dos Bosses
setInterval(() => {
    Object.keys(bosses).forEach(zoneId => {
        const boss = bosses[zoneId];
        const zone = ZONES[zoneId];
        let target = null;
        let closestDist = Infinity;

        Object.values(players).forEach(p => {
            // Só persegue quem está com ovo DAQUELA zona e fora da área segura
            if (p.hasEgg && p.hasEgg.zone == zoneId && p.y > CONFIG.SAFE_ZONE_Y) {
                const dist = Math.hypot(p.x - boss.x, p.y - boss.y);
                if (dist < boss.visionRadius && dist < closestDist) {
                    closestDist = dist;
                    target = p;
                }
            }
        });

        boss.targetId = target ? target.id : null;

        if (target) {
            const angle = Math.atan2(target.y - boss.y, target.x - boss.x);
            boss.x += Math.cos(angle) * zone.bossSpeed;
            boss.y += Math.sin(angle) * zone.bossSpeed;

            // Limita o boss dentro da sua zona (com um pouco de margem)
            boss.y = Math.max(zone.yStart + 30, Math.min(zone.yEnd - 30, boss.y));
            boss.x = Math.max(100, Math.min(CONFIG.MAP_WIDTH - 100, boss.x));

            const hitDist = Math.hypot(target.x - boss.x, target.y - boss.y);
            if (hitDist < CONFIG.BOSS_HIT_RADIUS) {
                // O ovo cai no chão
                dropEgg(target);

                // Teleporta o jogador de volta para a base
                const base = bases[target.id];
                if (base) {
                    target.x = base.x;
                    target.y = base.y + 50;
                }

                io.emit('playerCaught', {
                    playerId: target.id,
                    message: 'O bicho te pegou! O ovo caiu no chão!'
                });
            }
        }
    });

    io.emit('updateBosses', bosses);
}, CONFIG.TICK_RATE);

// Renda passiva dos pets
setInterval(() => {
    Object.keys(bases).forEach(id => {
        const base = bases[id];
        const player = players[id];
        if (base && player && base.pets.length > 0) {
            player.coins += calculateIncome(base);
        }
    });
    io.emit('updateCoins', players);
}, CONFIG.INCOME_INTERVAL);

// Garante que sempre tenha ovos no mapa
setInterval(() => {
    if (eggs.length < 3) {
        spawnEgg();
    }
}, 5000);

// ====================== SOCKETS ======================
io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        if (players[socket.id]) return; // já está no jogo

        const name = (data.name || '').trim().substring(0, 12);
        const { player, base } = createPlayer(socket.id, name);

        socket.emit('init', {
            id: socket.id,
            players,
            eggs,
            bases,
            bosses,
            zones: ZONES
        });

        socket.broadcast.emit('playerJoined', { player, base });
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player) return;

        player.isSlow = !!data.slow;

        let speed = 3.2 + (player.speedStat * 0.14);
        if (player.isSlow) speed *= 0.28;

        if (data.up && player.y > 40) player.y -= speed;
        if (data.down && player.y < CONFIG.MAP_HEIGHT - 40) player.y += speed;
        if (data.left && player.x > 40) player.x -= speed;
        if (data.right && player.x < CONFIG.MAP_WIDTH - 40) player.x += speed;

        // Atualiza posição do ovo carregado
        if (player.hasEgg) {
            player.hasEgg.x = player.x;
            player.hasEgg.y = player.y - 18;
        }

        io.emit('playerMoved', {
            id: socket.id,
            x: player.x,
            y: player.y,
            hasEgg: player.hasEgg,
            isSlow: player.isSlow
        });
    });

    socket.on('interact', () => {
        const player = players[socket.id];
        const base = bases[socket.id];
        if (!player || !base) return;

        // 1. Esteira de velocidade
        const treadmillX = base.x - 35;
        const distTreadmill = Math.hypot(player.x - treadmillX, player.y - base.y);
        if (distTreadmill < CONFIG.TREADMILL_RADIUS) {
            player.speedStat += 1;
            addXP(player, 18);
            io.emit('playerUpgraded', { playerId: socket.id, player });
            return;
        }

        // 2. Depositar ovo na base
        if (player.hasEgg) {
            const distBase = Math.hypot(player.x - base.x, player.y - base.y);
            if (distBase < CONFIG.DEPOSIT_RADIUS) {
                const zone = ZONES[player.hasEgg.zone];
                const hasMutation = Math.random() < 0.28;
                const mutation = hasMutation
                    ? MUTATIONS[Math.floor(Math.random() * (MUTATIONS.length - 1)) + 1]
                    : MUTATIONS[0];

                const baseValue = zone.valueMultiplier * 6;
                const finalValue = Math.round(baseValue * mutation.multiplier);

                base.pets.push({
                    emoji: PET_EMOJIS[Math.floor(Math.random() * PET_EMOJIS.length)],
                    mutation: mutation.name,
                    value: finalValue
                });

                addXP(player, 55 + (zone.valueMultiplier * 15));
                player.hasEgg = null;

                io.emit('eggHatched', {
                    playerId: socket.id,
                    bases,
                    player
                });
            }
            return;
        }

        // 3. Pegar ovo
        for (let i = eggs.length - 1; i >= 0; i--) {
            const egg = eggs[i];
            const dist = Math.hypot(player.x - egg.x, player.y - egg.y);

            if (dist < CONFIG.EGG_PICKUP_RADIUS && !player.hasEgg) {
                player.hasEgg = egg;
                eggs.splice(i, 1);
                io.emit('eggStolen', {
                    playerId: socket.id,
                    eggId: egg.id,
                    eggs
                });

                // Respawn depois de um tempo
                setTimeout(() => {
                    if (eggs.length < CONFIG.MAX_EGGS) spawnEgg();
                }, CONFIG.EGG_RESPAWN_DELAY);
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        // Se o jogador estava com ovo, ele cai no chão
        const player = players[socket.id];
        if (player && player.hasEgg) {
            dropEgg(player);
        }

        delete players[socket.id];
        delete bases[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// Spawn inicial de ovos
for (let i = 0; i < 4; i++) spawnEgg();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🥚 Servidor "Roube um Ovo" rodando na porta ${PORT}`);
});
