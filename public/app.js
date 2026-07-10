import * as THREE from "https://unpkg.com/three@0.176.0/build/three.module.js";

const API_ORIGIN = "https://little-cube-world-api.woxclaw.workers.dev";
const WORLD_SIZE = 100;
const WORLD_HALF = WORLD_SIZE / 2;
const MOVE_STEP = 0.15;
const BREEDS = ["Chihuahua", "Shitzu", "Golden Retriever", "Border Collie", "Rottweiler", "Saint Bernard"];
const REQUIREMENTS = [5, 10, 20, 40, 80];
const DOG_SCALES = [.68, .87, 1.12, 1.3, 1.53, 1.82];

const canvas = document.querySelector("#world");
const peopleEl = document.querySelector("#people");
const connectionEl = document.querySelector("#connection");
const meEl = document.querySelector("#me");
const breedEl = document.querySelector("#breed");
const progressEl = document.querySelector("#progress");
const xpFill = document.querySelector("#xp-fill");
const breedList = document.querySelector("#breed-list");
const toast = document.querySelector("#toast");

let me = null;
let people = new Map();
let cookies = new Map();
let socket;
let lastMove = 0;
let reconnectTimer;
let toastTimer;
let lastEat = 0;
const heldDirections = new Set();
const dogMeshes = new Map();
const cookieMeshes = new Map();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#8ed1ef");
scene.fog = new THREE.Fog("#8ed1ef", 35, 108);
const camera = new THREE.PerspectiveCamera(52, 1, .1, 250);
camera.position.set(14, 16, 18);
const cameraTarget = new THREE.Vector3();
const clock = new THREE.Clock();
scene.add(new THREE.HemisphereLight("#e9faff", "#3e5938", 2.4));
const sun = new THREE.DirectionalLight("#fff2c4", 2.7);
sun.position.set(-24, 36, 18); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -55; sun.shadow.camera.right = 55; sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
scene.add(sun);

const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const terrain = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), terrainMaterial, WORLD_SIZE * WORLD_SIZE);
terrain.receiveShadow = true; scene.add(terrain);
const matrix = new THREE.Matrix4(); const terrainColor = new THREE.Color();
function terrainHeight(x, z) { return Math.max(1, Math.round(3 + Math.sin(x * .15) * 1.25 + Math.cos(z * .13) * 1.1 + Math.sin((x + z) * .33) * .35)); }
for (let z = -WORLD_HALF, index = 0; z < WORLD_HALF; z += 1) for (let x = -WORLD_HALF; x < WORLD_HALF; x += 1, index += 1) {
  const h = terrainHeight(x, z); matrix.makeScale(.98, h, .98); matrix.setPosition(x + .5, h / 2 - 1, z + .5); terrain.setMatrixAt(index, matrix);
  terrainColor.setHSL(.27 + ((x + z) % 5) * .006, .39, .27 + h * .018); terrain.setColorAt(index, terrainColor);
}
terrain.instanceMatrix.needsUpdate = true; terrain.instanceColor.needsUpdate = true;

function addMesh(group, geometry, material, position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}

function makeDog(dog) {
  const group = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({ color: dog.color });
  const cream = new THREE.MeshLambertMaterial({ color: "#f6e2bd" });
  const dark = new THREE.MeshLambertMaterial({ color: "#2d211c" });
  const level = dog.breed || 0;
  const longEars = level === 1 || level === 5;
  // Low-poly body, head, muzzle, legs, ears, tail, and collar are all basic Three.js geometries.
  addMesh(group, new THREE.BoxGeometry(1.35, .72, .68), fur, [0, .86, 0]);
  addMesh(group, new THREE.SphereGeometry(.47, 8, 6), fur, [.75, 1.22, 0]);
  addMesh(group, new THREE.BoxGeometry(.38, .25, .4), cream, [1.1, 1.1, 0]);
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.CylinderGeometry(.11, .13, .62, 6), fur, [side * .42, .34, side * .2]);
    addMesh(group, new THREE.SphereGeometry(.075, 6, 5), dark, [1.28, 1.13, side * .15]);
    addMesh(group, new THREE.BoxGeometry(longEars ? .16 : .28, longEars ? .55 : .32, .18), dark, [.67, 1.45, side * .37], [0, 0, side * .18]);
  }
  addMesh(group, new THREE.SphereGeometry(.09, 6, 5), dark, [1.31, 1.08, 0]);
  addMesh(group, new THREE.CylinderGeometry(.055, .075, .85, 6), fur, [-.88, 1.08, 0], [0, 0, -.95]);
  addMesh(group, new THREE.TorusGeometry(.38, .055, 5, 8), new THREE.MeshLambertMaterial({ color: "#e84e4c" }), [.73, 1.18, 0], [0, Math.PI / 2, 0]);
  const label = makeLabel(dog.id === me?.id ? "You" : dog.label, "#fff9e9"); label.position.y = 2.25; group.add(label); group.userData = { label, breed: -1 }; scene.add(group); return group;
}

