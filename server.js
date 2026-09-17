const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000
});

// ====================== CONFIGURAÇÕES ======================
const CONFIG = {
    TICK_RATE: 1000 / 30,
    INCOME_INTERVAL: 2000,
    MAP_WIDTH: 2000,
    MAP_HEIGHT: 3200,          // Mapa bem maior agora
    SAFE_ZONE_Y: 350,
    BASE_Y: 180,
    BASE_SPACING: 240,
    EGG_PICKUP_RADIUS: 38,
    BOSS_HIT_RADIUS: 32,
    TREADMILL_RADIUS: 45,
    DEPOSIT_RADIUS: 55,
    MAX_EGGS: 9,
    EGG_RESPAWN_DELAY: 3200
};

const ZONES = {
    1: {
        name: 'Floresta Fácil',
        color: '#1b5e20',
        yStart: 400,
        yEnd: 800,
        eggColor: '#4caf50',
        bossSpeed: 2.3,
        rarity: 'Comum',
        valueMultiplier: 1
    },
    2: {
        name: 'Deserto Médio',
        color: '#e65100',
        yStart: 800,
        yEnd: 1200,
        eggColor: '#ff9800',
        bossSpeed: 3.1,
        rarity: 'Raro',
        valueMultiplier: 2
    },
    3: {
        name: 'Vulcão Difícil',
        color: '#b71c1c',
        yStart: 1200,
        yEnd: 1650,
        eggColor: '#f44336',
        bossSpeed: 4.2,
        rarity: 'Épico',
        valueMultiplier: 3.5
    },
    4: {
        name: 'Tundra Congelada',
        color: '#0277bd',
        yStart: 1650,
        yEnd: 2150,
        eggColor: '#4fc3f7',
        bossSpeed: 5.0,
        rarity: 'Lendário',
        valueMultiplier: 5.5
    },
    5: {
        name: 'Ruínas Abissais',
        color: '#4a148c',
        yStart: 2150,
        yEnd: 2650,
        eggColor: '#ce93d8',
        bossSpeed: 5.8,
        rarity: 'Mítico',
        valueMultiplier: 8
    },
    6: {
        name: 'Portal do Caos',
        color: '#880e4f',
        yStart: 2650,
        yEnd: 3200,
        eggColor: '#f48fb1',
        bossSpeed: 6.8,
        rarity: 'Divino',
        valueMultiplier: 12
    }
};

const PET_EMOJIS = ['🐶','🐱','🦊','🐼','🐨','🦄','🤖','👾','🐲','🦁','🐯','🐸','🐙','🦋','🦅','🐺'];
const MUTATIONS = [
    { name: 'Nenhuma', multiplier: 1 },
    { name: 'Dourado ✨', multiplier: 2.2 },
    { name: 'Gigante 🐘', multiplier: 1.8 },
    { name: 'Radioativo ☢️', multiplier: 2.8 },
    { name: 'Cósmico 🌌', multiplier: 3.5 },
    { name: 'Sombrio 🌑', multiplier: 4.2 },
    { name: 'Divino 👑', multiplier: 6 }
];

// ====================== ESTADO ======================
const players = {};
const bases = {};
let eggs = [];
let nextEggId = 1;

const bosses = {
    1: { id: 1, x: 1000, y: 600,  visionRadius: 185, targetId: null, emoji: '🐊' },
    2: { id: 2, x: 1000, y: 1000, visionRadius: 215, targetId: null, emoji: '🦁' },
    3: { id: 3, x: 1000, y: 1425, visionRadius: 245, targetId: null, emoji: '🐉' },
    4: { id: 4, x: 1000, y: 1900, visionRadius: 270, targetId: null, emoji: '🐻‍❄️' },
    5: { id: 5, x: 1000, y: 2400, visionRadius: 295, targetId: null, emoji: '🐙' },
    6: { id: 6, x: 1000, y: 2920, visionRadius: 320, targetId: null, emoji: '👾' }
};

// ====================== FUNÇÕES ======================
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

    // Chance maior de spawnar nas zonas mais fáceis no começo
    let zoneId;
    if (forceZone) {
        zoneId = forceZone;
    } else {
        const roll = Math.random();
        if (roll < 0.28) zoneId = 1;
        else if (roll < 0.50) zoneId = 2;
        else if (roll < 0.68) zoneId = 3;
        else if (roll < 0.82) zoneId = 4;
        else if (roll < 0.93) zoneId = 5;
        else zoneId = 6;
    }

    const zone = ZONES[zoneId];

    eggs.push({
        id: `e${nextEggId++}`,
        zone: zoneId,
        x: 550 + Math.random() * 950,
        y: zone.yStart + 70 + Math.random() * (zone.yEnd - zone.yStart - 140),
        color: zone.eggColor,
        name: `Ovo ${zone.rarity}`
    });

    io.emit('updateEggs', eggs);
}

