/* =========================================================
   활동놀이 건물 안 (3단계)
   - 카메라와 동작 인식은 여기서만 다룹니다. 미션에는 행동 신호만 넘깁니다.
   - 화면 터치와 "했어요" 버튼도 같은 신호로 바꿔 넘깁니다.
   - 클리어 수와 기록은 이 기기 안(localStorage)에만 저장합니다.
   ========================================================= */
import { PoseEngine, fitRect } from '../lib/pose.js';
import { MISSIONS, createMission } from '../lib/missions.js';
import { loadProgress, saveProgress, resetProgress, missionRec, CLEAR_GOAL } from '../lib/progress.js';

const $ = s => document.querySelector(s);
const show = id => document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 몸 위치 칸 나누기 (어깨 중심 x, 거울 좌표) — 시작값
   가운데에서 옆 칸으로 가려면 화면 너비의 약 9%만 움직이면 됩니다 (전: 11%) */
const LANE = { left: .44, right: .56, hyst: .03 };
/* 사람 인식이 잠깐 끊겨도 이 시간 안에 보였으면 카메라로 정한 칸을 그대로 인정합니다 */
const CAMERA_GRACE_MS = 1000;
let lastReadyT = -1e9;

const video = $('#mVideo'), cv = $('#mCanvas'), g = cv.getContext('2d');
const bus = new EventTarget();
let eng = null, camWanted = null, lane = null;
let prog = loadProgress();
let onExit = null, cur = null, curM = null, rec = null, phase = 'off', dots = false;

/* ---------- 동작 인식 → 신호 ---------- */
export function preload() {
  if (eng) return;
  eng = new PoseEngine(video);
  eng.loadModel('GPU');
  eng.addEventListener('signal', e => emit({ ...e.detail, source: 'camera' }));
  eng.addEventListener('frame', () => {
    const x = eng.ready ? eng.bodyX : null;
    if (x == null) return;  // 잠깐 놓쳐도 마지막 칸은 유지합니다 (받을 때는 CAMERA_GRACE_MS 안에 보였는지 확인)
    lastReadyT = performance.now();
    // 지금 칸에 머무르는 쪽으로 경계를 조금 밀어 칸이 떨리지 않게 함
    const c = lane ?? 1, h = LANE.hyst;
    const lb = LANE.left + (c === 0 ? h : -h), rb = LANE.right + (c === 2 ? -h : h);
    const l = x < lb ? 0 : x > rb ? 2 : 1;
    if (l !== lane) { lane = l; emit({ type: 'lane', lane: l, source: 'camera' }); }
  });
}
function emit(sig) { bus.dispatchEvent(new CustomEvent('signal', { detail: sig })); }
bus.addEventListener('signal', e => { if (phase === 'action' && cur) cur.onSignal(e.detail); });
const cameraReady = () => !!eng && eng.st.cam === 'on' && (eng.ready || performance.now() - lastReadyT < CAMERA_GRACE_MS);

/* ---------- 입장 · 퇴장 ---------- */
export async function open(exitCb) {
  onExit = exitCb;
  preload();
  if (camWanted === null) { show('s-camguide'); return; }
  if (camWanted && eng.st.cam !== 'on') await eng.startCamera();
  renderSelect();
}
$('#btnCamOn').onclick = async () => { camWanted = true; $('#btnCamOn').disabled = true; await eng.startCamera(); $('#btnCamOn').disabled = false; renderSelect(); };
$('#btnCamOff').onclick = () => { camWanted = false; renderSelect(); };
$('#btnToVillage').onclick = () => { if (eng) eng.stopCamera(); phase = 'off'; onExit && onExit(); };
$('#btnReset').onclick = () => {
  if (!confirm('이 기기에 저장된 클리어 수와 기록을 지웁니다.')) return;
  prog = resetProgress(); renderSelect();
};

/* ---------- 미션 선택 ---------- */
function bar(el) {
  const n = Math.min(prog.total, CLEAR_GOAL);
  el.querySelector('i').style.width = (n / CLEAR_GOAL * 100) + '%';
  el.querySelector('span').textContent = `클리어 ${prog.total} / ${CLEAR_GOAL}`;
}
function renderSelect() {
  phase = 'select';
  show('s-select');
  bar($('#selBar'));
  $('#selUnlock').hidden = prog.total < CLEAR_GOAL;
  $('#missionList').innerHTML = MISSIONS.map(m => {
    const r = missionRec(prog, m.id);
    return `<button class="mcard" data-id="${m.id}">
      <div class="micon">${m.icon}</div>
      <div class="mtitle">${m.no} ${m.title}</div>
      <div class="mhow">${m.how}</div>
      <div class="mlv">${r.level}단계</div>
      <div class="mstat">클리어 ${r.clears} · 인식 성공 ${r.camera} · 했어요 ${r.manual} · 터치 ${r.touch}</div>
    </button>`;
  }).join('');
  $('#missionList').querySelectorAll('.mcard').forEach(b => b.onclick = () => startMission(MISSIONS.find(m => m.id === b.dataset.id)));
  $('#selCam').textContent = camWanted ? (eng && eng.st.cam === 'on' ? '카메라 켜짐' : '카메라 꺼짐 · ' + (eng && eng.st.camError || '')) : '카메라 없이 진행 중 (화면 터치 · "했어요" 버튼)';
}

