// server.js
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Serve static files (our game) from /public
app.use(express.static(path.join(__dirname, "public")));

const ROWS = 6, COLS = 7;
const newBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const games = new Map();
/*
  games.get(roomId) = {
    board: number[6][7],
    turn: 1|2,
    players: { p1: socketId|null, p2: socketId|null },
    status: "waiting"|"playing"|"finished",
    winner?: 0|1|2
  }
*/

function nextOpenRow(board, col){
  for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === 0) return r;
  return -1;
}
function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }
function checkWin(board, piece){
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c] !== piece) continue;
      for (const [dr,dc] of dirs){
        let k = 1;
        while (k<4 && inBounds(r+dr*k, c+dc*k) && board[r+dr*k][c+dc*k]===piece) k++;
        if (k===4) return true;
      }
    }
  }
  return false;
}
function isFull(board){ return board.every(row => row.every(v => v!==0)); }

io.on("connection", (socket) => {
  socket.on("join", ({ room }) => {
    if (!room) return;

    if (!games.has(room)) {
      games.set(room, {
        board: newBoard(),
        turn: 1,
        players: { p1: null, p2: null },
        status: "waiting",
      });
    }
    const game = games.get(room);

    let me;
    if (!game.players.p1) { game.players.p1 = socket.id; me = 1; }
    else if (!game.players.p2) { game.players.p2 = socket.id; me = 2; }
    else { socket.emit("error_msg", "Room is full"); return; }

    socket.join(room);
    if (game.players.p1 && game.players.p2) game.status = "playing";

    socket.emit("joined", { room, me });
    io.to(room).emit("state", game);
  });

  socket.on("move", ({ room, col }) => {
    const game = games.get(room);
    if (!game || game.status === "finished") return;

    const me = (socket.id === game.players.p1) ? 1 :
               (socket.id === game.players.p2) ? 2 : null;
    if (!me) return;

    if (game.turn !== me) { socket.emit("error_msg", "Not your turn"); return; }

    const row = nextOpenRow(game.board, col);
    if (row === -1) { socket.emit("error_msg", "Column is full"); return; }

    game.board[row][col] = me;

    if (checkWin(game.board, me)) {
      game.status = "finished";
      game.winner = me;
    } else if (isFull(game.board)) {
      game.status = "finished";
      game.winner = 0; // draw
    } else {
      game.turn = 3 - game.turn;
    }

    io.to(room).emit("state", game);
  });

  socket.on("restart", ({ room }) => {
    const game = games.get(room);
    if (!game) return;
    game.board = newBoard();
    game.turn = 1;
    game.status = (game.players.p1 && game.players.p2) ? "playing" : "waiting";
    delete game.winner;
    io.to(room).emit("state", game);
  });

  socket.on("disconnect", () => {
    for (const [room, game] of games) {
      if (game.players.p1 === socket.id) game.players.p1 = null;
      if (game.players.p2 === socket.id) game.players.p2 = null;
      if (!game.players.p1 && !game.players.p2) games.delete(room);
      else {
        game.status = "waiting";
        io.to(room).emit("state", game);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});