import * as THREE from "https://unpkg.com/three@0.176.0/build/three.module.js";

// Assets and the WebSocket endpoint are intentionally served by the same Worker.
const API_ORIGIN = location.origin;
const WORLD_HALF = 50;
const DOG_POSITION_SMOOTHING = 16;
const MOVE_ACCELERATION = 19;
const MOVE_DECELERATION = 24;
const MAX_MOVE_SPEED = 5.2;
const BREEDS = ["Chihuahua", "Shih Tzu", "Golden Retriever", "Border Collie", "Rottweiler", "Saint Bernard"];
const REQUIREMENTS = [5, 10, 20, 40, 80];
const DOG_SCALES = [.67, .84, 1.05, 1.1, 1.3, 1.55];
const NPC_STYLE = {
  "Chow Chow": { body: "#b56d42", cream: "#edc894", ears: "round", tail: "curl", mane: true },
  Beagle: { body: "#c57c41", cream: "#fff2d0", ears: "long", tail: "up", patches: true },
  Husky: { body: "#dce9ee", cream: "#ffffff", ears: "point", tail: "curl", mask: true }
};

const canvas = document.querySelector("#world");
const peopleEl = document.querySelector("#people");
const leaderboardEl = document.querySelector("#leaderboard");
const connectionEl = document.querySelector("#connection");
const meEl = document.querySelector("#me");
const breedEl = document.querySelector("#breed");
const progressEl = document.querySelector("#progress");
const xpFill = document.querySelector("#xp-fill");
const breedList = document.querySelector("#breed-list");
const toast = document.querySelector("#toast");
const chatMessagesEl = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
let me; let people = new Map(); let cookies = new Map(); let toys = new Map(); let npcs = new Map(); let leaderboard = [];
let socket; let lastMove = 0; let reconnectTimer; let toastTimer; let lastEat = 0; let lastJump = 0;
const heldDirections = new Set(), dogMeshes = new Map(), npcMeshes = new Map(), itemMeshes = new Map();
const movement = { velocity: new THREE.Vector2(), position: new THREE.Vector2() };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color("#9eddf4"); scene.fog = new THREE.Fog("#9eddf4", 42, 120);
const camera = new THREE.PerspectiveCamera(52, 1, .1, 250); camera.position.set(14, 16, 18);
const cameraTarget = new THREE.Vector3(), clock = new THREE.Clock();
const CAMERA_DEFAULTS = { azimuth: Math.atan2(14, 18), elevation: Math.atan2(15, Math.hypot(14, 18)), radius: Math.hypot(14, 15, 18) };
const cameraOrbit = { ...CAMERA_DEFAULTS }, touchPointers = new Map(); let pinchDistance = 0, cameraGestureUntil = 0;
scene.add(new THREE.HemisphereLight("#edfdff", "#5d873d", 2.5));
const sun = new THREE.DirectionalLight("#fff1c4", 2.5); sun.position.set(-24, 36, 18); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -55; sun.shadow.camera.right = sun.shadow.camera.top = 55; scene.add(sun);

// A soft grass lawn replaces the old stacked, rocky voxel terrain.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshLambertMaterial({ color: "#78bd55" })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(.055, .38, 4), new THREE.MeshLambertMaterial({ color: "#91cf5c" }), 650);
const flower = new THREE.InstancedMesh(new THREE.SphereGeometry(.09, 6, 5), new THREE.MeshLambertMaterial({ color: "#fff2a7" }), 90);
const matrix = new THREE.Matrix4(); for (let i = 0; i < 650; i += 1) { const x = Math.random() * 98 - 49, z = Math.random() * 98 - 49; matrix.makeTranslation(x, .18, z); grass.setMatrixAt(i, matrix); }
for (let i = 0; i < 90; i += 1) { const x = Math.random() * 96 - 48, z = Math.random() * 96 - 48; matrix.makeTranslation(x, .14, z); flower.setMatrixAt(i, matrix); } grass.instanceMatrix.needsUpdate = flower.instanceMatrix.needsUpdate = true; scene.add(grass, flower);

