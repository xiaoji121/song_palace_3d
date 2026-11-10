import * as THREE from 'three';
import { createCharacter } from './characters.js';
import { SAVE_KEY, STAGES, initialQuest, readQuest, advanceQuest } from './quest-state.js';

const NPCS = [
  { id: 'lin', name: '林掌柜', role: '春和茶坊 · 掌柜', place: '御街 · 春和茶坊', portrait: 'lin', px: 664, side: -1, robeColor: '#8c5036', trimColor: '#a29b80', hatStyle: 'bun' },
  { id: 'acheng', name: '阿成', role: '清和茶栈 · 伙计', place: '御街 · 清和茶栈', portrait: 'acheng', px: 704, side: 1, robeColor: '#3e576a', trimColor: '#c3b492', hatStyle: 'cloth' },
  { id: 'shen', name: '沈先生', role: '桥畔书舍 · 说书人', place: '众安桥北 · 临水书舍', portrait: 'shen', px: 1078, side: -1, robeColor: '#6b7665', trimColor: '#d1c6a4', hatStyle: 'scholar' },
];
const OBJECTIVES = {
  meet: '靠近春和茶坊的林掌柜，听听今天有什么需要帮忙。',
  collect: '沿御街找茶栈伙计阿成，领取林掌柜订下的新焙茶饼。',
  deliver: '带着茶包向北，走过众安桥，把茶交给桥北的沈先生。',
  complete: '第一回委托已完成。你已认识三位临安人，可以继续自由探索。',
};
const portraitUrl = name => new URL(`./assets/characters/${name}.jpg`, import.meta.url).href;

