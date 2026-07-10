import * as THREE from "https://unpkg.com/three@0.176.0/build/three.module.js";

// Assets and the WebSocket endpoint are intentionally served by the same Worker.
const API_ORIGIN = location.origin;
const WORLD_HALF = 50;
const MOVE_STEP = .15;
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
let me; let people = new Map(); let cookies = new Map(); let toys = new Map(); let npcs = new Map(); let leaderboard = [];
let socket; let lastMove = 0; let reconnectTimer; let toastTimer; let lastEat = 0;
const heldDirections = new Set(), dogMeshes = new Map(), npcMeshes = new Map(), itemMeshes = new Map();

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
  addMesh(group, new THREE.SphereGeometry(.48, 18, 14), fur, [.65, 1.12, 0]);
  addMesh(group, new THREE.SphereGeometry(.26, 14, 10), cream, [1.01, 1.01, 0]).scale.set(1.15, .76, 1);
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.SphereGeometry(.075, 10, 8), dark, [1.17, 1.2, side * .15]);
    const ear = addMesh(group, new THREE.SphereGeometry(style.ears === "long" ? .22 : .2, 14, 10), fur, [.59, style.ears === "long" ? 1.12 : 1.5, side * .34]);
    if (style.ears === "long") ear.scale.set(.56, 1.9, .72); else if (style.ears === "point") { ear.scale.set(.65, 1.45, .6); ear.rotation.x = side * .18; } else if (style.ears === "fold") ear.scale.set(1.1, .55, .9);
    if (style.patches) addMesh(group, new THREE.SphereGeometry(.18, 10, 8), new THREE.MeshLambertMaterial({ color: "#3b2b25" }), [.22, .95, side * .43]).scale.set(1.3, .6, 1);
    for (const x of [-.37, .37]) { const leg = addMesh(group, new THREE.CapsuleGeometry(.11, .38, 5, 10), fur, [x, .32, side * .25]); leg.rotation.z = side * .04; }
  }
  if (style.mask) addMesh(group, new THREE.SphereGeometry(.27, 14, 10), dark, [.76, 1.27, 0]).scale.set(.8, .45, 1.28);
  addMesh(group, new THREE.SphereGeometry(.085, 10, 8), dark, [1.22, 1.01, 0]);
  const tail = addMesh(group, new THREE.CapsuleGeometry(.08, .54, 5, 10), fur, [-.78, 1.0, 0], [0, 0, style.tail === "curl" ? -.55 : -.95]); if (style.tail === "curl") tail.position.y += .15;
  if (!npc) addMesh(group, new THREE.TorusGeometry(.39, .045, 8, 16), new THREE.MeshLambertMaterial({ color: "#ef6e70" }), [.61, 1.08, 0], [0, Math.PI / 2, 0]);
  const label = makeLabel(dog.id === me?.id ? "You" : dog.label, npc ? "#fff0ad" : "#fff9e9"); label.position.y = 2.2; group.add(label); group.userData = { label, breed: dog.breed, heading: dog.heading || 0 }; scene.add(group); return group;
}
function syncDog(dog) { let mesh = dogMeshes.get(dog.id); if (!mesh || mesh.userData.breed !== dog.breed) { if (mesh) scene.remove(mesh); mesh = makeDog(dog); dogMeshes.set(dog.id, mesh); } mesh.position.set(dog.x, 0, dog.y); mesh.scale.setScalar(DOG_SCALES[dog.breed] || 1); }
function syncNpc(npc) { let mesh = npcMeshes.get(npc.id); if (!mesh) { mesh = makeDog(npc, true); npcMeshes.set(npc.id, mesh); } mesh.position.set(npc.x, 0, npc.y); mesh.rotation.y = -npc.heading; }
function makeItem(item, type) { const group = new THREE.Group(); if (type === "toy") { const ball = addMesh(group, new THREE.SphereGeometry(.31, 16, 12), new THREE.MeshLambertMaterial({ color: "#ff6e8d" }), [0, .34, 0]); addMesh(group, new THREE.TorusGeometry(.2, .035, 6, 12), new THREE.MeshLambertMaterial({ color: "#ffe05d" }), [0, .34, 0], [Math.PI / 2, 0, 0]); group.userData.bob = Math.random() * 6; } else { const biscuit = new THREE.MeshLambertMaterial({ color: "#d58a43" }), edge = new THREE.MeshLambertMaterial({ color: "#f5c674" }); for (const x of [-.27, .27]) { addMesh(group, new THREE.SphereGeometry(.22, 10, 8), biscuit, [x, .16, 0]); addMesh(group, new THREE.SphereGeometry(.09, 8, 6), edge, [x, .29, 0]); } addMesh(group, new THREE.BoxGeometry(.52, .18, .25), biscuit, [0, .16, 0]); } scene.add(group); return group; }
function syncItem(item, type) { const key = `${type}:${item.id}`; let mesh = itemMeshes.get(key); if (!mesh) { mesh = makeItem(item, type); itemMeshes.set(key, mesh); } mesh.position.set(item.x, 0, item.y); }