function dropEgg(player) {
    if (!player.hasEgg) return;

    eggs.push({
        ...player.hasEgg,
        x: player.x + (Math.random() * 50 - 25),
        y: player.y + (Math.random() * 50 - 25)
    });

    player.hasEgg = null;
    io.emit('updateEggs', eggs);
}

function addXP(player, amount) {
    player.xp += amount;
    while (player.xp >= player.level * 100) {
        player.xp -= player.level * 100;
        player.level += 1;
    }
}

// ====================== LOOPS ======================
setInterval(() => {
    Object.keys(bosses).forEach(zoneId => {
        const boss = bosses[zoneId];
        const zone = ZONES[zoneId];
        let target = null;
        let closestDist = Infinity;

        Object.values(players).forEach(p => {
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

            // Mantém o boss dentro da sua zona
            boss.y = Math.max(zone.yStart + 40, Math.min(zone.yEnd - 40, boss.y));
            boss.x = Math.max(120, Math.min(CONFIG.MAP_WIDTH - 120, boss.x));

            if (Math.hypot(target.x - boss.x, target.y - boss.y) < CONFIG.BOSS_HIT_RADIUS) {
                dropEgg(target);
                const base = bases[target.id];
                if (base) {
                    target.x = base.x;
                    target.y = base.y + 50;
                }
                io.emit('playerCaught', {
                    playerId: target.id,
                    message: `O ${boss.emoji} te pegou! O ovo caiu no chão!`
                });
            }
        }
    });

    io.emit('updateBosses', bosses);
}, CONFIG.TICK_RATE);

setInterval(() => {
    Object.keys(bases).forEach(id => {
        const base = bases[id];
        const player = players[id];
        if (base && player && base.pets.length > 0) {
            player.coins += base.pets.reduce((sum, pet) => sum + pet.value, 0);
        }
    });
    io.emit('updateCoins', players);
}, CONFIG.INCOME_INTERVAL);

setInterval(() => {
    if (eggs.length < 4) spawnEgg();
}, 4500);

// ====================== SOCKETS ======================
io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        if (players[socket.id]) return;

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

        let speed = 3.15 + (player.speedStat * 0.135);
        if (player.isSlow) speed *= 0.27;

        if (data.up && player.y > 40) player.y -= speed;
        if (data.down && player.y < CONFIG.MAP_HEIGHT - 40) player.y += speed;
        if (data.left && player.x > 40) player.x -= speed;
        if (data.right && player.x < CONFIG.MAP_WIDTH - 40) player.x += speed;

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

        // Esteira
        const treadmillX = base.x - 35;
        if (Math.hypot(player.x - treadmillX, player.y - base.y) < CONFIG.TREADMILL_RADIUS) {
            player.speedStat += 1;
            addXP(player, 18);
            io.emit('playerUpgraded', { playerId: socket.id, player });
            return;
        }

        // Depositar ovo
        if (player.hasEgg) {
            if (Math.hypot(player.x - base.x, player.y - base.y) < CONFIG.DEPOSIT_RADIUS) {
                const zone = ZONES[player.hasEgg.zone];
                const hasMutation = Math.random() < 0.26;
                const mutation = hasMutation
                    ? MUTATIONS[Math.floor(Math.random() * (MUTATIONS.length - 1)) + 1]
                    : MUTATIONS[0];

                const finalValue = Math.round(zone.valueMultiplier * 7 * mutation.multiplier);

                base.pets.push({
                    emoji: PET_EMOJIS[Math.floor(Math.random() * PET_EMOJIS.length)],
                    mutation: mutation.name,
                    value: finalValue
                });

                addXP(player, 50 + (zone.valueMultiplier * 18));
                player.hasEgg = null;

                io.emit('eggHatched', {
                    playerId: socket.id,
                    bases,
                    player
                });
            }
            return;
        }

        // Pegar ovo
        for (let i = eggs.length - 1; i >= 0; i--) {
            const egg = eggs[i];
            if (Math.hypot(player.x - egg.x, player.y - egg.y) < CONFIG.EGG_PICKUP_RADIUS && !player.hasEgg) {
                player.hasEgg = egg;
                eggs.splice(i, 1);
                io.emit('eggStolen', {
                    playerId: socket.id,
                    eggId: egg.id,
                    eggs
                });

                setTimeout(() => {
                    if (eggs.length < CONFIG.MAX_EGGS) spawnEgg();
                }, CONFIG.EGG_RESPAWN_DELAY);
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        const player = players[socket.id];
        if (player && player.hasEgg) dropEgg(player);

        delete players[socket.id];
        delete bases[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// Spawn inicial (mais ovos por causa do mapa maior)
for (let i = 0; i < 6; i++) spawnEgg();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🥚 Servidor "Roube um Ovo" rodando na porta ${PORT} (6 zonas)`);
});