function addPlayground() {
  const wood = new THREE.MeshLambertMaterial({ color: "#d98a4b" }), cream = new THREE.MeshLambertMaterial({ color: "#ffe0a0" }), teal = new THREE.MeshLambertMaterial({ color: "#4fae9b" }), yellow = new THREE.MeshLambertMaterial({ color: "#f6c550" });
  const playground = new THREE.Group();
  // Ramp and platform.
  addMesh(playground, new THREE.BoxGeometry(4.4, .22, 2.6), wood, [-27, 1.5, -23], [0, 0, -.48]);
  addMesh(playground, new THREE.BoxGeometry(2.1, .22, 2.6), cream, [-29.3, 2.57, -23]);
  for (const x of [-30.1, -28.5]) for (const z of [-24, -22]) addMesh(playground, new THREE.CylinderGeometry(.12, .12, 2.45, 10), wood, [x, 1.25, z]);
  // Colorful tunnel.
  const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 3.7, 20, 1, true, 0, Math.PI), teal); tunnel.rotation.z = Math.PI / 2; tunnel.position.set(23, 1.25, -25); tunnel.castShadow = tunnel.receiveShadow = true; playground.add(tunnel);
  addMesh(playground, new THREE.TorusGeometry(1.25, .11, 8, 20, Math.PI), yellow, [21.15, 1.25, -25], [0, Math.PI / 2, 0]);
  addMesh(playground, new THREE.TorusGeometry(1.25, .11, 8, 20, Math.PI), yellow, [24.85, 1.25, -25], [0, Math.PI / 2, 0]);
  // A happy see-saw.
  addMesh(playground, new THREE.BoxGeometry(5.5, .2, .7), yellow, [25, 1.35, 18], [0, 0, .12]);
  addMesh(playground, new THREE.ConeGeometry(.65, 1.3, 4), wood, [25, .62, 18], [0, Math.PI / 4, 0]);
  for (const x of [22.25, 27.75]) addMesh(playground, new THREE.SphereGeometry(.28, 12, 8), cream, [x, 1.6, 18]);
  scene.add(playground);
}
addPlayground();

function addMesh(group, geometry, material, position, rotation = [0, 0, 0]) { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh; }
function breedStyle(dog) {
  if (typeof dog.breed === "string") return NPC_STYLE[dog.breed];
  const styles = [
    { body: "#d99a6d", cream: "#ffe7c6", ears: "point", tail: "up" },
    { body: "#f1e1bb", cream: "#fff7e5", ears: "long", tail: "curl", mane: true },
    { body: "#d5a05a", cream: "#fff3d3", ears: "long", tail: "up" },
    { body: "#282521", cream: "#ffffff", ears: "point", tail: "up", patches: true },
    { body: "#302724", cream: "#bd8054", ears: "fold", tail: "up", mask: true },
    { body: "#a96948", cream: "#fff3da", ears: "long", tail: "up", mask: true }
  ]; return styles[dog.breed || 0];
}
function makeLabel(text, color = "#fff9e9") { const c = document.createElement("canvas"); c.width = 360; c.height = 70; const ctx = c.getContext("2d"); ctx.font = "800 24px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(45,70,39,.78)"; ctx.fillRect(0, 9, 360, 49); ctx.fillStyle = color; ctx.fillText(text, 180, 44); const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })); sprite.scale.set(3.1, .6, 1); return sprite; }