function connect() { clearTimeout(reconnectTimer); socket = new WebSocket(`${API_ORIGIN.replace(/^http/, "ws")}/ws`); socket.onopen = () => { connectionEl.textContent = "Live park"; connectionEl.classList.add("live"); }; socket.onclose = () => { connectionEl.textContent = "Reconnecting"; connectionEl.classList.remove("live"); reconnectTimer = setTimeout(connect, 1200); }; socket.onmessage = ({ data }) => handle(JSON.parse(data)); }
function handle(message) {
  if (message.type === "welcome") { me = message.dog; people = new Map(message.people.map(dog => [dog.id, dog])); cookies = new Map(message.cookies.map(item => [item.id, item])); toys = new Map(message.toys.map(item => [item.id, item])); npcs = new Map(message.npcs.map(npc => [npc.id, npc])); leaderboard = message.leaderboard; cookies.forEach(item => syncItem(item, "cookie")); toys.forEach(item => syncItem(item, "toy")); npcs.forEach(syncNpc); }
  if (message.type === "dog_join" || message.type === "dog_update") { people.set(message.dog.id, message.dog); if (message.dog.id === me?.id) { me = message.dog; if (message.evolved) showToast(`✨ You evolved into a ${BREEDS[me.breed]}!`); else if (message.ate) showToast(message.itemType === "toy" ? "🧸 Found a toy! +2 XP" : "Nom! +1 XP"); } }
  if (message.type === "dog_leave") { people.delete(message.id); const dog = dogMeshes.get(message.id); if (dog) scene.remove(dog); dogMeshes.delete(message.id); }
  if (message.type === "item_respawn") { const collection = message.itemType === "toy" ? toys : cookies; collection.set(message.item.id, message.item); syncItem(message.item, message.itemType); }
  if (message.type === "npc_update") { npcs = new Map(message.npcs.map(npc => [npc.id, npc])); npcs.forEach(syncNpc); }
  if (message.type === "leaderboard") leaderboard = message.leaderboard;
  people.forEach(syncDog); renderPanel();
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function showToast(text) { toast.textContent = text; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1600); }
function renderPanel() { if (!me) return; const requirement = REQUIREMENTS[me.breed]; meEl.textContent = me.label; breedEl.textContent = `Breed: ${BREEDS[me.breed]}`; progressEl.textContent = requirement ? `${me.xp} / ${requirement} XP to evolve` : "Maximum breed — legendary pup!"; xpFill.style.width = `${requirement ? me.xp / requirement * 100 : 100}%`; breedList.replaceChildren(...BREEDS.map((breed, i) => { const item = document.createElement("li"); item.textContent = breed; item.className = i === me.breed ? "active" : ""; return item; })); const others = [...people.values()].filter(dog => dog.id !== me.id); peopleEl.replaceChildren(...(others.length ? others.map(dog => { const row = document.createElement("div"); row.className = "person"; row.innerHTML = `<i class="person-dot" style="background:${dog.color}"></i><span>${dog.label} · ${BREEDS[dog.breed]}</span>`; return row; }) : [Object.assign(document.createElement("p"), { className: "empty", textContent: "Waiting for other pups." })])); leaderboardEl.replaceChildren(...(leaderboard.length ? leaderboard.map(row => { const item = document.createElement("div"); item.className = `leaderboard-row ${row.id === me.id ? "mine" : ""}`; item.innerHTML = `<b>#${row.rank}</b><span></span><em>${BREEDS[row.breed]} · ${row.xp} XP</em>`; item.querySelector("span").textContent = row.id === me.id ? "You" : row.label; return item; }) : [Object.assign(document.createElement("p"), { className: "empty", textContent: "No pups yet." })])); }
function move(direction) { if (!me) return; const delta = ({ up:[0,-MOVE_STEP], down:[0,MOVE_STEP], left:[-MOVE_STEP,0], right:[MOVE_STEP,0] })[direction]; const now = Date.now(); if (delta && now - lastMove > 45) { lastMove = now; send({ type:"move", x:Math.max(-49.4, Math.min(49.4, me.x + delta[0])), y:Math.max(-49.4, Math.min(49.4, me.y + delta[1])) }); } }
function setHeldDirection(direction, active) { if (active) heldDirections.add(direction); else heldDirections.delete(direction); }
document.querySelectorAll(".move-button").forEach(button => { const direction = button.dataset.direction; button.addEventListener("pointerdown", e => { e.preventDefault(); setHeldDirection(direction, true); }); ["pointerup", "pointercancel", "pointerleave"].forEach(name => button.addEventListener(name, () => setHeldDirection(direction, false))); });
const keyDirections = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right", w:"up", a:"left", s:"down", d:"right" }; window.addEventListener("keydown", e => { const direction = keyDirections[e.key] || keyDirections[e.key.toLowerCase()]; if (direction) { e.preventDefault(); setHeldDirection(direction, true); } }); window.addEventListener("keyup", e => { const direction = keyDirections[e.key] || keyDirections[e.key.toLowerCase()]; if (direction) setHeldDirection(direction, false); }); window.addEventListener("blur", () => heldDirections.clear());
function pointerDistance() { const [a, b] = [...touchPointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); } function setPointerStart() { for (const pointer of touchPointers.values()) { pointer.lastX = pointer.x; pointer.lastY = pointer.y; } }
canvas.addEventListener("pointerdown", e => { if (e.pointerType !== "touch") return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); touchPointers.set(e.pointerId, { x:e.clientX, y:e.clientY, lastX:e.clientX, lastY:e.clientY }); if (touchPointers.size === 2) pinchDistance = pointerDistance(); });
canvas.addEventListener("pointermove", e => { const pointer = touchPointers.get(e.pointerId); if (!pointer) return; e.preventDefault(); pointer.x = e.clientX; pointer.y = e.clientY; cameraGestureUntil = performance.now() + 2200; if (touchPointers.size === 1) { cameraOrbit.azimuth -= (pointer.x - pointer.lastX) * .009; cameraOrbit.elevation = THREE.MathUtils.clamp(cameraOrbit.elevation + (pointer.y - pointer.lastY) * .007, .2, 1.18); } else if (touchPointers.size === 2) { const distance = pointerDistance(); if (pinchDistance) cameraOrbit.radius = THREE.MathUtils.clamp(cameraOrbit.radius * pinchDistance / distance, 8, 48); pinchDistance = distance; } setPointerStart(); }, { passive:false });
["pointerup", "pointercancel", "lostpointercapture"].forEach(name => canvas.addEventListener(name, e => { touchPointers.delete(e.pointerId); pinchDistance = touchPointers.size === 2 ? pointerDistance() : 0; setPointerStart(); }));
function resize() { const { width, height } = canvas.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
function animate() { requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .1); for (const direction of heldDirections) move(direction); if (me) { const target = new THREE.Vector3(me.x, 1, me.y); cameraTarget.lerp(target, 1 - Math.exp(-delta * 5)); const now = Date.now(); const toy = [...toys.values()].find(item => Math.hypot(item.x - me.x, item.y - me.y) < 1.35); const cookie = [...cookies.values()].find(item => Math.hypot(item.x - me.x, item.y - me.y) < 1.35); if (now - lastEat > 250 && (toy || cookie)) { lastEat = now; const item = toy || cookie; send({ type:"eat", itemId:item.id, itemType:toy ? "toy" : "cookie" }); } }
  if (!touchPointers.size && performance.now() > cameraGestureUntil) { const speed = 1 - Math.exp(-delta * 1.5); cameraOrbit.azimuth = THREE.MathUtils.lerp(cameraOrbit.azimuth, CAMERA_DEFAULTS.azimuth, speed); cameraOrbit.elevation = THREE.MathUtils.lerp(cameraOrbit.elevation, CAMERA_DEFAULTS.elevation, speed); cameraOrbit.radius = THREE.MathUtils.lerp(cameraOrbit.radius, CAMERA_DEFAULTS.radius, speed); }
  const horizontal = Math.cos(cameraOrbit.elevation) * cameraOrbit.radius; const cameraPosition = new THREE.Vector3(cameraTarget.x + Math.sin(cameraOrbit.azimuth) * horizontal, cameraTarget.y + Math.sin(cameraOrbit.elevation) * cameraOrbit.radius, cameraTarget.z + Math.cos(cameraOrbit.azimuth) * horizontal); camera.position.lerp(cameraPosition, 1 - Math.exp(-delta * 8)); camera.lookAt(cameraTarget); for (const mesh of [...dogMeshes.values(), ...npcMeshes.values()]) mesh.userData.label?.quaternion.copy(camera.quaternion); for (const mesh of itemMeshes.values()) { mesh.rotation.y += delta * 1.8; if (mesh.userData.bob) mesh.position.y = Math.sin(clock.elapsedTime * 3 + mesh.userData.bob) * .07; } renderer.render(scene, camera); }
new ResizeObserver(resize).observe(canvas); connect(); resize(); animate();
