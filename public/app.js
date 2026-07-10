import * as THREE from "https://unpkg.com/three@0.176.0/build/three.module.js";

const API_ORIGIN = "https://little-cube-world-api.woxclaw.workers.dev";
const COLORS = ["#ff5d73", "#25c4a4", "#ffb21e", "#6e8cff", "#d466ed"];
const WORLD_SIZE = 100;
const WORLD_HALF = WORLD_SIZE / 2;
const MOVE_STEP = 0.14;

const canvas = document.querySelector("#world");
const peopleEl = document.querySelector("#people");
const connectionEl = document.querySelector("#connection");
const meEl = document.querySelector("#me");
const positionEl = document.querySelector("#position");
const palette = document.querySelector("#palette");
const dropCubeButton = document.querySelector("#drop-cube");

let me = null;
let people = new Map();
let cubes = [];
let selected = COLORS[2];
let socket;
let lastMove = 0;
let reconnectTimer;
let pointerDown = null;
const heldDirections = new Set();
const avatarMeshes = new Map();
const cubeMeshes = new Map();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#86c6ed");
scene.fog = new THREE.Fog("#86c6ed", 32, 105);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 250);
camera.position.set(14, 16, 18);
const cameraTarget = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

scene.add(new THREE.HemisphereLight("#dff5ff", "#34402c", 2.2));
const sun = new THREE.DirectionalLight("#fff3ce", 2.6);
sun.position.set(-24, 36, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
scene.add(sun);

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const terrainGeometry = new THREE.BoxGeometry(1, 1, 1);
const terrain = new THREE.InstancedMesh(terrainGeometry, terrainMaterial, WORLD_SIZE * WORLD_SIZE);
terrain.castShadow = false;
terrain.receiveShadow = true;
terrainGroup.add(terrain);
const matrix = new THREE.Matrix4();
const terrainColor = new THREE.Color();

function terrainHeight(x, z) {
  const rolling = Math.sin(x * 0.15) * 1.25 + Math.cos(z * 0.13) * 1.1;
  const detail = Math.sin((x + z) * 0.33) * 0.35;
  return Math.max(1, Math.round(3 + rolling + detail));
}

function buildTerrain() {
  let index = 0;
  for (let z = -WORLD_HALF; z < WORLD_HALF; z += 1) {
    for (let x = -WORLD_HALF; x < WORLD_HALF; x += 1) {
      const height = terrainHeight(x, z);
      matrix.makeScale(0.98, height, 0.98);
      matrix.setPosition(x + 0.5, height / 2 - 1, z + 0.5);
      terrain.setMatrixAt(index, matrix);
      terrainColor.setHSL(0.27 + ((x + z) % 5) * 0.006, 0.39, 0.27 + height * 0.018);
      terrain.setColorAt(index, terrainColor);
      index += 1;
    }
  }
  terrain.instanceMatrix.needsUpdate = true;
  terrain.instanceColor.needsUpdate = true;
}

const grid = new THREE.GridHelper(WORLD_SIZE, WORLD_SIZE, "#6a9b52", "#6a9b52");
grid.position.y = -1.48;
grid.material.opacity = 0.13;
grid.material.transparent = true;
scene.add(grid);
buildTerrain();

function makeAvatar(person) {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: "#ffd0ad" });
  const shirt = new THREE.MeshLambertMaterial({ color: person.color });
  const trousers = new THREE.MeshLambertMaterial({ color: "#263448" });
  const dark = new THREE.MeshLambertMaterial({ color: "#2b1b18" });
  const addPart = (size, position, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addPart([0.72, 0.76, 0.38], [0, 1.36, 0], shirt);
  addPart([0.62, 0.62, 0.62], [0, 2.05, 0], skin);
  addPart([0.66, 0.18, 0.66], [0, 2.42, 0], dark);
  addPart([0.22, 0.72, 0.25], [-0.25, 0.61, 0], trousers);
  addPart([0.22, 0.72, 0.25], [0.25, 0.61, 0], trousers);
  addPart([0.2, 0.68, 0.24], [-0.48, 1.35, 0], shirt);
  addPart([0.2, 0.68, 0.24], [0.48, 1.35, 0], shirt);
  const label = makeLabel(person.id === me?.id ? "You" : person.label, person.color);
  label.position.y = 2.85;
  group.add(label);
  scene.add(group);
  return group;
}

function makeLabel(text, color) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const context = labelCanvas.getContext("2d");
  context.font = "bold 27px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillStyle = "rgba(10, 25, 30, .76)";
  context.fillRect(0, 9, 256, 46);
  context.fillStyle = color === "#ffb21e" ? "#fff6d7" : "#ffffff";
  context.fillText(text, 128, 42);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), transparent: true, depthTest: false }));
  sprite.scale.set(2.5, 0.625, 1);
  return sprite;
}

function syncAvatar(person) {
  let avatar = avatarMeshes.get(person.id);
  if (!avatar) {
    avatar = makeAvatar(person);
    avatarMeshes.set(person.id, avatar);
  }
  const ground = terrainHeight(Math.floor(person.x), Math.floor(person.y));
  avatar.position.set(person.x, ground, person.y);
}

function syncCube(cube) {
  if (cubeMeshes.has(cube.id)) return;
  const material = new THREE.MeshLambertMaterial({ color: cube.color });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.84, 0.84), material);
  mesh.position.set(cube.x, terrainHeight(Math.floor(cube.x), Math.floor(cube.y)) + 0.42, cube.y);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  cubeMeshes.set(cube.id, mesh);
}

