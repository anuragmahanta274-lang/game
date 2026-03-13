import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Role = "one" | "two";
type Status = "waiting" | "choosing" | "playing" | "finished";

type Player = {
  id: string;
  name: string;
  secret: number | null;
};

type Room = {
  code: string;
  status: Status;
  currentTurn: Role;
  winner: Role | null;
  players: {
    one: Player;
    two: Player | null;
  };
  history: string[];
  lastMessage: string;
  updatedAt: number;
};

type PublicState = {
  code: string;
  status: Status;
  currentTurn: Role;
  winner: Role | null;
  viewerRole: Role | null;
  youName: string | null;
  opponentName: string | null;
  youSelected: boolean;
  opponentSelected: boolean;
  canGuess: boolean;
  history: string[];
  lastMessage: string;
};

type ActionResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const store = globalThis as typeof globalThis & {
  __onlineGameRooms?: Map<string, Room>;
  __onlineGameRoomsLoaded?: boolean;
};

if (!store.__onlineGameRooms) {
  store.__onlineGameRooms = new Map<string, Room>();
}

const rooms = store.__onlineGameRooms;
const roomsFile = path.join(process.cwd(), ".data", "online-rooms.json");

function ensureRoomsLoaded() {
  if (store.__onlineGameRoomsLoaded) {
    return;
  }

  try {
    if (existsSync(roomsFile)) {
      const raw = readFileSync(roomsFile, "utf8");
      const parsed = JSON.parse(raw) as Room[];
      for (const room of parsed) {
        rooms.set(room.code, room);
      }
    }
  } catch {
    rooms.clear();
  }

  store.__onlineGameRoomsLoaded = true;
}

function persistRooms() {
  const dir = path.dirname(roomsFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(roomsFile, JSON.stringify(Array.from(rooms.values())), "utf8");
}

function randomId() {
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateUniqueCode() {
  ensureRoomsLoaded();
  let code = randomCode();
  while (rooms.has(code)) {
    code = randomCode();
  }
  return code;
}

function roleFromPlayerId(room: Room, playerId: string): Role | null {
  if (room.players.one.id === playerId) {
    return "one";
  }
  if (room.players.two?.id === playerId) {
    return "two";
  }
  return null;
}

function parseValidNumber(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return null;
  }
  return value;
}

function cleanOldRooms() {
  ensureRoomsLoaded();
  const now = Date.now();
  let deleted = false;
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > 1000 * 60 * 60 * 4) {
      rooms.delete(code);
      deleted = true;
    }
  }
  if (deleted) {
    persistRooms();
  }
}

export function createRoom(name: string) {
  ensureRoomsLoaded();
  cleanOldRooms();
  const code = generateUniqueCode();
  const room: Room = {
    code,
    status: "waiting",
    currentTurn: "one",
    winner: null,
    players: {
      one: {
        id: randomId(),
        name: name.trim() || "Player 1",
        secret: null,
      },
      two: null,
    },
    history: [],
    lastMessage: "Room created. Share code with Player 2.",
    updatedAt: Date.now(),
  };
  rooms.set(code, room);
  persistRooms();
  return {
    code,
    playerId: room.players.one.id,
  };
}

export function joinRoom(codeInput: string, name: string): ActionResult<{ code: string; playerId: string }> {
  ensureRoomsLoaded();
  cleanOldRooms();
  const code = codeInput.trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return { ok: false, error: "Room not found" };
  }
  if (room.players.two) {
    return { ok: false, error: "Room already has 2 players" };
  }

  const player: Player = {
    id: randomId(),
    name: name.trim() || "Player 2",
    secret: null,
  };
  room.players.two = player;
  room.status = "choosing";
  room.lastMessage = `${player.name} joined. Both players choose a secret number.`;
  room.updatedAt = Date.now();
  persistRooms();
  return { ok: true, data: { code, playerId: player.id } };
}