/* ---------- 미션: 이동(동작) ---------- */
const api = {
  setTargets: list => eng && eng.setTargets(list),
  progress: (got, goal, source) => {
    $('#mGoal').textContent = `${curM.icon} ${got} / ${goal}`;
    if (source) { rec[source] = (rec[source] || 0) + 1; saveProgress(prog); }
    stats();
  },
  finish: r => afterAction(r),
  cameraReady,
  lane: () => lane,
  aspect: () => (video.videoWidth / video.videoHeight) || 4 / 3,
};

function startMission(m) {
  curM = m; rec = missionRec(prog, m.id);
  cur = createMission(m, rec.level, api);
  $('#mTitle').textContent = `${m.no} ${m.title} · ${rec.level}단계`;
  $('#mHow').textContent = m.how;
  bar($('#mBar'));
  show('s-mission');
  phase = 'action';
  cur.start();
  last = performance.now();
  requestAnimationFrame(loop);
}
$('#btnQuit').onclick = () => { phase = 'select'; if (eng) eng.setTargets([]); renderSelect(); };
$('#btnDid').onclick = () => { if (phase === 'action' && cur) cur.manual(); };
$('#btnDots').onclick = () => { dots = !dots; $('#btnDots').textContent = dots ? '점 켜짐' : '점 꺼짐'; };

cv.addEventListener('pointerdown', e => {
  if (phase !== 'action' || !cur) return;
  const R = rect();
  const x = (e.offsetX * dpr() - R.x) / R.w, y = (e.offsetY * dpr() - R.y) / R.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  const sig = cur.tap(x, y);
  if (sig) emit(sig);
});

const dpr = () => Math.min(2, window.devicePixelRatio || 1);
function rect() {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  return fitRect(cv.width, cv.height, vw, vh, 'contain');
}

let last = 0;
function loop(now) {
  if (phase !== 'action') return;
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const w = Math.round(cv.clientWidth * dpr()), h = Math.round(cv.clientHeight * dpr());
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  cur.update(dt);
  g.clearRect(0, 0, cv.width, cv.height);
  const R = rect();
  if (!eng || eng.st.cam !== 'on') { g.fillStyle = '#26324a'; g.fillRect(R.x, R.y, R.w, R.h); }
  cur.draw(g, R);
  if (dots && eng && eng.lm) drawDots(R);
  status();
}
function drawDots(R) {
  const L = eng.lm, d = dpr();
  for (const i of [11, 12, 15, 16]) {
    g.fillStyle = L[i].v < eng.s.visMin ? 'rgba(255,122,122,.7)' : (i >= 15 ? '#ffc93c' : '#fff');
    g.beginPath(); g.arc(R.x + L[i].x * R.w, R.y + L[i].y * R.h, (i >= 15 ? 12 : 8) * d, 0, Math.PI * 2); g.fill();
  }
}

let stT = 0;
function status() {
  const now = performance.now();
  if (now - stT < 250) return; stT = now;
  const st = eng ? eng.st : null;
  let why = '';
  if (!camWanted) why = '카메라 없이 진행 중입니다';
  else if (!st || st.cam !== 'on') why = (st && st.camError) || '카메라가 꺼져 있습니다';
  else if (st.model === 'fail') why = '동작 인식을 불러오지 못했습니다';
  else if (st.model !== 'on') why = '동작 인식을 준비하는 중입니다';
  else if (!eng.lm || !eng.ready) why = st.guide || '사람이 인식되지 않습니다';
  $('#mWhy').textContent = why ? `인식 안 됨: ${why}` : '';
  $('#mWhy').hidden = !why;
  const showGuide = camWanted && st && st.cam === 'on' && st.model === 'on' && st.guide;
  $('#mGuide').textContent = st ? st.guide : ''; $('#mGuide').hidden = !showGuide;
  stats();
}
function stats() {
  if (!rec) return;
  const st = eng ? eng.st : null;
  $('#mStats').innerHTML = `<b>${curM.title}</b> 인식 성공 ${rec.camera} · 했어요 ${rec.manual} · 터치 ${rec.touch}` +
    (st ? `<br>카메라 ${st.cam} · 모델 ${st.model}${st.delegate ? '(' + st.delegate + ')' : ''} · 사람 ${st.people} · 인식 ${st.fps}fps` : '');
}

/* ---------- 말하기 → 완료 → 미션 선택 ---------- */
async function afterAction(result) {
  if (phase !== 'action') return;
  phase = 'words';
  if (eng) eng.setTargets([]);
  show('s-words');
  for (const w of curM.words(result)) {
    $('#wordText').textContent = w;
    $('#wordText').style.color = (curM.wordColor && curM.wordColor(w)) || '#173049';
    $('#wordText').classList.remove('pop'); void $('#wordText').offsetWidth; $('#wordText').classList.add('pop');
    await speak(w);
    await sleep(600);
  }
  // 완료
  rec.clears++;
  rec.level = Math.min(rec.level + 1, curM.levels.length);
  prog.total++;
  saveProgress(prog);
  phase = 'done';
  show('s-done');
  bar($('#doneBar'));
  $('#doneUnlock').hidden = prog.total < CLEAR_GOAL;
  await sleep(3000);
  if (phase === 'done') renderSelect();
}

function speak(word) {
  return new Promise(res => {
    const synth = window.speechSynthesis;
    if (!synth) return setTimeout(res, 1200);
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US'; u.rate = .85;
      const v = synth.getVoices().find(v => /en[-_]US/i.test(v.lang));
      if (v) u.voice = v;
      u.onend = fin; u.onerror = fin;
      synth.speak(u);
    } catch (e) { fin(); }
    setTimeout(fin, 3500);
  });
}
