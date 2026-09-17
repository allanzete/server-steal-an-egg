const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname + '/public'));

// Estado do Jogo
const players = {};
const bases = {};
let eggs = [
    { id: 'egg1', x: 400, y: 250, color: 'gold', name: 'Ovo Dourado', points: 50 },
    { id: 'egg2', x: 200, y: 200, color: 'purple', name: 'Ovo Raro', points: 30 },
    { id: 'egg3', x: 600, y: 300, color: 'green', name: 'Ovo Comum', points: 10 }
];

io.on('connection', (socket) => {
    console.log(`Jogador conectado: ${socket.id}`);

    // Criação/Registro do Jogador
    socket.on('joinGame', (data) => {
        const playerName = data.name || `Player_${socket.id.substring(0, 4)}`;
        
        // Atribui uma posição inicial e uma base personalizada
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            x: 100 + Math.random() * 600,
            y: 300 + Math.random() * 200,
            color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
            hasEgg: null // Guarda o ovo se estiver segurando
        };

        bases[socket.id] = {
            ownerId: socket.id,
            ownerName: playerName,
            x: 50 + (Object.keys(bases).length * 100) % 700,
            y: 500,
            stolenEggs: []
        };

        socket.emit('init', { id: socket.id, players, eggs, bases });
        socket.broadcast.emit('playerJoined', { player: players[socket.id], base: bases[socket.id] });
    });

    // Movimentação recebida do cliente
    socket.on('move', (movement) => {
        const player = players[socket.id];
        if (!player) return;

        const speed = 4;
        if (movement.up && player.y > 150) player.y -= speed;
        if (movement.down && player.y < 580) player.y += speed;
        if (movement.left && player.x > 20) player.x -= speed;
        if (movement.right && player.x < 780) player.x += speed;

        // Se o jogador está carregando um ovo, o ovo segue ele
        if (player.hasEgg) {
            player.hasEgg.x = player.x;
            player.hasEgg.y = player.y - 10;
        }

        io.emit('playerMoved', { id: socket.id, x: player.x, y: player.y, hasEgg: player.hasEgg });
    });

    // Ação: Pegar ou Roubar Ovo
    socket.on('interact', () => {
        const player = players[socket.id];
        if (!player) return;

        // Se já está com um ovo, tenta depositar na sua base
        if (player.hasEgg) {
            const playerBase = bases[socket.id];
            const distToBase = Math.hypot(player.x - playerBase.x, player.y - playerBase.y);
            
            if (distToBase < 50) {
                playerBase.stolenEggs.push(player.hasEgg);
                player.hasEgg = null;
                io.emit('eggDeposited', { playerId: socket.id, bases });
            }
            return;
        }

        // Tenta pegar um ovo do centro do mapa
        eggs.forEach((egg, index) => {
            const dist = Math.hypot(player.x - egg.x, player.y - egg.y);
            if (dist < 30) {
                player.hasEgg = egg;
                eggs.splice(index, 1);
                io.emit('eggStolen', { playerId: socket.id, eggId: egg.id, eggs });
            }
        });

        // Tenta roubar um ovo da base de outro jogador
        Object.keys(bases).forEach(baseOwnerId => {
            if (baseOwnerId !== socket.id && !player.hasEgg) {
                const targetBase = bases[baseOwnerId];
                const distToBase = Math.hypot(player.x - targetBase.x, player.y - targetBase.y);
                
                if (distToBase < 40 && targetBase.stolenEggs.length > 0) {
                    const stolen = targetBase.stolenEggs.pop();
                    player.hasEgg = stolen;
                    io.emit('baseRobbed', { playerId: socket.id, victimId: baseOwnerId, egg: stolen, bases });
                }
            }
        });
    });

    // Desconexão
    socket.on('disconnect', () => {
        delete players[socket.id];
        delete bases[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));