const API_ORIGIN = "https://little-cube-world-api.woxclaw.workers.dev";
const COLORS = ["#ff5d73", "#25c4a4", "#ffb21e", "#6e8cff", "#d466ed"];
const canvas = document.querySelector("#world");
const ctx = canvas.getContext("2d");
const peopleEl = document.querySelector("#people");
const connectionEl = document.querySelector("#connection");
const meEl = document.querySelector("#me");
const positionEl = document.querySelector("#position");
const palette = document.querySelector("#palette");
const dropCubeButton = document.querySelector("#drop-cube");
let me = null, people = new Map(), cubes = [], selected = COLORS[2], socket, lastMove = 0;

for (const color of COLORS) {
  const button = document.createElement("button"); button.className = "swatch"; button.style.background = color; button.title = `Use ${color}`;
  button.onclick = () => { selected = color; document.querySelectorAll(".swatch").forEach((item) => item.classList.toggle("selected", item === button)); };
  palette.append(button); if (color === selected) button.classList.add("selected");
}

function connect() {
  const origin = API_ORIGIN === "__API_ORIGIN__" ? location.origin : API_ORIGIN;
  socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws");
  socket.onopen = () => { connectionEl.textContent = "Live world"; connectionEl.classList.add("live"); };
  socket.onclose = () => { connectionEl.textContent = "Reconnecting"; connectionEl.classList.remove("live"); setTimeout(connect, 1200); };
  socket.onmessage = ({ data }) => handle(JSON.parse(data));
}
function handle(message) {
  if (message.type === "welcome") { me = message.avatar; people = new Map(message.people.map((p) => [p.id, p])); cubes = message.cubes; }
  if (message.type === "avatar_join" || message.type === "avatar_update") { people.set(message.avatar.id, message.avatar); if (me?.id === message.avatar.id) me = message.avatar; }
  if (message.type === "avatar_leave") people.delete(message.id);
  if (message.type === "cube_add") cubes.push(message.cube);
  renderPeople();
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function renderPeople() {
  if (!me) return; meEl.textContent = `${me.label} (${me.id.slice(0, 8)})`; positionEl.textContent = `Position: ${me.x.toFixed(1)}, ${me.y.toFixed(1)}`;
  const others = [...people.values()].filter((p) => p.id !== me.id);
  peopleEl.replaceChildren();
  if (!others.length) { peopleEl.innerHTML = '<p class="empty">Waiting for others to arrive.</p>'; return; }
  for (const person of others) { const row = document.createElement("div"); row.className = "person"; row.innerHTML = `<i class="person-dot" style="background:${person.color}"></i><span class="person-name">${person.label}</span><button class="teleport" title="Teleport close to ${person.label}" aria-label="Teleport close to ${person.label}">↗</button>`; row.querySelector("button").onclick = () => send({ type: "teleport", targetId: person.id }); peopleEl.append(row); }
}
function point(event) { const rect = canvas.getBoundingClientRect(); return { x: ((event.clientX - rect.left) / rect.width - .5) * 24, y: ((event.clientY - rect.top) / rect.height - .5) * 24 }; }
function dropCube(x = me?.x, y = me?.y) { if (me && Number.isFinite(x) && Number.isFinite(y)) send({ type: "drop", x, y, color: selected }); }
function move(direction) {
  if (!me) return;
  const step = .8;
  const x = me.x + (direction === "right" ? step : direction === "left" ? -step : 0);
  const y = me.y + (direction === "down" ? step : direction === "up" ? -step : 0);
  const now = Date.now();
  if (now - lastMove > 45) { lastMove = now; send({ type: "move", x, y }); }
}
canvas.onclick = (event) => { const p = point(event); dropCube(p.x, p.y); };
dropCubeButton.addEventListener("click", () => dropCube());
document.querySelectorAll(".move-button").forEach((button) => button.addEventListener("click", () => move(button.dataset.direction)));
window.addEventListener("keydown", (event) => {
  const directions = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", a: "left", s: "down", d: "right" };
  const direction = directions[event.key] || directions[event.key.toLowerCase()];
  if (!direction) return;
  event.preventDefault();
  move(direction);
});
function resize() { const ratio = devicePixelRatio || 1; const rect = canvas.getBoundingClientRect(); canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); }
function draw() { resize(); const w = canvas.clientWidth, h = canvas.clientHeight, scale = Math.min(w, h) / 24; ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#16242b"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "#274149"; ctx.lineWidth = 1; for (let i = 0; i <= 24; i++) { const v = i * scale; ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, h); ctx.moveTo(0, v); ctx.lineTo(w, v); ctx.stroke(); } const toCanvas = (p) => ({ x: w / 2 + p.x * scale, y: h / 2 + p.y * scale }); for (const cube of cubes) { const p = toCanvas(cube); ctx.fillStyle = cube.color; ctx.fillRect(p.x - scale * .31, p.y - scale * .31, scale * .62, scale * .62); ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.strokeRect(p.x - scale * .31, p.y - scale * .31, scale * .62, scale * .62); } for (const person of people.values()) { const p = toCanvas(person); ctx.fillStyle = person.color; ctx.beginPath(); ctx.arc(p.x, p.y, scale * .37, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#eff7f5"; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText(person.id === me?.id ? "You" : person.label, p.x, p.y - scale * .58); } requestAnimationFrame(draw); }
connect(); requestAnimationFrame(draw);