export function setSecretNumber(codeInput: string, playerId: string, numberInput: number): ActionResult<null> {
  ensureRoomsLoaded();
  cleanOldRooms();
  const code = codeInput.trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return { ok: false, error: "Room not found" };
  }

  const role = roleFromPlayerId(room, playerId);
  if (!role) {
    return { ok: false, error: "Invalid player" };
  }

  const number = parseValidNumber(numberInput);
  if (number === null) {
    return { ok: false, error: "Number must be an integer from 1 to 100" };
  }

  if (role === "one") {
    room.players.one.secret = number;
  } else if (room.players.two) {
    room.players.two.secret = number;
  }

  const oneReady = room.players.one.secret !== null;
  const twoReady = room.players.two?.secret !== null;
  if (oneReady && twoReady) {
    room.status = "playing";
    room.currentTurn = "one";
    room.lastMessage = "Both players selected numbers. Player 1 guesses first.";
    room.history.push("Both players selected secret numbers.");
  } else {
    room.status = "choosing";
    room.lastMessage = "Waiting for both players to choose secret numbers.";
  }
  room.updatedAt = Date.now();
  persistRooms();
  return { ok: true, data: null };
}

export function submitGuess(codeInput: string, playerId: string, guessInput: number): ActionResult<null> {
  ensureRoomsLoaded();
  cleanOldRooms();
  const code = codeInput.trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return { ok: false, error: "Room not found" };
  }
  if (room.status !== "playing") {
    return { ok: false, error: "Game is not ready for guesses" };
  }
  const role = roleFromPlayerId(room, playerId);
  if (!role) {
    return { ok: false, error: "Invalid player" };
  }
  if (room.currentTurn !== role) {
    return { ok: false, error: "Not your turn" };
  }

  const guess = parseValidNumber(guessInput);
  if (guess === null) {
    return { ok: false, error: "Guess must be an integer from 1 to 100" };
  }

  const target =
    role === "one"
      ? room.players.two?.secret ?? null
      : room.players.one.secret;
  if (target === null) {
    return { ok: false, error: "Opponent is not ready yet" };
  }

  const playerName = role === "one" ? room.players.one.name : room.players.two?.name ?? "Player 2";
  if (guess === target) {
    room.status = "finished";
    room.winner = role;
    room.lastMessage = `${playerName} guessed ${guess} and won.`;
    room.history.push(`${playerName} guessed ${guess} and won.`);
    room.updatedAt = Date.now();
    persistRooms();
    return { ok: true, data: null };
  }

  const hint = guess < target ? "Higher" : "Lower";
  room.history.push(`${playerName} guessed ${guess} -> ${hint}`);
  room.lastMessage = `${playerName} guessed ${guess}. Hint: ${hint}.`;
  room.currentTurn = role === "one" ? "two" : "one";
  room.updatedAt = Date.now();
  persistRooms();
  return { ok: true, data: null };
}

export function getPublicState(codeInput: string, playerId: string): ActionResult<PublicState> {
  ensureRoomsLoaded();
  cleanOldRooms();
  const code = codeInput.trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return { ok: false, error: "Room not found" };
  }

  const role = roleFromPlayerId(room, playerId);
  const you = role === "one" ? room.players.one : role === "two" ? room.players.two : null;
  const opponent = role === "one" ? room.players.two : role === "two" ? room.players.one : null;

  return {
    ok: true,
    data: {
      code: room.code,
      status: room.status,
      currentTurn: room.currentTurn,
      winner: room.winner,
      viewerRole: role,
      youName: you?.name ?? null,
      opponentName: opponent?.name ?? null,
      youSelected: you?.secret !== null,
      opponentSelected: opponent?.secret !== null,
      canGuess: room.status === "playing" && role === room.currentTurn && room.winner === null,
      history: room.history.slice(-20),
      lastMessage: room.lastMessage,
    },
  };
}
