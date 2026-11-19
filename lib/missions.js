/* =========================================================
   활동놀이 미션 (3단계 시험)
   - 미션 코드는 카메라를 직접 다루지 않습니다. 행동 신호만 받습니다.
       { type: 'touch', id, source }   목표를 손으로 터치
       { type: 'lane',  lane, source } 몸 위치 칸 (0 왼쪽 · 1 가운데 · 2 오른쪽)
       { type: 'wave',  source }       손 흔들기
     source: 'camera'(동작 인식) | 'touch'(화면 터치) | 'manual'("했어요" 버튼)
   - 동작 유형은 템플릿(touch · catch · wave)으로 만들고,
     미션은 대상(그림)과 영어 단어, 단계별 숫자만 정합니다.
   - 모든 미션: 선택 → 이동(동작) → 말하기(단어 보여 주고 읽어 주기, 판정 없음) → 완료
   - 좌표는 카메라 화면 기준 거울 좌표 (x 왼쪽 0 → 오른쪽 1, y 위 0 → 아래 1)
   ========================================================= */


export const COLORS = {
  red:    { hex: '#ff4d5e', en: 'Red' },
  blue:   { hex: '#3c8dff', en: 'Blue' },
  yellow: { hex: '#ffcf33', en: 'Yellow' },
  green:  { hex: '#37c26b', en: 'Green' },
  purple: { hex: '#a86bff', en: 'Purple' },
};
const NUM = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const uniq = a => [...new Set(a)];

/* ---------- 미션 목록: 대상 · 영어 단어 · 단계만 바꿔 씁니다 ---------- */
export const MISSIONS = [
  {
    id: 'balloon', no: '01', title: '풍선 모으기', icon: '🎈', template: 'touch',
    how: '손을 뻗어 떠 있는 풍선을 터치',
    item: { kind: 'balloon' },
    levels: [
      { count: 3, riseSec: 9,   onScreen: 1, colors: ['red'] },
      { count: 4, riseSec: 8,   onScreen: 2, colors: ['red', 'blue'] },
      { count: 5, riseSec: 7,   onScreen: 2, colors: ['red', 'blue', 'yellow'] },
      { count: 6, riseSec: 6,   onScreen: 3, colors: ['red', 'blue', 'yellow', 'green'] },
      { count: 7, riseSec: 5.5, onScreen: 3, colors: ['red', 'blue', 'yellow', 'green', 'purple'] },
    ],
    words: r => ['Balloon', ...uniq(r.collected).map(c => COLORS[c].en)],
    wordColor: w => (Object.values(COLORS).find(c => c.en === w) || {}).hex,
  },
  {
    id: 'candy', no: '02', title: '캔디 받기', icon: '🍬', template: 'catch',
    how: '몸을 좌우로 움직여 떨어지는 캔디 받기',
    item: { emoji: '🍬' },
    levels: [
      { count: 3, fallSec: 5 },
      { count: 4, fallSec: 4.3 },
      { count: 5, fallSec: 3.7 },
      { count: 6, fallSec: 3.2 },
      { count: 7, fallSec: 2.8 },
    ],
    words: r => ['Candy', ...NUM.slice(0, r.got)],
  },
  {
    id: 'greet', no: '03', title: '인사하기', icon: '👋', template: 'wave',
    how: '손을 흔들며 인사',
    item: { greetings: ['Hello!', 'Hi!'] },
    levels: [{ count: 2 }, { count: 3 }, { count: 4 }, { count: 5 }, { count: 6 }],
    words: () => ['Hello', 'Hi'],
  },
];

export function levelOf(m, level) { return m.levels[Math.min(level, m.levels.length) - 1]; }