for (const color of COLORS) {
  const button = document.createElement("button");
  button.className = "swatch";
  button.style.background = color;
  button.title = `Use ${color}`;
  button.onclick = () => {
    selected = color;
    document.querySelectorAll(".swatch").forEach((item) => item.classList.toggle("selected", item === button));
  };
  palette.append(button);
  if (color === selected) button.classList.add("selected");
}

function connect() {
  clearTimeout(reconnectTimer);
  const origin = API_ORIGIN === "__API_ORIGIN__" ? location.origin : API_ORIGIN;
  socket = new WebSocket(`${origin.replace(/^http/, "ws")}/ws`);
  socket.onopen = () => {
    connectionEl.textContent = "Live world";
    connectionEl.classList.add("live");
  };
  socket.onclose = () => {
    connectionEl.textContent = "Reconnecting";
    connectionEl.classList.remove("live");
    reconnectTimer = setTimeout(connect, 1200);
  };
  socket.onmessage = ({ data }) => handle(JSON.parse(data));
}

function handle(message) {
  if (message.type === "welcome") {
    me = message.avatar;
    people = new Map(message.people.map((person) => [person.id, person]));
    cubes = message.cubes;
    cubes.forEach(syncCube);
  }
  if (message.type === "avatar_join" || message.type === "avatar_update") {
    people.set(message.avatar.id, message.avatar);
    if (me?.id === message.avatar.id) me = message.avatar;
  }
  if (message.type === "avatar_leave") {
    people.delete(message.id);
    const avatar = avatarMeshes.get(message.id);
    if (avatar) scene.remove(avatar);
    avatarMeshes.delete(message.id);
  }
  if (message.type === "cube_add") {
    cubes.push(message.cube);
    syncCube(message.cube);
  }
  for (const person of people.values()) syncAvatar(person);
  renderPeople();
}

function send(data) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

function renderPeople() {
  if (!me) return;
  meEl.textContent = `${me.label} (${me.id.slice(0, 8)})`;
  positionEl.textContent = `Position: ${me.x.toFixed(1)}, ${me.y.toFixed(1)}`;
  const others = [...people.values()].filter((person) => person.id !== me.id);
  peopleEl.replaceChildren();
  if (!others.length) {
    peopleEl.innerHTML = '<p class="empty">Waiting for others to arrive.</p>';
    return;
  }
  for (const person of others) {
    const row = document.createElement("div");
    row.className = "person";
    row.innerHTML = `<i class="person-dot" style="background:${person.color}"></i><span class="person-name"></span><button class="teleport" title="Teleport close to ${person.label}" aria-label="Teleport close to ${person.label}">↗</button>`;
    row.querySelector(".person-name").textContent = person.label;
    row.querySelector("button").onclick = () => send({ type: "teleport", targetId: person.id });
    peopleEl.append(row);
  }
}

function dropCube(x = me?.x, z = me?.y) {
  if (me && Number.isFinite(x) && Number.isFinite(z)) send({ type: "drop", x, y: z, color: selected });
}

function move(direction) {
  if (!me) return;
  const delta = {
    up: [0, -MOVE_STEP], down: [0, MOVE_STEP], left: [-MOVE_STEP, 0], right: [MOVE_STEP, 0]
  }[direction];
  if (!delta) return;
  const x = Math.max(-49.4, Math.min(49.4, me.x + delta[0]));
  const z = Math.max(-49.4, Math.min(49.4, me.y + delta[1]));
  const now = Date.now();
  if (now - lastMove > 45) {
    lastMove = now;
    send({ type: "move", x, y: z });
  }
}

function setHeldDirection(direction, active) {
  if (active) heldDirections.add(direction);
  else heldDirections.delete(direction);
}

dropCubeButton.addEventListener("click", () => dropCube());
document.querySelectorAll(".move-button").forEach((button) => {
  const direction = button.dataset.direction;
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); setHeldDirection(direction, true); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => button.addEventListener(eventName, () => setHeldDirection(direction, false)));
});

const keyDirections = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", a: "left", s: "down", d: "right" };
window.addEventListener("keydown", (event) => {
  const direction = keyDirections[event.key] || keyDirections[event.key.toLowerCase()];
  if (direction) {
    event.preventDefault();
    setHeldDirection(direction, true);
  }
});
window.addEventListener("keyup", (event) => {
  const direction = keyDirections[event.key] || keyDirections[event.key.toLowerCase()];
  if (direction) setHeldDirection(direction, false);
});
window.addEventListener("blur", () => heldDirections.clear());

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}
canvas.addEventListener("pointerdown", (event) => { pointerDown = { x: event.clientX, y: event.clientY }; });
canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8) return;
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if (hit) dropCube(Math.round(hit.point.x), Math.round(hit.point.z));
  pointerDown = null;
});

function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  if (heldDirections.size) {
    for (const direction of heldDirections) move(direction);
  }
  if (me) {
    const target = new THREE.Vector3(me.x, terrainHeight(Math.floor(me.x), Math.floor(me.y)) + 1, me.y);
    cameraTarget.lerp(target, 1 - Math.exp(-delta * 5));
  }
  camera.position.lerp(new THREE.Vector3(cameraTarget.x + 14, cameraTarget.y + 15, cameraTarget.z + 18), 1 - Math.exp(-delta * 4));
  camera.lookAt(cameraTarget);
  for (const avatar of avatarMeshes.values()) avatar.children.at(-1)?.quaternion.copy(camera.quaternion);
  renderer.render(scene, camera);
}

new ResizeObserver(resize).observe(canvas);
connect();
resize();
animate();