function makeLabel(text, color) {
  const c = document.createElement("canvas"); c.width = 300; c.height = 68; const ctx = c.getContext("2d");
  ctx.font = "800 25px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(35,54,40,.78)"; ctx.fillRect(0, 9, 300, 48); ctx.fillStyle = color; ctx.fillText(text, 150, 43);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })); sprite.scale.set(2.7, .61, 1); return sprite;
}

function syncDog(dog) {
  let mesh = dogMeshes.get(dog.id);
  if (!mesh || mesh.userData.breed !== dog.breed) { if (mesh) scene.remove(mesh); mesh = makeDog(dog); mesh.userData.breed = dog.breed; dogMeshes.set(dog.id, mesh); }
  const ground = terrainHeight(Math.floor(dog.x), Math.floor(dog.y)); mesh.position.set(dog.x, ground, dog.y); mesh.scale.setScalar(DOG_SCALES[dog.breed] || 1);
}

function makeCookie(cookie) {
  const group = new THREE.Group(); const biscuit = new THREE.MeshLambertMaterial({ color: "#d58a43" }); const edge = new THREE.MeshLambertMaterial({ color: "#f0b966" });
  for (const x of [-.28, .28]) { addMesh(group, new THREE.SphereGeometry(.22, 7, 5), biscuit, [x, .08, 0]); addMesh(group, new THREE.SphereGeometry(.11, 6, 5), edge, [x, .18, 0]); }
  addMesh(group, new THREE.BoxGeometry(.56, .2, .28), biscuit, [0, .08, 0]);
  scene.add(group); return group;
}
function syncCookie(cookie) { let mesh = cookieMeshes.get(cookie.id); if (!mesh) { mesh = makeCookie(cookie); cookieMeshes.set(cookie.id, mesh); } mesh.position.set(cookie.x, terrainHeight(Math.floor(cookie.x), Math.floor(cookie.y)) + .18, cookie.y); }