function makeDog(dog, npc = false) {
  const group = new THREE.Group(), style = breedStyle(dog); const fur = new THREE.MeshLambertMaterial({ color: dog.color || style.body }), cream = new THREE.MeshLambertMaterial({ color: style.cream }), dark = new THREE.MeshLambertMaterial({ color: "#2e251e" });
  // Rounded, overlapping forms make every pup feel soft rather than block-built.
  addMesh(group, new THREE.SphereGeometry(.58, 18, 12), fur, [0, .69, 0]).scale.set(1.38, .8, .76);
  if (style.mane) addMesh(group, new THREE.SphereGeometry(.57, 16, 12), cream, [.53, 1.07, 0]).scale.set(1, 1.08, 1.08);
  addMesh(group, new THREE.SphereGeometry(.57, 20, 15), fur, [.65, 1.16, 0]);
  addMesh(group, new THREE.SphereGeometry(.26, 14, 10), cream, [1.01, 1.01, 0]).scale.set(1.15, .76, 1);
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.SphereGeometry(.075, 10, 8), dark, [1.17, 1.2, side * .15]);
    const ear = addMesh(group, new THREE.SphereGeometry(.24, 14, 10), fur, [.53, style.ears === "point" ? 1.52 : 1.36, side * .43]);
    if (style.ears === "point") { ear.scale.set(.6, 1.45, .62); ear.rotation.x = side * .18; } else { ear.scale.set(.58, 1.8, .78); ear.rotation.x = side * .25; ear.userData.floppyEar = side; }
    if (style.patches) addMesh(group, new THREE.SphereGeometry(.18, 10, 8), new THREE.MeshLambertMaterial({ color: "#3b2b25" }), [.22, .95, side * .43]).scale.set(1.3, .6, 1);
    for (const x of [-.37, .37]) { const leg = addMesh(group, new THREE.CapsuleGeometry(.11, .38, 5, 10), fur, [x, .32, side * .25]); leg.rotation.z = side * .04; }
  }
  if (style.mask) addMesh(group, new THREE.SphereGeometry(.27, 14, 10), dark, [.76, 1.27, 0]).scale.set(.8, .45, 1.28);
  addMesh(group, new THREE.SphereGeometry(.085, 10, 8), dark, [1.22, 1.01, 0]);
  const tail = addMesh(group, new THREE.CapsuleGeometry(.08, .54, 5, 10), fur, [-.78, 1.0, 0], [0, 0, style.tail === "curl" ? -.55 : -.95]); if (style.tail === "curl") tail.position.y += .15;
  if (!npc) addMesh(group, new THREE.TorusGeometry(.39, .045, 8, 16), new THREE.MeshLambertMaterial({ color: "#ef6e70" }), [.61, 1.08, 0], [0, Math.PI / 2, 0]);
  const label = makeLabel(dog.id === me?.id ? "You" : dog.label, npc ? "#fff0ad" : "#fff9e9"); label.position.y = 2.35; group.add(label); group.userData = { label, breed: dog.breed, heading: dog.heading || 0, legs: group.children.filter(child => child.geometry?.type === "CapsuleGeometry"), ears: group.children.filter(child => child.userData.floppyEar) }; scene.add(group); return group;
}
function syncDog(dog) { let mesh = dogMeshes.get(dog.id); const isNew = !mesh || mesh.userData.breed !== dog.breed; if (isNew) { if (mesh) scene.remove(mesh); mesh = makeDog(dog); dogMeshes.set(dog.id, mesh); mesh.position.set(dog.x, 0, dog.y); } (mesh.userData.targetPosition ||= new THREE.Vector3()).set(dog.x, 0, dog.y); mesh.userData.jumpUntil = dog.jumpUntil || 0; mesh.scale.setScalar(DOG_SCALES[dog.breed] || 1); if (dog.id !== me?.id || !heldDirections.size) mesh.userData.targetHeading = dog.heading ?? mesh.userData.targetHeading ?? 0; }
function syncNpc(npc) { let mesh = npcMeshes.get(npc.id); const isNew = !mesh; if (isNew) { mesh = makeDog(npc, true); npcMeshes.set(npc.id, mesh); mesh.position.set(npc.x, 0, npc.y); } (mesh.userData.targetPosition ||= new THREE.Vector3()).set(npc.x, 0, npc.y); mesh.userData.targetHeading = npc.heading; }
function turnDog(mesh, delta) { const targetRotation = -(mesh.userData.targetHeading ?? 0); const rotationDelta = THREE.MathUtils.euclideanModulo(targetRotation - mesh.rotation.y + Math.PI, Math.PI * 2) - Math.PI; mesh.rotation.y += rotationDelta * (1 - Math.exp(-delta * 10)); }
function makeItem(item, type) { const group = new THREE.Group(); if (type === "toy") { const ball = addMesh(group, new THREE.SphereGeometry(.31, 16, 12), new THREE.MeshLambertMaterial({ color: item.golden ? "#ffd13e" : "#ff6e8d", emissive: item.golden ? "#6d4700" : "#000000" }), [0, .34, 0]); addMesh(group, new THREE.TorusGeometry(.2, .035, 6, 12), new THREE.MeshLambertMaterial({ color: item.golden ? "#fff6ae" : "#ffe05d" }), [0, .34, 0], [Math.PI / 2, 0, 0]); if (item.golden) addMesh(group, new THREE.TorusGeometry(.43, .025, 6, 12), new THREE.MeshBasicMaterial({ color: "#fff1a8" }), [0, .38, 0], [Math.PI / 2, 0, 0]); group.userData.bob = Math.random() * 6; } else { const biscuit = new THREE.MeshLambertMaterial({ color: "#d58a43" }), edge = new THREE.MeshLambertMaterial({ color: "#f5c674" }); for (const x of [-.27, .27]) { addMesh(group, new THREE.SphereGeometry(.22, 10, 8), biscuit, [x, .16, 0]); addMesh(group, new THREE.SphereGeometry(.09, 8, 6), edge, [x, .29, 0]); } addMesh(group, new THREE.BoxGeometry(.52, .18, .25), biscuit, [0, .16, 0]); } scene.add(group); return group; }
function syncItem(item, type) { const key = `${type}:${item.id}`; let mesh = itemMeshes.get(key); if (!mesh) { mesh = makeItem(item, type); itemMeshes.set(key, mesh); } mesh.position.set(item.x, 0, item.y); }

