const LIMIT = 49;
const COOKIE_COUNT = 70;
const BASE_XP = 5;
const BREEDS = ["Chihuahua", "Shitzu", "Golden Retriever", "Border Collie", "Rottweiler", "Saint Bernard"];
const REQUIREMENTS = [1, 2, 4, 8, 16].map((multiplier) => BASE_XP * multiplier);
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
      const existing = ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM cookies").one().count;
      for (let index = existing; index < COOKIE_COUNT; index += 1) {
        const point = randomPoint();
        ctx.storage.sql.exec("INSERT INTO cookies (id, x, y) VALUES (?, ?, ?)", crypto.randomUUID(), point.x, point.y);
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
      xp: 0
    };

    server.serializeAttachment(dog);
    this.ctx.acceptWebSocket(server);
    const cookies = this.ctx.storage.sql.exec("SELECT id, x, y FROM cookies").toArray();
    this.send(server, { type: "welcome", dog, people: this.people(), cookies, baseXp: BASE_XP, breeds: BREEDS, requirements: REQUIREMENTS });
    this.broadcast({ type: "dog_join", dog }, server);
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
      const updated = { ...dog, x: clamp(message.x), y: clamp(message.y) };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "dog_update", dog: updated });
      return;
    }

    if (message.type === "eat" && typeof message.cookieId === "string") {
      const cookie = this.ctx.storage.sql.exec("SELECT id, x, y FROM cookies WHERE id = ?", message.cookieId).one();
      if (!cookie || Math.hypot(cookie.x - dog.x, cookie.y - dog.y) > 1.75) return;

      const point = randomPoint();
      this.ctx.storage.sql.exec("UPDATE cookies SET x = ?, y = ? WHERE id = ?", point.x, point.y, cookie.id);
      let xp = dog.xp + 1;
      let breed = dog.breed;
      let evolved = false;
      while (breed < REQUIREMENTS.length && xp >= REQUIREMENTS[breed]) {
        xp -= REQUIREMENTS[breed];
        breed += 1;
        evolved = true;
      }
      const updated = { ...dog, xp, breed };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "cookie_respawn", cookie: { id: cookie.id, ...point } });
      this.broadcast({ type: "dog_update", dog: updated, ate: true, evolved });
    }
  }

  webSocketClose(socket) {
    const dog = socket.deserializeAttachment();
    if (dog) this.broadcast({ type: "dog_leave", id: dog.id }, socket);
    socket.close(1000, "Connection closed");
  }

  people() {
    return this.ctx.getWebSockets().map((socket) => socket.deserializeAttachment()).filter(Boolean);
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
    return env.ASSETS.fetch(request);
  }
};
