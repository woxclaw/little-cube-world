const LIMIT = 49;
const COOKIE_COUNT = 70;
const TOY_COUNT = Math.ceil(COOKIE_COUNT / 8);
const NPCS_PER_BREED = 2;
const BONE_XP = 1;
const TOY_XP = 2;
const GOLDEN_TOY_XP = TOY_XP * 2;
const GOLDEN_TOY_COUNT = 4;
const CHAT_MAX_LENGTH = 180;
const CHAT_COOLDOWN_MS = 650;
const BREEDS = ["Chihuahua", "Shih Tzu", "Golden Retriever", "Border Collie", "Rottweiler", "Saint Bernard"];
const NPC_BREEDS = ["Chow Chow", "Beagle", "Husky"];
const REQUIREMENTS = [5, 10, 20, 40, 80];
const COLORS = ["#f09c74", "#e5bd66", "#7b513c", "#3c2b27", "#f1f0e8"];

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value) {
  return Math.max(-LIMIT, Math.min(LIMIT, value));
}

function randomPoint() {
  return {
    x: Math.round((Math.random() * LIMIT * 2 - LIMIT) * 10) / 10,
    y: Math.round((Math.random() * LIMIT * 2 - LIMIT) * 10) / 10
  };
}

function makeNpc(breed, number) {
  const point = randomPoint();
  return {
    id: crypto.randomUUID(),
    label: `${breed} friend ${number + 1}`,
    breed,
    x: point.x,
    y: point.y,
    heading: Math.random() * Math.PI * 2,
    color: breed === "Chow Chow" ? "#bb794b" : breed === "Beagle" ? "#c6773d" : "#dbe8f0"
  };
}

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS cookies (
          id TEXT PRIMARY KEY,
          x REAL NOT NULL,
          y REAL NOT NULL
        )
      `);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS toys (
          id TEXT PRIMARY KEY,
          x REAL NOT NULL,
          y REAL NOT NULL,
          golden INTEGER NOT NULL DEFAULT 0
        )
      `);
      const toyColumns = ctx.storage.sql.exec("PRAGMA table_info(toys)").toArray();
      if (!toyColumns.some((column) => column.name === "golden")) {
        ctx.storage.sql.exec("ALTER TABLE toys ADD COLUMN golden INTEGER NOT NULL DEFAULT 0");
      }
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS npcs (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          breed TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          heading REAL NOT NULL,
          color TEXT NOT NULL
        )
      `);
      const existing = ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM cookies").one().count;
      for (let index = existing; index < COOKIE_COUNT; index += 1) {
        const point = randomPoint();
        ctx.storage.sql.exec("INSERT INTO cookies (id, x, y) VALUES (?, ?, ?)", crypto.randomUUID(), point.x, point.y);
      }
      const toys = ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM toys").one().count;
      for (let index = toys; index < TOY_COUNT; index += 1) {
        const point = randomPoint();
        ctx.storage.sql.exec("INSERT INTO toys (id, x, y, golden) VALUES (?, ?, ?, 0)", crypto.randomUUID(), point.x, point.y);
      }
      const goldenToys = ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM toys WHERE golden = 1").one().count;
      for (let index = goldenToys; index < GOLDEN_TOY_COUNT; index += 1) {
        const point = randomPoint();
        ctx.storage.sql.exec("INSERT INTO toys (id, x, y, golden) VALUES (?, ?, ?, 1)", crypto.randomUUID(), point.x, point.y);
      }
      const npcCount = ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM npcs").one().count;
      for (let index = npcCount; index < NPC_BREEDS.length * NPCS_PER_BREED; index += 1) {
        const breed = NPC_BREEDS[index % NPC_BREEDS.length];
        const npc = makeNpc(breed, Math.floor(index / NPC_BREEDS.length));
        ctx.storage.sql.exec("INSERT INTO npcs (id, label, breed, x, y, heading, color) VALUES (?, ?, ?, ?, ?, ?, ?)", npc.id, npc.label, npc.breed, npc.x, npc.y, npc.heading, npc.color);
      }
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket request", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const point = randomPoint();
    const dog = {
      id,
      label: `Pup ${id.slice(0, 4)}`,
      x: point.x,
      y: point.y,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      breed: 0,
      xp: 0,
      heading: 0
    };

    server.serializeAttachment(dog);
    this.ctx.acceptWebSocket(server);
    const cookies = this.ctx.storage.sql.exec("SELECT id, x, y FROM cookies").toArray();
    const toys = this.ctx.storage.sql.exec("SELECT id, x, y, golden FROM toys").toArray();
    const npcs = this.npcs();
    await this.ctx.storage.setAlarm(Date.now() + 1200);
    this.send(server, { type: "welcome", dog, people: this.people(), cookies, toys, npcs, boneXp: BONE_XP, toyXp: TOY_XP, goldenToyXp: GOLDEN_TOY_XP, breeds: BREEDS, requirements: REQUIREMENTS, leaderboard: this.leaderboard() });
    this.broadcast({ type: "dog_join", dog }, server);
    this.broadcast({ type: "leaderboard", leaderboard: this.leaderboard() });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const dog = socket.deserializeAttachment();
    if (!dog) return;

    if (message.type === "move" && validNumber(message.x) && validNumber(message.y)) {
      const x = clamp(message.x);
      const y = clamp(message.y);
      const moved = x !== dog.x || y !== dog.y;
      const heading = moved ? Math.atan2(y - dog.y, x - dog.x) : dog.heading;
      const updated = { ...dog, x, y, heading };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "dog_update", dog: updated });
      return;
    }

    if (message.type === "jump") {
      const updated = { ...dog, jumpUntil: Date.now() + 520 };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "dog_update", dog: updated, jumped: true });
      return;
    }

    if (message.type === "chat" && typeof message.text === "string") {
      const text = message.text.trim().replace(/\s+/g, " ").slice(0, CHAT_MAX_LENGTH);
      const now = Date.now();
      if (!text || now - (dog.lastChatAt || 0) < CHAT_COOLDOWN_MS) return;
      socket.serializeAttachment({ ...dog, lastChatAt: now });
      this.broadcast({ type: "chat", id: crypto.randomUUID(), from: dog.id, label: dog.label, text, at: now });
      return;
    }

    if (message.type === "eat" && typeof message.itemId === "string" && (message.itemType === "cookie" || message.itemType === "toy")) {
      const table = message.itemType === "toy" ? "toys" : "cookies";
      const item = this.ctx.storage.sql.exec(`SELECT id, x, y${message.itemType === "toy" ? ", golden" : ""} FROM ${table} WHERE id = ?`, message.itemId).one();
      if (!item || Math.hypot(item.x - dog.x, item.y - dog.y) > 1.75) return;

      const point = randomPoint();
      this.ctx.storage.sql.exec(`UPDATE ${table} SET x = ?, y = ? WHERE id = ?`, point.x, point.y, item.id);
      const earnedXp = message.itemType === "toy" ? (item.golden ? GOLDEN_TOY_XP : TOY_XP) : BONE_XP;
      let xp = dog.xp + earnedXp;
      let breed = dog.breed;
      let evolved = false;
      while (breed < REQUIREMENTS.length && xp >= REQUIREMENTS[breed]) {
        xp -= REQUIREMENTS[breed];
        breed += 1;
        evolved = true;
      }
      const updated = { ...dog, xp, breed };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "item_respawn", itemType: message.itemType, item: { id: item.id, ...point, golden: Boolean(item.golden) } });
      this.broadcast({ type: "dog_update", dog: updated, ate: true, itemType: message.itemType, earnedXp, evolved, golden: Boolean(item.golden) });
      this.broadcast({ type: "leaderboard", leaderboard: this.leaderboard() });
    }
  }

  webSocketClose(socket) {
    const dog = socket.deserializeAttachment();
    if (dog) this.broadcast({ type: "dog_leave", id: dog.id }, socket);
    this.broadcast({ type: "leaderboard", leaderboard: this.leaderboard() });
    socket.close(1000, "Connection closed");
  }

  async alarm() {
    if (!this.ctx.getWebSockets().length) return;
    const npcs = this.npcs().map((npc) => {
      const heading = npc.heading + (Math.random() - .5) * .9;
      const x = clamp(npc.x + Math.cos(heading) * (.35 + Math.random() * .25));
      const y = clamp(npc.y + Math.sin(heading) * (.35 + Math.random() * .25));
      const updated = { ...npc, x, y, heading };
      this.ctx.storage.sql.exec("UPDATE npcs SET x = ?, y = ?, heading = ? WHERE id = ?", x, y, heading, npc.id);
      return updated;
    });
    this.broadcast({ type: "npc_update", npcs });
    await this.ctx.storage.setAlarm(Date.now() + 1200);
  }

  people() {
    return this.ctx.getWebSockets().map((socket) => socket.deserializeAttachment()).filter(Boolean);
  }

  npcs() {
    return this.ctx.storage.sql.exec("SELECT id, label, breed, x, y, heading, color FROM npcs").toArray();
  }

  leaderboard() {
    return this.people()
      .sort((a, b) => b.breed - a.breed || b.xp - a.xp || a.label.localeCompare(b.label))
      .map((dog, index) => ({ rank: index + 1, id: dog.id, label: dog.label, breed: dog.breed, xp: dog.xp, color: dog.color }));
  }

  send(socket, message) {
    try { socket.send(JSON.stringify(message)); } catch {}
  }

  broadcast(message, except) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) this.send(socket, message);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") return env.WORLD.getByName("public-world").fetch(request);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, max-age=0");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
