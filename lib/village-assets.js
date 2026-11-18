/* =========================================================
   노리나루마을 모양 교체 지점
   - 지금은 모두 임시 도형입니다.
   - 아래 MODELS에 .glb 파일 경로를 넣으면 그 자리만 3D 모델로 바뀝니다.
     이동·입장·카메라 같은 동작 코드는 고치지 않아도 됩니다.
   - 모델을 불러오지 못하면 임시 도형으로 대신 그리고, 이유를 ASSET_ERRORS에 남깁니다.

   모델 파일 규칙
   - 형식: glTF 바이너리(.glb). 바닥(발)이 y=0, 앞쪽이 +z 방향.
   - 건물은 문이 +z 쪽에 오게 만듭니다. (마을이 건물의 +z를 광장 쪽으로 돌려 세웁니다)
   - 캐릭터 애니메이션이 있으면 이름에 idle / walk가 들어가게 합니다.
   - 아이패드 30fps를 위해 가볍게: 캐릭터 1만 삼각형 이하, 건물 5천 이하, 텍스처 1024px 이하 권장.
   - 공개 저장소이므로 Brown Teacher 등 원본 캐릭터 모델은 여기 넣지 않습니다.
   ========================================================= */

export const MODELS = {
  player: null,            // 예: { url: '../assets/player.glb', scale: 1, y: 0, rotY: 0 }  (url은 village/ 페이지 기준)
  npc: null,               // 안내 NPC
  buildings: {             // 건물 id별
    activity: null, science: null, math: null, music: null, video: null,
  },
  tree: null,
};

export const ASSET_ERRORS = [];

let loaderP = null;
async function loadModel(THREE, spec) {
  if (!loaderP) loaderP = import('./three/addons/loaders/GLTFLoader.js').then(m => new m.GLTFLoader());
  const loader = await loaderP;
  const url = new URL(spec.url, document.baseURI).href;
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  root.scale.setScalar(spec.scale ?? 1);
  root.position.y = spec.y ?? 0;
  root.rotation.y = spec.rotY ?? 0;
  const wrap = new THREE.Group();
  wrap.add(root);
  return { wrap, gltf };
}
async function tryModel(THREE, name, spec) {
  if (!spec) return null;
  try { return await loadModel(THREE, spec); }
  catch (e) { ASSET_ERRORS.push(`${name}: ${e && e.message || e}`); return null; }
}

const lam = (THREE, c, o = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o });

/* 캐릭터 공통: { root, update(dt, t, moving) } */
function animated(THREE, wrap, gltf) {
  const mixer = new THREE.AnimationMixer(wrap);
  const find = re => gltf.animations.find(a => re.test(a.name));
  const idle = find(/idle/i) || gltf.animations[0], walk = find(/walk|run/i);
  const aIdle = idle && mixer.clipAction(idle), aWalk = walk && mixer.clipAction(walk);
  if (aIdle) aIdle.play();
  let cur = aIdle;
  return {
    root: wrap,
    update(dt, t, moving) {
      const want = moving && aWalk ? aWalk : aIdle;
      if (want && want !== cur) { want.reset().fadeIn(.2).play(); cur && cur.fadeOut(.2); cur = want; }
      mixer.update(dt);
    },
  };
}
function bobbing(root, parts) {
  parts.forEach(m => m.userData.y0 = m.position.y);
  return {
    root,
    update(dt, t, moving) {
      const bob = moving ? Math.abs(Math.sin(t * 12)) * .15 : 0;
      parts.forEach(m => m.position.y = m.userData.y0 + bob);
    },
  };
}
function blobShadow(THREE, r = .7) {
  const s = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .2 }));
  s.rotation.x = -Math.PI / 2; s.position.y = .02;
  return s;
}

/* ---------- 내 캐릭터 ---------- */
export async function createPlayer(THREE) {
  const m = await tryModel(THREE, 'player', MODELS.player);
  if (m) { m.wrap.add(blobShadow(THREE)); return animated(THREE, m.wrap, m.gltf); }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.45, .6, 1.2, 12), lam(THREE, 0x3c8dff)); body.position.y = .6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.45, 14, 10), lam(THREE, 0xffd9b3)); head.position.y = 1.55;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.12, .3, 6), lam(THREE, 0xff7a5a)); nose.position.set(0, 1.55, .48); nose.rotation.x = Math.PI / 2;
  g.add(body, head, nose, blobShadow(THREE));
  return bobbing(g, [body, head, nose]);
}

/* ---------- 안내 NPC ---------- */
export async function createNpc(THREE) {
  const m = await tryModel(THREE, 'npc', MODELS.npc);
  if (m) { m.wrap.add(blobShadow(THREE, .8)); return animated(THREE, m.wrap, m.gltf); }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(.75, 1.8, 10), lam(THREE, 0x9b6bd6)); body.position.y = .9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.45, 14, 10), lam(THREE, 0xffe0c2)); head.position.y = 2.05;
  g.add(body, head);
  return bobbing(g, []);
}

/* ---------- 건물 ---------- */
// def: { id, open, size:[w,h,d], body, roof }  → 문은 +z 쪽
export async function createBuilding(THREE, def) {
  const m = await tryModel(THREE, 'building ' + def.id, MODELS.buildings[def.id]);
  if (m) return m.wrap;
  const [w, h, dep] = def.size;
  const g = new THREE.Group();
  const bodyC = def.open ? def.body : 0xc3c7cc, roofC = def.open ? def.roof : 0x8d939b;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), lam(THREE, bodyC)); body.position.y = h / 2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, dep) * 0.78, 2.4, 4), lam(THREE, roofC));
  roof.position.y = h + 1.2; roof.rotation.y = Math.PI / 4; roof.scale.z = dep / w;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.2), lam(THREE, def.open ? 0x7a4a2a : 0x6c7178));
  door.position.set(0, 1.1, dep / 2 + 0.05);
  g.add(body, roof, door);
  return g;
}

/* ---------- 나무 ---------- */
export async function createTrees(THREE, positions) {
  const m = await tryModel(THREE, 'tree', MODELS.tree);
  const g = new THREE.Group();
  if (m) {
    for (const [x, z] of positions) { const c = m.wrap.clone(); c.position.set(x, 0, z); g.add(c); }
    return g;
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.25, .3, 1.2, 6), lam(THREE, 0x8a5a35), positions.length);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 2.8, 7), lam(THREE, 0x3f9d4f), positions.length);
  const m4 = new THREE.Matrix4();
  positions.forEach(([x, z], i) => {
    trunk.setMatrixAt(i, m4.makeTranslation(x, .6, z));
    crown.setMatrixAt(i, m4.makeTranslation(x, 2.4, z));
  });
  g.add(trunk, crown);
  return g;
}

/* ---------- 땅·광장 ---------- */
export function createGround(THREE) {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 40), lam(THREE, 0x8fd16a));
  ground.rotation.x = -Math.PI / 2;
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32), lam(THREE, 0xf3e2b8));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01;
  return { ground, plaza, pathMaterial: lam(THREE, 0xf3e2b8) };
}

/* ---------- 이름표 ---------- */
export function createLabel(THREE, text, { bg = 'rgba(255,255,255,.95)', fg = '#173049', w = 3.6 } = {}) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 112;
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.beginPath(); g.roundRect ? g.roundRect(4, 4, 312, 104, 40) : g.rect(4, 4, 312, 104); g.fill();
  g.fillStyle = fg; g.font = '800 54px -apple-system,"Apple SD Gothic Neo",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 160, 60);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(w, w * 112 / 320, 1); sp.renderOrder = 10;
  return sp;
}
