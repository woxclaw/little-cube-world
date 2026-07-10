const MAX_CUBES = 1000;
const LIMIT = 42;

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value) {
  return Math.max(-LIMIT, Math.min(LIMIT, value));
}

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS cubes (
          id TEXT PRIMARY KEY,
          x REAL NOT NULL,
          y REAL NOT NULL,
          color TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS cubes_created ON cubes(created_at)");
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket request", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const avatar = {
      id,
      label: `Visitor ${id.slice(0, 4)}`,
      x: Math.round((Math.random() * 8 - 4) * 10) / 10,
      y: Math.round((Math.random() * 8 - 4) * 10) / 10,
      color: ["#ff5d73", "#25c4a4", "#ffb21e", "#6e8cff", "#d466ed"][Math.floor(Math.random() * 5)]
    };

    server.serializeAttachment(avatar);
    this.ctx.acceptWebSocket(server);

    const cubes = this.ctx.storage.sql.exec("SELECT id, x, y, color FROM cubes ORDER BY created_at ASC").toArray();
    this.send(server, { type: "welcome", avatar, people: this.people(), cubes });
    this.broadcast({ type: "avatar_join", avatar }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const avatar = socket.deserializeAttachment();
    if (!avatar) return;

    if (message.type === "move" && validNumber(message.x) && validNumber(message.y)) {
      const updated = { ...avatar, x: clamp(message.x), y: clamp(message.y) };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "avatar_update", avatar: updated });
      return;
    }

    if (message.type === "drop" && validNumber(message.x) && validNumber(message.y)) {
      const color = typeof message.color === "string" && /^#[0-9a-f]{6}$/i.test(message.color) ? message.color : "#ffb21e";
      const cube = { id: crypto.randomUUID(), x: clamp(message.x), y: clamp(message.y), color };
      this.ctx.storage.sql.exec(
        "INSERT INTO cubes (id, x, y, color, created_at) VALUES (?, ?, ?, ?, ?)",
        cube.id, cube.x, cube.y, cube.color, Date.now()
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM cubes WHERE id IN (SELECT id FROM cubes ORDER BY created_at ASC LIMIT MAX(0, (SELECT COUNT(*) FROM cubes) - ?))",
        MAX_CUBES
      );
      this.broadcast({ type: "cube_add", cube });
      return;
    }

    if (message.type === "teleport" && typeof message.targetId === "string") {
      const target = this.people().find((person) => person.id === message.targetId);
      if (!target || target.id === avatar.id) return;
      const updated = { ...avatar, x: clamp(target.x + 1.3), y: clamp(target.y) };
      socket.serializeAttachment(updated);
      this.broadcast({ type: "avatar_update", avatar: updated });
    }
  }

  webSocketClose(socket) {
    const avatar = socket.deserializeAttachment();
    if (avatar) this.broadcast({ type: "avatar_leave", id: avatar.id }, socket);
    socket.close(1000, "Connection closed");
  }

  people() {
    return this.ctx.getWebSockets()
      .map((socket) => socket.deserializeAttachment())
      .filter(Boolean);
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