/* ---------- 템플릿 공통 ---------- */
class Base {
  constructor(m, lv, api) {
    this.m = m; this.lv = lv; this.api = api;
    this.goal = lv.count; this.got = 0; this.done = false;
    this.src = { camera: 0, touch: 0, manual: 0 };
    this.collected = [];
    this.fx = [];
    this.t = 0;
  }
  start() { this.api.progress(0, this.goal); }
  credit(source, x, y, text, color) {
    if (this.done) return;
    this.src[source] = (this.src[source] || 0) + 1;
    this.got++;
    this.api.progress(this.got, this.goal, source);
    this.fx.push({ x, y, text: text || '+1', color: color || '#ffe14d', t: 0 });
    if (this.got >= this.goal) {
      this.done = true;
      this.api.setTargets([]);
      setTimeout(() => this.api.finish(this.result()), 900);
    }
  }
  result() { return { got: this.got, goal: this.goal, src: this.src, collected: this.collected }; }
  update(dt) {
    this.t += dt;
    this.fx.forEach(f => { f.t += dt; f.y -= dt * .12; });
    this.fx = this.fx.filter(f => f.t < 1);
  }
  drawFx(g, R) {
    for (const f of this.fx) {
      g.globalAlpha = 1 - f.t;
      text(g, f.text, R.x + f.x * R.w, R.y + f.y * R.h, R.h * .09, f.color);
    }
    g.globalAlpha = 1;
  }
}
function text(g, s, x, y, size, color) {
  g.font = `900 ${size}px -apple-system,"Apple SD Gothic Neo",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = size * .14; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(s, x, y);
  g.fillStyle = color; g.fillText(s, x, y);
}

/* ---------- 템플릿 1: 손 뻗어 터치 (떠오르는 대상) ---------- */
const TOUCH_TOP = .62;  // 이 높이보다 위로 떠올라야 터치할 수 있음 (가만히 내린 손에 닿지 않게)
class TouchTemplate extends Base {
  start() { super.start(); this.items = []; this.n = 0; this.spawnT = .3; }
  spawn() {
    const cs = this.lv.colors;
    const c = cs[Math.floor(Math.random() * cs.length)];
    let x;
    for (let k = 0; k < 8; k++) { x = .12 + Math.random() * .76; if (this.items.every(i => Math.abs(i.x - x) > .15)) break; }
    this.items.push({ id: 'i' + (++this.n), x, y: 1.12, c, vy: 1.3 / this.lv.riseSec, ph: Math.random() * 6, r: .085 });
  }
  update(dt) {
    super.update(dt);
    if (!this.done) {
      this.spawnT -= dt;
      if (this.items.length < this.lv.onScreen && this.spawnT <= 0) { this.spawn(); this.spawnT = 1.4; }
    }
    for (const i of this.items) { i.y -= i.vy * dt; i.dx = Math.sin(this.t * 1.6 + i.ph) * .02; }
    this.items = this.items.filter(i => i.y > -.15);
    if (!this.done) this.api.setTargets(this.items.filter(i => i.y < TOUCH_TOP).map(i => ({ id: i.id, x: i.x + i.dx, y: i.y, r: i.r * 1.25 })));
  }
  pop(item, source) {
    this.items = this.items.filter(i => i !== item);
    this.collected.push(item.c);
    this.credit(source, item.x + item.dx, item.y, COLORS[item.c].en + '!', COLORS[item.c].hex);
  }
  onSignal(s) {
    if (s.type !== 'touch' || this.done) return;
    const it = this.items.find(i => i.id === s.id);
    if (it) this.pop(it, s.source);
  }
  tap(x, y) {
    const a = this.api.aspect();
    const it = this.items.find(i => Math.hypot((x - i.x - i.dx) * a, y - i.y) < i.r * 1.4);
    return it ? { type: 'touch', id: it.id, source: 'touch' } : null;
  }
  manual() {
    if (this.done) return;
    const it = this.items.slice().sort((a, b) => a.y - b.y)[0];
    if (it) this.pop(it, 'manual');
    else { const c = this.lv.colors[0]; this.collected.push(c); this.credit('manual', .5, .4, COLORS[c].en + '!', COLORS[c].hex); }
  }
  draw(g, R) {
    for (const i of this.items) {
      const x = R.x + (i.x + i.dx) * R.w, y = R.y + i.y * R.h, ry = i.r * R.h, rx = ry * .85;
      const reach = i.y < TOUCH_TOP;
      g.globalAlpha = reach ? 1 : .55;
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y + ry); g.quadraticCurveTo(x - rx * .4, y + ry * 1.8, x, y + ry * 2.6); g.stroke();
      g.fillStyle = COLORS[i.c].hex;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.beginPath(); g.ellipse(x - rx * .35, y - ry * .35, rx * .22, ry * .3, -.5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    this.drawFx(g, R);
  }
}

/* ---------- 템플릿 2: 좌우로 움직여 받기 (떨어지는 대상) ---------- */
const LANES = [.2, .5, .8];
const CATCH_FROM = .7, CATCH_TO = .95;  // 받는 구간 (화면 높이 비율). 바구니는 .9
class CatchTemplate extends Base {
  start() {
    super.start();
    const l = this.api.lane();
    this.lane = l ?? 1; this.laneSrc = l != null ? 'camera' : 'none';
    this.item = null; this.wait = .8; this.drop = [];
  }
  next() {
    let lane = Math.floor(Math.random() * 3);
    if (lane === this.lane && Math.random() < .7) lane = (lane + 1 + Math.floor(Math.random() * 2)) % 3;
    this.item = { lane, y: -.08 };
  }
  update(dt) {
    super.update(dt);
    if (this.done) return;
    if (!this.item) { this.wait -= dt; if (this.wait <= 0) this.next(); return; }
    this.item.y += dt / this.lv.fallSec;
    // 받는 구간: 캔디가 바구니 근처(CATCH_FROM ~ CATCH_TO)에 있는 동안 같은 칸이면 받은 것으로 셉니다.
    // 한 순간만 보면 조금 늦게 도착한 아이가 놓치기 쉬워 구간으로 봅니다.
    if (this.item.y >= CATCH_FROM) {
      const ok = this.item.lane === this.lane &&
        ((this.laneSrc === 'camera' && this.api.cameraReady()) || this.laneSrc === 'touch');
      if (ok) this.catch(this.laneSrc);
      else if (this.item.y >= CATCH_TO) { this.drop.push({ ...this.item, t: 0 }); this.item = null; this.wait = .6; }
    }
    this.drop.forEach(d => { d.t += dt; d.y += dt * .6; });
    this.drop = this.drop.filter(d => d.t < .5);
  }
  catch(source) {
    const n = this.got + 1;
    this.credit(source, LANES[this.item.lane], .72, ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][n - 1] + '!');
    this.item = null; this.wait = .7;
  }
  onSignal(s) { if (s.type === 'lane') { this.lane = s.lane; this.laneSrc = s.source; } }
  tap(x) { return { type: 'lane', lane: x < 1 / 3 ? 0 : x < 2 / 3 ? 1 : 2, source: 'touch' }; }
  manual() {
    if (this.done) return;
    if (!this.item) this.next();
    this.lane = this.item.lane; this.laneSrc = 'manual';
    this.catch('manual');
  }
  draw(g, R) {
    // 칸 표시
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 3; i++) if (i === 1) g.fillRect(R.x + R.w / 3, R.y, R.w / 3, R.h);
    // 바구니
    const bx = R.x + LANES[this.lane] * R.w, by = R.y + .9 * R.h, bw = R.w * .2, bh = R.h * .09;
    g.fillStyle = '#c98a4b'; g.strokeStyle = '#7a4a22'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(bx - bw / 2, by - bh / 2); g.lineTo(bx + bw / 2, by - bh / 2); g.lineTo(bx + bw * .38, by + bh / 2); g.lineTo(bx - bw * .38, by + bh / 2); g.closePath(); g.fill(); g.stroke();
    const size = R.h * .12;
    g.font = `${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (this.item) g.fillText(this.m.item.emoji, R.x + LANES[this.item.lane] * R.w, R.y + this.item.y * R.h);
    for (const d of this.drop) { g.globalAlpha = 1 - d.t * 2; g.fillText(this.m.item.emoji, R.x + LANES[d.lane] * R.w, R.y + d.y * R.h); }
    g.globalAlpha = 1;
    this.drawFx(g, R);
  }
}