export function createAdventure({ scene, camera, houses, roofGeometry, roofMaterial, wx, wz, groundAt, findSpawn, isBlocked, getMode, getPlayer, travel, pause, face }) {
  const $ = id => document.getElementById(id);
  let state, storageAvailable = true, active = false, saveTimer = 0, uiTimer = 0, routeTimer = 0, toastTimer = 0, nearest = null;
  try { state = readQuest(localStorage.getItem(SAVE_KEY)); } catch { state = initialQuest(); storageAvailable = false; }
  const dialog = $('npc-dialog'), journal = $('journal-dialog');
  const world = new THREE.Group(); world.name = '临安一日 · 可玩街区'; scene.add(world);
  const obstacles = [], actors = [], meshes = [];
  const palette = {};
  const surface = (name, color, roughness = .9) => {
    if (!palette[name]) palette[name] = new THREE.MeshStandardMaterial({ name, color, roughness });
    return palette[name];
  };
  const wood = surface('街区杉木', '#59402c'), timber = surface('柜台原木', '#a27a50');
  const stone = surface('青石台基', '#aaa994'), plaster = surface('米白粉墙', '#d8ceaf');
  const cloth = surface('青布棚', '#617b6b'), paper = surface('纸灯', '#e0bb7a');
  const ceramic = surface('青瓷', '#91a28b', .3), terracotta = surface('陶罐', '#9b6643');
  paper.emissive = new THREE.Color('#e6a34c'); paper.emissiveIntensity = .2;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1), sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  function mesh(geometry, material, x, y, z, sx, sy, sz, parent = world) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); meshes.push(m); return m;
  }
  const box = (x, y, z, w, h, d, material, parent) => mesh(boxGeo, material, x, y, z, w, h, d, parent);
  const pole = (x, y, z, r, h, material, parent) => mesh(cylinderGeo, material, x, y, z, r, h, r, parent);
  function plaque(text, x, y, z, w, h, parent) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#253b2d'; ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = '#c8ad74'; ctx.lineWidth = 5; ctx.strokeRect(10, 10, 492, 172);
    ctx.fillStyle = '#e8d4a5'; ctx.font = '76px "Ma Shan Zheng", "STKaiti", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 104, 462);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: .88 }), x, y, z, 1, 1, 1, parent);
  }
  function obstacle(x, z, w, d) { obstacles.push({ x, z, w: w / 2, d: d / 2 }); }
  function vessel(x, y, z, parent, scale = 1) {
    mesh(sphereGeo, ceramic, x, y + .19 * scale, z, .18 * scale, .22 * scale, .18 * scale, parent);
    pole(x, y + .4 * scale, z, .1 * scale, .08 * scale, ceramic, parent);
  }
  function makeShop(npc) {
    const targetX = wx(npc.px), streetZ = wz(700);
    const candidates = houses.filter(h => (h.z - streetZ) * npc.side > 14 && (h.z - streetZ) * npc.side < 30 && Math.abs(h.x - targetX) < 35);
    candidates.sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX));
    const house = candidates[0];
    const x = house?.x ?? targetX, z = house?.z ?? streetZ + npc.side * 20;
    if (house) houses.splice(houses.indexOf(house), 1);
    const g = new THREE.Group(); g.name = npc.place; g.position.set(x, 1.5, z); g.rotation.y = npc.side < 0 ? 0 : Math.PI; world.add(g);
    const w = house?.w ?? 8, d = house?.d ?? 12, height = house?.h ?? 4.2;
    box(0, .18, 0, w + .15, .36, d, stone, g);
    box(0, height / 2 + .3, 0, w, height, d, plaster, g);
    box(0, 1.7, d / 2 + .04, w - .3, 2.6, .12, wood, g);
    for (const a of [-w / 2 + .2, 0, w / 2 - .2]) box(a, 2.1, d / 2 + .12, .16, 3.7, .2, timber, g);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) box(side * w * .27 + (k - 2.5) * .16, 2.2, d / 2 + .14, .045, 1.55, .045, timber, g);
      box(side * w * .27, 2.2, d / 2 + .14, 1.05, .045, .045, timber, g);
      const lanternX = side * (w / 2 - .55);
      mesh(sphereGeo, paper, lanternX, 3.2, d / 2 + .6, .23, .35, .23, g);
      pole(lanternX, 3.6, d / 2 + .6, .025, .4, wood, g);
      pole(lanternX, 2.75, d / 2 + .6, .025, .24, terracotta, g);
    }
    if (height > 5) {
      box(0, 4.3, d / 2 + .04, w - .2, .13, .2, timber, g);
      for (let a = -w / 2 + .5; a < w / 2; a += .7) box(a, height - .8, d / 2 + .08, .055, 1.1, .07, timber, g);
    }
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = height + .35; roof.rotation.y = d > w ? Math.PI / 2 : 0;
    roof.scale.set(Math.max(w, d) + 1.7, Math.min(w, d) * .42, Math.min(w, d) + 1.7); roof.castShadow = roof.receiveShadow = true; g.add(roof);
    plaque(npc.id === 'lin' ? '春和茶坊' : npc.id === 'acheng' ? '清和茶栈' : '临水书舍', 0, 3.7, d / 2 + .2, Math.min(3, w - 1), .78, g);
    box(0, 3, d / 2 + 1.05, w + .3, .09, 1.7, cloth, g).rotation.x = .12;
    for (const a of [-w / 2, w / 2]) pole(a, 1.47, d / 2 + 1.85, .045, 2.94, wood, g);
    const tableZ = streetZ + npc.side * 10.2;
    box(x + 1.7, 2.48, tableZ, 2, .13, .85, timber);
    for (const a of [-.8, .8]) for (const b of [-.3, .3]) box(x + 1.7 + a, 1.98, tableZ + b, .1, .95, .1, wood);
    obstacle(x + 1.7, tableZ, 2.1, .95);
    for (let i = 0; i < 3; i++) vessel(x + 1.1 + i * .55, 2.55, tableZ, world, npc.id === 'lin' ? .55 : .8);
    if (npc.id === 'acheng') {
      for (let k = 0; k < 3; k++) {
        const crate = box(x - 1.4, 1.75 + k * .5, tableZ, 1.2, .46, .85, timber);
        obstacle(crate.position.x, tableZ, 1.3, 1);
      }
    }
    npc.x = x; npc.z = streetZ + npc.side * 6.1;
    if (isBlocked(npc.x, npc.z)) {
      const point = findSpawn(npc.x, npc.z); if (point) [npc.x, npc.z] = point;
    }
    const actor = createCharacter({ robeColor: npc.robeColor, trimColor: npc.trimColor, hatStyle: npc.hatStyle, height: npc.id === 'lin' ? 1.66 : 1.76 });
    actor.group.position.set(npc.x, groundAt(npc.x, npc.z), npc.z); actor.group.rotation.y = npc.side < 0 ? 0 : Math.PI; world.add(actor.group);
    actors.push({ ...npc, actor, baseYaw: actor.group.rotation.y });
    return { x: x + 1.7, y: 3.02, z: tableZ };
  }
  let steamOrigin;
  for (const npc of NPCS) { const origin = makeShop({ ...npc }); if (npc.id === 'lin') steamOrigin = origin; }
  const warmLight = new THREE.PointLight('#ffd29c', 0, 13, 2); warmLight.position.set(actors[0].x, 4.2, actors[0].z); world.add(warmLight);
  const steamCanvas = document.createElement('canvas'); steamCanvas.width = steamCanvas.height = 64;
  const steamContext = steamCanvas.getContext('2d'), gradient = steamContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff85'); gradient.addColorStop(1, '#ffffff00'); steamContext.fillStyle = gradient; steamContext.fillRect(0, 0, 64, 64);
  const steamPositions = new Float32Array(24 * 3), steamGeo = new THREE.BufferGeometry(); steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3));
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(steamCanvas), transparent: true, opacity: .36, size: .3, depthWrite: false, color: '#f3eee0' }));
  steam.frustumCulled = false; world.add(steam);
  const pathGeo = new THREE.RingGeometry(.11, .19, 12).rotateX(-Math.PI / 2);
  const path = new THREE.InstancedMesh(pathGeo, new THREE.MeshBasicMaterial({ color: '#dfc17d', transparent: true, opacity: .8, depthWrite: false }), 48);
  path.count = 0; path.frustumCulled = false; world.add(path);
  const routeDummy = new THREE.Object3D();
  const parcel = new THREE.Group(); parcel.name = '手中的新焙茶包'; parcel.position.set(.29, -.4, -.75); parcel.rotation.set(.08, -.18, .04);
  const parcelCloth = surface('茶包麻布', '#d8c7a5');
  const fabricCanvas = document.createElement('canvas'); fabricCanvas.width = fabricCanvas.height = 128;
  const fabric = fabricCanvas.getContext('2d'); fabric.fillStyle = '#a39070'; fabric.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 3) {
    fabric.fillStyle = i % 2 ? '#b8a17d' : '#8c795d'; fabric.fillRect(i, 0, 1, 128);
    fabric.fillStyle = '#cab48d70'; fabric.fillRect(0, i, 128, 1);
  }
  const fabricMap = new THREE.CanvasTexture(fabricCanvas); fabricMap.colorSpace = THREE.SRGBColorSpace;
  fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping; fabricMap.repeat.set(2, 2);
  parcelCloth.map = fabricMap; parcelCloth.bumpMap = fabricMap; parcelCloth.bumpScale = .0007;
  box(0, 0, 0, .34, .23, .28, parcelCloth, parcel);
  for (const a of [-.1, .1]) box(a, 0, .145, .014, .24, .008, timber, parcel);
  box(0, 0, .15, .35, .012, .008, wood, parcel);
  plaque('茶', 0, .015, .158, .09, .09, parcel);
  parcel.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  parcel.visible = false; camera.add(parcel); if (!camera.parent) scene.add(camera);
  const projected = new THREE.Vector3();
  const pins = new Map();
  for (const npc of actors) {
    const pin = document.createElement('button'); pin.className = 'npc-pin'; pin.hidden = true; pin.setAttribute('aria-label', `与${npc.name}交谈`);
    const symbol = document.createElement('span'); symbol.className = 'pin-symbol'; const number = document.createElement('b'); number.textContent = String(actors.indexOf(npc) + 1).padStart(2, '0'); symbol.appendChild(number);
    const name = document.createElement('span'); name.textContent = npc.name; pin.append(symbol, name); $('npc-markers').appendChild(pin);
    pin.onclick = () => interact(npc.id); pins.set(npc.id, pin);
  }
  function currentTarget() { return actors.find(npc => npc.id === ({ meet: 'lin', collect: 'acheng', deliver: 'shen' })[state.stage]); }
  function save() {
    if (getMode() === 'walk') { const p = getPlayer(); state.position = { x: p.x, z: p.z, yaw: p.yaw }; }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); storageAvailable = true; }
    catch { storageAvailable = false; }
    $('save-status').textContent = storageAvailable ? '进度自动保存在本机' : '本机存储不可用，关闭页面后进度不会保留';
  }
  function toast(text) { $('quest-toast').textContent = text; $('quest-toast').hidden = false; toastTimer = 4.5; }
  function renderState() {
    $('quest-objective').textContent = OBJECTIVES[state.stage]; $('quest-coins').textContent = `${state.coins} 文`;
    $('journey-launch').textContent = state.started ? '继续 · 临安一日' : '启程 · 临安一日';
    $('goAdventure').textContent = state.started ? '继续临安一日' : '开启临安一日';
    $('quest-steps').replaceChildren(...STAGES.map((stage, i) => { const el = document.createElement('span'); el.classList.toggle('done', i <= STAGES.indexOf(state.stage)); return el; }));
    routeTimer = 0;
  }
  function activate() { active = true; state.started = true; document.body.classList.add('in-adventure'); $('quest-panel').hidden = false; $('journey-launch').hidden = true; }
  function start() {
    const p = active ? getPlayer() : state.position;
    activate();
    const first = actors[0];
    let point = p && !isBlocked(p.x, p.z) ? [p.x, p.z] : [wx(650), wz(700)];
    if (isBlocked(...point)) point = findSpawn(...point);
    if (point) {
      const facing = p ? [point[0] - Math.sin(p.yaw) * 8, point[1] - Math.cos(p.yaw) * 8] : [first.x, first.z];
      travel(point[0], point[1], facing);
    }
    renderState(); save();
  }
  function closeDialogue() { if (dialog.open) dialog.close(); document.body.classList.remove('in-dialog'); pause(false); }
  function change(action) {
    const next = advanceQuest(state, action); if (next === state) return false;
    state = next; renderState(); save(); return true;
  }
  function buttons(choices) {
    $('dialog-choices').replaceChildren();
    for (const [text, action] of choices) { const button = document.createElement('button'); button.textContent = text; button.onclick = action; $('dialog-choices').appendChild(button); }
    queueMicrotask(() => $('dialog-choices').querySelector('button')?.focus());
  }
  function speak(npc, text, choices) {
    $('dialog-name').textContent = npc.name; $('dialog-role').textContent = npc.role; $('dialog-place').textContent = npc.place;
    $('dialog-portrait').src = portraitUrl(npc.portrait); $('dialog-portrait').alt = `${npc.name}的虚构人物肖像`;
    $('dialog-text').textContent = text; buttons(choices);
    if (!dialog.open) { pause(true); face(npc.x, npc.z); dialog.showModal(); document.body.classList.add('in-dialog'); }
  }
  function dialogueFor(npc) {
    if (npc.id === 'lin') {
      if (state.stage === 'meet') {
        speak(npc, '客人，刚到临安吧？\n桥北的沈先生等着一包新焙茶饼，说是开讲前要点一盏好茶。你若愿意跑一趟，先去前面的清和茶栈找阿成领货，再沿御街过众安桥。脚钱三十文，少不了你的。', [
          ['这趟我来跑，接下委托', () => { if (change('accept')) toast('已接委托 · 去清和茶栈找阿成'); closeDialogue(); }],
          ['掌柜，临安有什么值得看看？', () => speak(npc, '你脚下就是御街。向北走，街坊、河桥与铺面一段接一段；众安桥那边还有瓦舍，可以听书看戏。\n这里的人物和这趟委托是虚构的，但你可以沿着这座城慢慢走。', [['我记下了，回到委托', () => dialogueFor(npc)], ['先去街上看看', closeDialogue]])],
          ['容我先逛一逛', closeDialogue],
        ]);
      } else if (state.stage === 'collect') speak(npc, '清和茶栈就在前面。找到阿成，报我的名字，他会把茶饼交给你。\n沿着路上的淡金色标记走就好；按住 Shift 可以疾行。', [['这就去找阿成', closeDialogue]]);
      else if (state.stage === 'deliver') speak(npc, '茶已经领到了？替我带一句：新茶刚焙好，点茶时先温盏。\n过众安桥，再往前走一点，就能见到沈先生。', [['茶包我会送到', closeDialogue]]);
      else speak(npc, '沈先生已经收到了，多谢你这一趟。\n一座城里的熟人，往往就是从这样一件小事开始的。下回走过茶坊，进来歇歇脚。', [['继续逛逛临安', closeDialogue], ['翻开我的见闻', () => { closeDialogue(); openJournal(); }]]);
    } else if (npc.id === 'acheng') {
      if (state.stage === 'collect') speak(npc, '林掌柜托你来的？这包就是新焙的茶饼，绳结我已扎牢。\n沿御街向北，走过众安桥，找桥北书舍的沈先生。别急，路上也可以看看河里的船。', [['接过茶包', () => { if (change('pickup')) toast('已装入行囊 · 新焙茶饼一包'); closeDialogue(); }], ['我先看看周围', closeDialogue]]);
      else if (state.stage === 'meet') speak(npc, '这批茶饼是春和茶坊订的。你若想帮忙，先去问问那边的林掌柜。\n她的茶坊就在朝天门外这段御街上。', [['去找林掌柜', closeDialogue]]);
      else speak(npc, state.stage === 'deliver' ? '茶包交给你了，往北走，过众安桥。绳结虽牢，路还是慢慢认。' : '送到了就好。今日又在临安多认识一位朋友。', [['多谢，回头见', closeDialogue]]);
    } else if (state.stage === 'deliver') {
      speak(npc, '是林掌柜的新茶到了？一路辛苦。\n我在桥边等了许久。河上的船南来北往，桥上的行人各有去处；你这一趟，也成了临安今日的一小段故事。', [['递上茶包，领取三十文脚钱', () => { if (change('deliver')) toast('委托完成 · 获得 30 文 · 解锁一则临安见闻'); dialogueFor(npc); }], ['先把茶包收好，待会儿再交', closeDialogue]]);
    } else if (state.stage === 'complete') {
      speak(npc, '茶收下了，三十文脚钱也交给你了。\n今日的委托到这里就算圆满。你可以去看西湖、逛街坊，或到北瓦听听市井的声音。\n下一段故事「北瓦听书」尚未开放，这座城已经可以自由游览。', [['收好脚钱，继续游览', closeDialogue], ['查看行囊与新见闻', () => { closeDialogue(); openJournal(); }]]);
    } else speak(npc, '我在等春和茶坊的新茶。\n若你是从朝天门那边过来的，帮我带句话给林掌柜：书已备好，就等茶香了。', [['我先沿街去看看', closeDialogue]]);
  }
  function interact(id) {
    if (dialog.open || journal.open) return false;
    const npc = id ? actors.find(n => n.id === id) : nearest;
    if (!npc) return false;
    const p = getPlayer(), distance = Math.hypot(p.x - npc.x, p.z - npc.z);
    if (getMode() !== 'walk' || distance > 3.4) { toast(`请先走近${npc.name}，再按 E 或点击交谈`); return false; }
    activate(); state = advanceQuest(state, `talk:${npc.id}`); renderState(); save(); dialogueFor(npc); return true;
  }
  function openJournal() {
    if (dialog.open) closeDialogue();
    $('journal-inventory').innerHTML = `<div class="inventory-item"><strong>${state.coins} 文</strong><small>委托脚钱</small></div><div class="inventory-item"><strong>${state.stage === 'deliver' ? '新焙茶饼 × 1' : '暂无携带货物'}</strong><small>${state.stage === 'deliver' ? '待交给众安桥北的沈先生' : state.stage === 'complete' ? '茶包已交付' : '接取委托后可领取茶包'}</small></div>`;
    $('journal-people').replaceChildren(...actors.map(npc => {
      const figure = document.createElement('figure'); figure.className = `journal-person${state.met.includes(npc.id) ? ' met' : ''}`;
      const img = document.createElement('img'); img.src = portraitUrl(npc.portrait); img.alt = `${npc.name}肖像`;
      const caption = document.createElement('figcaption'); caption.textContent = npc.name;
      const small = document.createElement('small'); small.textContent = state.met.includes(npc.id) ? npc.role : '尚未相识'; caption.appendChild(small); figure.append(img, caption); return figure;
    }));
    $('journal-story').textContent = state.stage === 'complete' ? '已解锁 · 一盏茶的来处：从御街茶坊，到茶栈伙计，再到众安桥北的说书人，一包茶把三个普通人的日子连在一起。临安的繁华，不只在宫阙与城墙，也在这样的日常往来里。' : '完成这回送茶委托，即可留下一则临安见闻。人物与故事为虚构，地图与地名沿用当前概念性复原。';
    pause(true); if (!journal.open) journal.showModal();
  }
  function closeJournal() { if (journal.open) journal.close(); pause(false); }
  $('goAdventure').onclick = start; $('journey-launch').onclick = start; $('journey-resume').onclick = start;
  $('interact-prompt').onclick = () => interact(); $('dialog-close').onclick = closeDialogue;
  $('journal-open').onclick = openJournal; $('journal-close').onclick = closeJournal;
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialogue(); });
  journal.addEventListener('cancel', event => { event.preventDefault(); closeJournal(); });
  $('quest-reset').onclick = () => {
    if (!confirm('重新体验本回委托？这会重置本机的委托、行囊与脚钱。')) return;
    closeJournal(); state = initialQuest(); active = false; start(); toast('新的一日 · 去春和茶坊问候林掌柜');
  };
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.started) save(); });
  function updateRoute(target, p) {
    path.count = 0; if (!active || getMode() !== 'walk' || !target) return;
    const nodes = [[p.x, p.z], [p.x, wz(700)], [target.x, wz(700)], [target.x, target.z]];
    let total = 0, next = 2;
    for (let s = 0; s < nodes.length - 1 && path.count < 48; s++) {
      const [ax, az] = nodes[s], [bx, bz] = nodes[s + 1], length = Math.hypot(bx - ax, bz - az);
      if (!length) continue;
      while (next <= total + length && path.count < 48) {
        const k = (next - total) / length, x = THREE.MathUtils.lerp(ax, bx, k), z = THREE.MathUtils.lerp(az, bz, k);
        if (!isBlocked(x, z)) {
          routeDummy.position.set(x, groundAt(x, z) + .1, z); routeDummy.updateMatrix(); path.setMatrixAt(path.count++, routeDummy.matrix);
        }
        next += 3;
      }
      total += length;
    }
    path.instanceMatrix.needsUpdate = true;
  }
  function update(dt, time, night) {
    const p = getPlayer(), walking = getMode() === 'walk', target = currentTarget();
    nearest = null; let best = 3.4;
    for (const npc of actors) {
      const distance = Math.hypot(p.x - npc.x, p.z - npc.z);
      npc.actor.group.visible = camera.position.distanceTo(npc.actor.group.position) < 220;
      if (npc.actor.group.visible) npc.actor.update(time, { lookYaw: walking && distance < 9 ? Math.atan2(p.x - npc.x, p.z - npc.z) : npc.baseYaw });
      if (walking && distance < best) { nearest = npc; best = distance; }
    }
    parcel.visible = active && walking && state.stage === 'deliver' && !dialog.open && !journal.open;
    parcel.scale.setScalar(innerWidth < 700 ? .68 : 1);
    parcel.position.x = innerWidth < 700 ? .12 : .29;
    parcel.position.y = -.4 + Math.sin(time * 5) * .006;
    steam.visible = camera.position.distanceTo(new THREE.Vector3(steamOrigin.x, steamOrigin.y, steamOrigin.z)) < 65;
    if (steam.visible) {
      for (let i = 0; i < 24; i++) {
        const life = (time * .33 + i / 24) % 1;
        steamPositions[i * 3] = steamOrigin.x + Math.sin(i * 2.4 + time) * life * .12;
        steamPositions[i * 3 + 1] = steamOrigin.y + life * .9;
        steamPositions[i * 3 + 2] = steamOrigin.z + Math.cos(i * 2.4 + time) * life * .12;
      }
      steamGeo.attributes.position.needsUpdate = true;
    }
    warmLight.intensity = night * 8; paper.emissiveIntensity = .2 + night * 2.5;
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('quest-toast').hidden = true; }
    routeTimer -= dt; if (routeTimer <= 0) { routeTimer = .25; updateRoute(target, p); }
    saveTimer += dt; if (saveTimer > 3 && active && walking && !dialog.open) { saveTimer = 0; save(); }
    uiTimer -= dt; if (uiTimer > 0) return; uiTimer = .06;
    $('journey-launch').hidden = active || !$('intro').hidden;
    $('journey-resume').hidden = walking || !active;
    $('interact-prompt').hidden = !nearest || dialog.open || journal.open || !$('intro').hidden;
    if (nearest) $('interact-label').textContent = `与${nearest.name}交谈`;
    const targetDistance = target ? Math.round(Math.hypot(p.x - target.x, p.z - target.z)) : 0;
    $('quest-distance').textContent = target ? `${targetDistance} 米 · ${target.name}` : '已完成 · 自由探索';
    const hudBottom = document.querySelector('.hud-top').getBoundingClientRect().bottom + 12;
    for (const npc of actors) {
      const pin = pins.get(npc.id); projected.copy(npc.actor.group.position); projected.y += 2.3; projected.project(camera);
      const x = (projected.x * .5 + .5) * innerWidth, y = (-projected.y * .5 + .5) * innerHeight;
      pin.hidden = !walking || projected.z < -1 || projected.z > 1 || x < 15 || x > innerWidth - 15 || y < hudBottom + 40 || y > innerHeight - 60 || camera.position.distanceTo(npc.actor.group.position) > 100 || dialog.open || journal.open;
      pin.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`; pin.classList.toggle('active', target?.id === npc.id);
    }
    const waypoint = $('quest-waypoint'); waypoint.hidden = !active || !target || dialog.open || journal.open;
    if (!waypoint.hidden) {
      projected.copy(target.actor.group.position); projected.y += 1.6; projected.project(camera);
      const behind = projected.z > 1, margin = 65;
      let x = (projected.x * .5 + .5) * innerWidth, y = (-projected.y * .5 + .5) * innerHeight;
      if (behind) { x = innerWidth / 2 + (x < innerWidth / 2 ? 1 : -1) * innerWidth; y = innerHeight * .6; }
      const edge = behind || x < margin || x > innerWidth - margin || y < hudBottom + 60 || y > innerHeight - 130;
      waypoint.classList.toggle('edge', edge); waypoint.textContent = `${target.name} · ${targetDistance} 米`;
      waypoint.hidden = walking && targetDistance < 12;
      waypoint.style.left = `${THREE.MathUtils.clamp(x, margin, innerWidth - margin)}px`;
      waypoint.style.top = `${THREE.MathUtils.clamp(y, hudBottom + 60, innerHeight - 130)}px`;
      waypoint.style.setProperty('--bearing', `${Math.atan2(y - innerHeight / 2, x - innerWidth / 2) * 180 / Math.PI + 45}deg`);
    }
  }
  renderState(); $('journey-launch').hidden = false;
  return {
    start, interact, openJournal, closeDialogue, update,
    get active() { return active; },
    get paused() { return dialog.open || journal.open; },
    isBlocked(x, z) { return actors.some(npc => Math.hypot(x - npc.x, z - npc.z) < .68) || obstacles.some(o => Math.abs(x - o.x) < o.w + .3 && Math.abs(z - o.z) < o.d + .3); },
    state: () => structuredClone(state),
    locations: () => actors.map(({ id, name, x, z }) => ({ id, name, x, z })),
  };
}