function connect() { clearTimeout(reconnectTimer); socket = new WebSocket(`${API_ORIGIN.replace(/^http/, "ws")}/ws`); socket.onopen = () => { connectionEl.textContent = "Live park"; connectionEl.classList.add("live"); }; socket.onclose = () => { connectionEl.textContent = "Reconnecting"; connectionEl.classList.remove("live"); reconnectTimer = setTimeout(connect, 1200); }; socket.onmessage = ({ data }) => { try { handle(JSON.parse(data)); } catch {} }; }
function handle(message) {
  if (message.type === "welcome") { me = message.dog; movement.position.set(me.x, me.y); movement.velocity.set(0, 0); people = new Map(message.people.map(dog => [dog.id, dog])); cookies = new Map(message.cookies.map(item => [item.id, item])); toys = new Map(message.toys.map(item => [item.id, item])); npcs = new Map(message.npcs.map(npc => [npc.id, npc])); leaderboard = message.leaderboard; cookies.forEach(item => syncItem(item, "cookie")); toys.forEach(item => syncItem(item, "toy")); npcs.forEach(syncNpc); }
  if (message.type === "dog_join" || message.type === "dog_update") { people.set(message.dog.id, message.dog); if (message.dog.id === me?.id) { me = message.dog; movement.position.set(me.x, me.y); if (message.evolved) showToast(`✨ You evolved into a ${BREEDS[me.breed]}!`); else if (message.ate) showToast(message.itemType === "toy" ? (message.golden ? "🌟 Golden toy! +4 XP" : "🧸 Found a toy! +2 XP") : "Nom! +1 XP"); } }
  if (message.type === "dog_leave") { people.delete(message.id); const dog = dogMeshes.get(message.id); if (dog) scene.remove(dog); dogMeshes.delete(message.id); }
  if (message.type === "item_respawn") { const collection = message.itemType === "toy" ? toys : cookies; collection.set(message.item.id, message.item); syncItem(message.item, message.itemType); }
  if (message.type === "npc_update") { npcs = new Map(message.npcs.map(npc => [npc.id, npc])); npcs.forEach(syncNpc); }
  if (message.type === "leaderboard") leaderboard = message.leaderboard;
  if (message.type === "chat") addChatMessage(message);
  people.forEach(syncDog); renderPanel();
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function showToast(text) { toast.textContent = text; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1600); }
function addChatMessage(message) { const empty = chatMessagesEl.querySelector(".empty"); if (empty) empty.remove(); const row = document.createElement("p"); row.className = "chat-message"; const name = document.createElement("b"); name.textContent = message.from === me?.id ? "You:" : `${message.label}:`; row.append(name, document.createTextNode(` ${message.text}`)); chatMessagesEl.append(row); while (chatMessagesEl.children.length > 30) chatMessagesEl.firstElementChild.remove(); chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; }
function renderPanel() { if (!me) return; const requirement = REQUIREMENTS[me.breed]; meEl.textContent = me.label; breedEl.textContent = `Breed: ${BREEDS[me.breed]}`; progressEl.textContent = requirement ? `${me.xp} / ${requirement} XP to evolve` : "Maximum breed — legendary pup!"; xpFill.style.width = `${requirement ? me.xp / requirement * 100 : 100}%`; breedList.replaceChildren(...BREEDS.map((breed, i) => { const item = document.createElement("li"); item.textContent = breed; item.className = i === me.breed ? "active" : ""; return item; })); const others = [...people.values()].filter(dog => dog.id !== me.id); peopleEl.replaceChildren(...(others.length ? others.map(dog => { const row = document.createElement("div"); row.className = "person"; row.innerHTML = `<i class="person-dot" style="background:${dog.color}"></i><span>${dog.label} · ${BREEDS[dog.breed]}</span>`; return row; }) : [Object.assign(document.createElement("p"), { className: "empty", textContent: "Waiting for other pups." })])); leaderboardEl.replaceChildren(...(leaderboard.length ? leaderboard.map(row => { const item = document.createElement("div"); item.className = `leaderboard-row ${row.id === me.id ? "mine" : ""}`; item.innerHTML = `<b>#${row.rank}</b><span></span><em>${BREEDS[row.breed]} · ${row.xp} XP</em>`; item.querySelector("span").textContent = row.id === me.id ? "You" : row.label; return item; }) : [Object.assign(document.createElement("p"), { className: "empty", textContent: "No pups yet." })])); }
const DIRECTION_VECTORS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
function heldDirectionVector() { let x = 0, y = 0; for (const direction of heldDirections) { const vector = DIRECTION_VECTORS[direction]; if (vector) { x += vector[0]; y += vector[1]; } } const length = Math.hypot(x, y); return length ? { x:x / length, y:y / length } : null; }
function updateMovement(direction, delta) { if (!me) return; const desired = direction ? new THREE.Vector2(direction.x, direction.y).multiplyScalar(MAX_MOVE_SPEED) : new THREE.Vector2(); const rate = direction ? MOVE_ACCELERATION : MOVE_DECELERATION; movement.velocity.lerp(desired, Math.min(1, rate * delta)); if (movement.velocity.lengthSq() < .0001) movement.velocity.set(0, 0); if (!movement.velocity.lengthSq()) return; movement.position.addScaledVector(movement.velocity, delta); movement.position.x = THREE.MathUtils.clamp(movement.position.x, -49.4, 49.4); movement.position.y = THREE.MathUtils.clamp(movement.position.y, -49.4, 49.4); me.x = movement.position.x; me.y = movement.position.y; people.set(me.id, me); syncDog(me); const now = Date.now(); if (now - lastMove > 65) { lastMove = now; send({ type:"move", x:me.x, y:me.y }); } }
function faceDog(direction) { const mesh = me && dogMeshes.get(me.id); if (!direction || !mesh) return; mesh.userData.targetHeading = Math.atan2(direction.y, direction.x); }
function setHeldDirection(direction, active) { if (active) heldDirections.add(direction); else heldDirections.delete(direction); faceDog(heldDirectionVector()); }
function jump() { const now = Date.now(); if (!me || now - lastJump < 500) return; lastJump = now; const updated = { ...me, jumpUntil: now + 520 }; me = updated; people.set(updated.id, updated); send({ type:"jump" }); }
document.querySelectorAll(".move-button").forEach(button => { const direction = button.dataset.direction; button.addEventListener("pointerdown", e => { e.preventDefault(); setHeldDirection(direction, true); }); ["pointerup", "pointercancel", "pointerleave"].forEach(name => button.addEventListener(name, () => setHeldDirection(direction, false))); });
document.querySelector("#jump-button").addEventListener("pointerdown", e => { e.preventDefault(); jump(); });
const keyDirections = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right", w:"up", a:"left", s:"down", d:"right" }; window.addEventListener("keydown", e => { if (e.code === "Space" && document.activeElement !== chatInput) { e.preventDefault(); jump(); return; } const direction = keyDirections[e.key] || keyDirections[e.key.toLowerCase()]; if (direction && document.activeElement !== chatInput) { e.preventDefault(); setHeldDirection(direction, true); } }); window.addEventListener("keyup", e => { const direction = keyDirections[e.key] || keyDirections[e.key.toLowerCase()]; if (direction) setHeldDirection(direction, false); }); window.addEventListener("blur", () => heldDirections.clear());
chatForm.addEventListener("submit", event => { event.preventDefault(); const text = chatInput.value.trim(); if (!text) return; send({ type:"chat", text }); chatInput.value = ""; });
function pointerDistance() { const [a, b] = [...touchPointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); } function setPointerStart() { for (const pointer of touchPointers.values()) { pointer.lastX = pointer.x; pointer.lastY = pointer.y; } }
canvas.addEventListener("pointerdown", e => { if (e.pointerType !== "touch") return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); touchPointers.set(e.pointerId, { x:e.clientX, y:e.clientY, lastX:e.clientX, lastY:e.clientY }); if (touchPointers.size === 2) pinchDistance = pointerDistance(); });
canvas.addEventListener("pointermove", e => { const pointer = touchPointers.get(e.pointerId); if (!pointer) return; e.preventDefault(); pointer.x = e.clientX; pointer.y = e.clientY; cameraGestureUntil = performance.now() + 2200; if (touchPointers.size === 1) { cameraOrbit.azimuth -= (pointer.x - pointer.lastX) * .009; cameraOrbit.elevation = THREE.MathUtils.clamp(cameraOrbit.elevation + (pointer.y - pointer.lastY) * .007, .2, 1.18); } else if (touchPointers.size === 2) { const distance = pointerDistance(); if (pinchDistance) cameraOrbit.radius = THREE.MathUtils.clamp(cameraOrbit.radius * pinchDistance / distance, 8, 48); pinchDistance = distance; } setPointerStart(); }, { passive:false });
["pointerup", "pointercancel", "lostpointercapture"].forEach(name => canvas.addEventListener(name, e => { touchPointers.delete(e.pointerId); pinchDistance = touchPointers.size === 2 ? pointerDistance() : 0; setPointerStart(); }));
function resize() { const { width, height } = canvas.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
function animate() { requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .1); const direction = heldDirectionVector(); if (direction) faceDog(direction); updateMovement(direction, delta); if (me) { const target = new THREE.Vector3(me.x, 1, me.y); cameraTarget.lerp(target, 1 - Math.exp(-delta * 5)); const now = Date.now(); const toy = [...toys.values()].find(item => Math.hypot(item.x - me.x, item.y - me.y) < 1.35); const cookie = [...cookies.values()].find(item => Math.hypot(item.x - me.x, item.y - me.y) < 1.35); if (now - lastEat > 250 && (toy || cookie)) { lastEat = now; const item = toy || cookie; send({ type:"eat", itemId:item.id, itemType:toy ? "toy" : "cookie" }); } }
  if (!touchPointers.size && performance.now() > cameraGestureUntil) { const speed = 1 - Math.exp(-delta * 1.5); cameraOrbit.azimuth = THREE.MathUtils.lerp(cameraOrbit.azimuth, CAMERA_DEFAULTS.azimuth, speed); cameraOrbit.elevation = THREE.MathUtils.lerp(cameraOrbit.elevation, CAMERA_DEFAULTS.elevation, speed); cameraOrbit.radius = THREE.MathUtils.lerp(cameraOrbit.radius, CAMERA_DEFAULTS.radius, speed); }
  const horizontal = Math.cos(cameraOrbit.elevation) * cameraOrbit.radius; const cameraPosition = new THREE.Vector3(cameraTarget.x + Math.sin(cameraOrbit.azimuth) * horizontal, cameraTarget.y + Math.sin(cameraOrbit.elevation) * cameraOrbit.radius, cameraTarget.z + Math.cos(cameraOrbit.azimuth) * horizontal); camera.position.lerp(cameraPosition, 1 - Math.exp(-delta * 8)); camera.lookAt(cameraTarget); for (const mesh of [...dogMeshes.values(), ...npcMeshes.values()]) { if (mesh.userData.targetPosition) mesh.position.lerp(mesh.userData.targetPosition, 1 - Math.exp(-delta * DOG_POSITION_SMOOTHING)); const moving = mesh.userData.targetPosition && mesh.position.distanceTo(mesh.userData.targetPosition) > .03; const jumpTime = Math.max(0, (mesh.userData.jumpUntil - Date.now()) / 520); const jumpHeight = jumpTime ? Math.sin((1 - jumpTime) * Math.PI) * .85 : 0; mesh.position.y = jumpHeight; mesh.userData.legs?.forEach((leg, index) => { leg.rotation.z = Math.sin(clock.elapsedTime * (moving ? 15 : 5) + index * Math.PI) * (moving ? .34 : .06); }); mesh.userData.ears?.forEach(ear => { ear.rotation.z = Math.sin(clock.elapsedTime * 8 + ear.userData.floppyEar) * .14; }); turnDog(mesh, delta); mesh.userData.label?.quaternion.copy(camera.quaternion); } for (const mesh of itemMeshes.values()) { mesh.rotation.y += delta * 1.8; if (mesh.userData.bob) mesh.position.y = Math.sin(clock.elapsedTime * 3 + mesh.userData.bob) * .07; } renderer.render(scene, camera); }
new ResizeObserver(resize).observe(canvas); connect(); resize(); animate();