/* ---------- 템플릿 3: 손 흔들기 ---------- */
const NPC = { x: .84, y: .55 };
class WaveTemplate extends Base {
  start() { super.start(); this.last = -9; this.bubble = null; }
  onSignal(s) {
    if (s.type !== 'wave' || this.done) return;
    if (this.t - this.last < .9) return;
    this.last = this.t;
    const words = this.m.item.greetings;
    this.bubble = { text: words[this.got % words.length], t: 0 };
    this.credit(s.source, NPC.x - .12, NPC.y - .3);
  }
  tap(x, y) { return Math.hypot((x - NPC.x) * this.api.aspect(), y - NPC.y) < .22 ? { type: 'wave', source: 'touch' } : null; }
  manual() { this.last = -9; this.onSignal({ type: 'wave', source: 'manual' }); }
  update(dt) { super.update(dt); if (this.bubble) { this.bubble.t += dt; if (this.bubble.t > 1.6) this.bubble = null; } }
  draw(g, R) {
    const x = R.x + NPC.x * R.w, y = R.y + NPC.y * R.h, u = R.h * .1;
    // 임시 인사 상대 (단순 도형)
    g.fillStyle = '#9b6bd6';
    g.beginPath(); g.moveTo(x, y - u * .6); g.lineTo(x + u * 1.1, y + u * 2.4); g.lineTo(x - u * 1.1, y + u * 2.4); g.closePath(); g.fill();
    g.fillStyle = '#ffe0c2'; g.beginPath(); g.arc(x, y - u, u * .75, 0, Math.PI * 2); g.fill();
    const wave = this.bubble ? Math.sin(this.t * 14) * .5 : 0;
    g.save(); g.translate(x + u * 1.2, y - u * .2); g.rotate(wave);
    g.font = `${u * 1.1}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('👋', 0, 0); g.restore();
    if (this.bubble) {
      const bx = x - u * 1.6, by = y - u * 2.6;
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(bx, by, u * 1.7, u * .8, 0, 0, Math.PI * 2); g.fill();
      text(g, this.bubble.text, bx, by, u * .7, '#3c2a7a');
    }
    this.drawFx(g, R);
  }
}

const TEMPLATES = { touch: TouchTemplate, catch: CatchTemplate, wave: WaveTemplate };
export function createMission(m, level, api) { return new TEMPLATES[m.template](m, levelOf(m, level), api); }