function connect() {
  clearTimeout(reconnectTimer); const origin = API_ORIGIN === "__API_ORIGIN__" ? location.origin : API_ORIGIN; socket = new WebSocket(`${origin.replace(/^http/, "ws")}/ws`);
  socket.onopen = () => { connectionEl.textContent = "Live park"; connectionEl.classList.add("live"); };
  socket.onclose = () => { connectionEl.textContent = "Reconnecting"; connectionEl.classList.remove("live"); reconnectTimer = setTimeout(connect, 1200); };
  socket.onmessage = ({ data }) => handle(JSON.parse(data));
}
function handle(message) {
  if (message.type === "welcome") { me = message.dog; people = new Map(message.people.map((dog) => [dog.id, dog])); cookies = new Map(message.cookies.map((cookie) => [cookie.id, cookie])); cookies.forEach(syncCookie); }
  if (message.type === "dog_join" || message.type === "dog_update") { people.set(message.dog.id, message.dog); if (message.dog.id === me?.id) { const evolved = message.evolved; me = message.dog; if (evolved) showToast(`✨ Evolved into a ${BREEDS[me.breed]}!`); else if (message.ate) showToast("Nom! +1 cookie"); } }
  if (message.type === "dog_leave") { people.delete(message.id); const dog = dogMeshes.get(message.id); if (dog) scene.remove(dog); dogMeshes.delete(message.id); }
  if (message.type === "cookie_respawn") { cookies.set(message.cookie.id, message.cookie); syncCookie(message.cookie); }
  people.forEach(syncDog); renderPanel();
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function showToast(text) { toast.textContent = text; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1500); }
function renderPanel() {
  if (!me) return; const requirement = REQUIREMENTS[me.breed]; meEl.textContent = me.label; breedEl.textContent = `Breed: ${BREEDS[me.breed]}`;
  progressEl.textContent = requirement ? `${me.xp} / ${requirement} bone cookies` : "Maximum breed — legendary pup!"; xpFill.style.width = `${requirement ? me.xp / requirement * 100 : 100}%`;
  breedList.replaceChildren(...BREEDS.map((breed, index) => { const item = document.createElement("li"); item.textContent = breed; item.className = index === me.breed ? "active" : ""; return item; }));
  const others = [...people.values()].filter((dog) => dog.id !== me.id); peopleEl.replaceChildren(); if (!others.length) { peopleEl.innerHTML = '<p class="empty">Waiting for other pups.</p>'; return; }
  for (const dog of others) { const row = document.createElement("div"); row.className = "person"; row.innerHTML = `<i class="person-dot" style="background:${dog.color}"></i><span class="person-name"></span>`; row.querySelector(".person-name").textContent = `${dog.label} · ${BREEDS[dog.breed]}`; peopleEl.append(row); }
}
function move(direction) { if (!me) return; const delta = ({ up:[0,-MOVE_STEP], down:[0,MOVE_STEP], left:[-MOVE_STEP,0], right:[MOVE_STEP,0] })[direction]; if (!delta) return; const now = Date.now(); if (now - lastMove > 45) { lastMove = now; send({ type:"move", x:Math.max(-49.4, Math.min(49.4, me.x + delta[0])), y:Math.max(-49.4, Math.min(49.4, me.y + delta[1])) }); } }
function setHeldDirection(direction, active) { if (active) heldDirections.add(direction); else heldDirections.delete(direction); }
document.querySelectorAll(".move-button").forEach((button) => { const direction = button.dataset.direction; button.addEventListener("pointerdown", (event) => { event.preventDefault(); setHeldDirection(direction, true); }); ["pointerup", "pointercancel", "pointerleave"].forEach((name) => button.addEventListener(name, () => setHeldDirection(direction, false))); });
const keyDirections = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right", w:"up", a:"left", s:"down", d:"right" };
window.addEventListener("keydown", (event) => { const direction = keyDirections[event.key] || keyDirections[event.key.toLowerCase()]; if (direction) { event.preventDefault(); setHeldDirection(direction, true); } }); window.addEventListener("keyup", (event) => { const direction = keyDirections[event.key] || keyDirections[event.key.toLowerCase()]; if (direction) setHeldDirection(direction, false); }); window.addEventListener("blur", () => heldDirections.clear());
function resize() { const { width, height } = canvas.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
function animate() { requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .1); for (const direction of heldDirections) move(direction); if (me) { const target = new THREE.Vector3(me.x, terrainHeight(Math.floor(me.x), Math.floor(me.y)) + 1, me.y); cameraTarget.lerp(target, 1 - Math.exp(-delta * 5)); const now = Date.now(); if (now - lastEat > 250) { const nearby = [...cookies.values()].find((cookie) => Math.hypot(cookie.x - me.x, cookie.y - me.y) < 1.35); if (nearby) { lastEat = now; send({ type: "eat", cookieId: nearby.id }); } } } camera.position.lerp(new THREE.Vector3(cameraTarget.x + 14, cameraTarget.y + 15, cameraTarget.z + 18), 1 - Math.exp(-delta * 4)); camera.lookAt(cameraTarget); for (const dog of dogMeshes.values()) dog.userData.label?.quaternion.copy(camera.quaternion); for (const cookie of cookieMeshes.values()) cookie.rotation.y += delta * 1.8; renderer.render(scene, camera); }
new ResizeObserver(resize).observe(canvas); connect(); resize(); animate();
