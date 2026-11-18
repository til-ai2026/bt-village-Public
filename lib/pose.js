/* =========================================================
   BT 시험용 동작 인식 모듈 (MediaPipe Pose Landmarker)
   - 카메라 영상은 이 브라우저 안에서만 씁니다. 저장·전송하지 않습니다.
   - 화면 픽셀 변화량은 쓰지 않고, 관절 좌표로만 판정합니다.
   - 관절 인식이 준비되지 않았으면 어떤 신호도 내지 않습니다.
   - 좌표는 모두 "거울 좌표"입니다 (x: 화면에 보이는 왼쪽 0 → 오른쪽 1, y: 위 0 → 아래 1).
   신호(이벤트 'signal'):
     { type: 'raise', side }            손 들기
     { type: 'touch', id, side }        손 뻗어 터치 (setTargets로 등록한 목표)
     { type: 'move',  dir }             좌우 이동 (dir: 'left' | 'right', 화면 기준)
     { type: 'wave',  side }            손 흔들기
   ========================================================= */

const HERE = new URL('.', import.meta.url).href;
const SOURCES = {
  local: {
    bundle: HERE + 'mediapipe/vision_bundle.mjs',
    wasm: HERE + 'mediapipe/wasm',
    model: HERE + 'models/pose_landmarker_lite.task',
  },
  cdn: {
    bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
};

/* 판정 기준 시작값 (화면에서 조절) */
export const DEFAULTS = {
  visMin: 0.5,          // 관절을 믿을 최소 visibility
  stableFrames: 5,      // 사람이 이만큼 연속으로 보여야 판정 시작
  raiseRatio: 0.3,      // 손 들기: 손목이 어깨보다 (어깨너비 × 이 값) 이상 위
  raiseFrames: 6,       // 손 들기: 연속 프레임
  touchRadius: 0.09,    // 손 뻗어 터치: 목표 반지름 (화면 높이 비율)
  touchFrames: 2,       // 손 뻗어 터치: 목표 안 연속 프레임
  moveDist: 0.12,       // 좌우 이동: 어깨 중심 이동 거리 (화면 너비 비율)
  moveFrames: 3,        // 좌우 이동: 연속 프레임
  waveAmp: 0.2,         // 손 흔들기: 한 번 흔드는 최소 폭 (어깨너비 배수)
  waveReversals: 2,     // 손 흔들기: 방향이 바뀐 횟수
  waveWindowMs: 1500,   // 손 흔들기: 이 시간 안에
  cooldownMs: 800,      // 같은 신호를 다시 내기까지 쉬는 시간
};

const IDX = { sL: 11, sR: 12, eL: 13, eR: 14, wL: 15, wR: 16 };

export class PoseEngine extends EventTarget {
  constructor(video, settings = {}) {
    super();
    this.video = video;
    this.s = { ...DEFAULTS, ...settings };
    this.delegate = 'GPU';
    this.landmarker = null;
    this.vision = null;
    this.files = null;
    this.src = null;
    this.targets = [];
    this.lm = null;               // 마지막 거울 좌표 관절 (없으면 null)
    this.st = {
      cam: 'off', camError: '',
      model: 'off', modelSrc: '', delegate: '',
      people: 0, fps: 0, frames: 0, detectErrors: 0,
      lastError: '', log: [],
      guide: '',
      t: { modelStart: 0, modelReady: 0, camReady: 0, firstPose: 0 },
    };
    this._lastTs = 0;
    this._lastVT = -1;
    this._stable = 0;
    this._fpsN = 0; this._fpsT = performance.now();
    this._errRun = 0;
    this._raise = { L: 0, R: 0, latchL: false, latchR: false };
    this._move = { anchor: null, n: 0, dir: '' };
    this._wave = { L: [], R: [] };
    this._cool = {};
    this._running = false;
  }

  set(settings) { Object.assign(this.s, settings); }
  /* 목표는 매 프레임 다시 넣어도 됩니다 (같은 id는 연속 프레임 수를 이어 셉니다) */
  setTargets(list) {
    const prev = new Map(this.targets.map(t => [t.id, t._n]));
    this.targets = list.map(t => ({ ...t, _n: prev.get(t.id) || 0 }));
  }

  /* 사람이 화면에 보여 판정 가능한 상태인지 */
  get ready() { return this.st.cam === 'on' && this.st.model === 'on' && this._stable >= this.s.stableFrames; }

  /* 몸 중심(어깨 중심) 거울 x 좌표. 없으면 null */
  get bodyX() {
    const L = this.lm; if (!L || !this._ok(L, IDX.sL) || !this._ok(L, IDX.sR)) return null;
    return (L[IDX.sL].x + L[IDX.sR].x) / 2;
  }

  _logErr(msg) {
    this.st.lastError = msg;
    this.st.log.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
    if (this.st.log.length > 8) this.st.log.shift();
    this._emitStatus();
  }
  _emitStatus() { this.dispatchEvent(new CustomEvent('status', { detail: this.st })); }

  /* ---------- 모델 ---------- */
  async loadModel(delegate = this.delegate) {
    if (this.st.model === 'loading') return;
    this.delegate = delegate;
    this.st.model = 'loading';
    this.st.t.modelStart = performance.now();
    this._emitStatus();
    if (this.landmarker) { try { this.landmarker.close(); } catch (e) {} this.landmarker = null; }
    const order = this.src ? [this.src] : ['local', 'cdn'];
    for (const key of order) {
      const S = SOURCES[key];
      try {
        if (!this.vision || this.src !== key) {
          this.vision = await import(S.bundle);
          this.files = await this.vision.FilesetResolver.forVisionTasks(S.wasm);
        }
        this.landmarker = await this._create(S.model, delegate);
        this.src = key;
        this.st.model = 'on';
        this.st.modelSrc = key === 'local' ? '저장소' : '외부 CDN';
        this.st.t.modelReady = performance.now();
        this._emitStatus();
        this._loop();
        return;
      } catch (e) {
        this._logErr(`모델(${key}) 불러오기 실패: ${e && e.message || e}`);
        this.vision = null;
      }
    }
    this.st.model = 'fail';
    this._emitStatus();
  }

  async _create(model, delegate) {
    const opts = d => ({
      baseOptions: { modelAssetPath: model, delegate: d },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    if (delegate === 'GPU') {
      try {
        const lm = await this.vision.PoseLandmarker.createFromOptions(this.files, opts('GPU'));
        this.st.delegate = 'GPU';
        return lm;
      } catch (e) {
        this._logErr(`GPU 생성 실패 → CPU로 바꿉니다: ${e && e.message || e}`);
      }
    }
    const lm = await this.vision.PoseLandmarker.createFromOptions(this.files, opts('CPU'));
    this.st.delegate = 'CPU';
    return lm;
  }

  /* ---------- 카메라 ---------- */
  async startCamera() {
    if (!window.isSecureContext) { this._camFail('HTTPS가 아니어서 카메라를 쓸 수 없습니다'); return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this._camFail('이 브라우저는 카메라를 지원하지 않습니다'); return false; }
    this.st.cam = 'asking'; this._emitStatus();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
    } catch (e) {
      const why = {
        NotAllowedError: '카메라 허용이 거부되었습니다',
        NotFoundError: '카메라를 찾지 못했습니다',
        NotReadableError: '다른 앱이 카메라를 쓰고 있습니다',
        OverconstrainedError: '카메라 설정이 맞지 않습니다',
      }[e && e.name] || `카메라 오류: ${e && (e.name || e.message) || e}`;
      this._camFail(why); return false;
    }
    const v = this.video;
    v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true;
    v.srcObject = stream;
    try { await v.play(); }
    catch (e) { this._camFail(`영상 재생이 막혔습니다: ${e && e.name || e}`); return false; }
    if (!v.videoWidth) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
    this.st.cam = 'on'; this.st.camError = '';
    this.st.t.camReady = performance.now();
    this._emitStatus();
    this._loop();
    return true;
  }
  _camFail(why) { this.st.cam = 'fail'; this.st.camError = why; this._logErr(why); }

  stopCamera() {
    const s = this.video.srcObject;
    if (s) s.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
    this.st.cam = 'off'; this._emitStatus();
  }

  /* ---------- 인식 루프 ---------- */
  _loop() {
    if (!this.landmarker || this.st.cam !== 'on') return;
    if (this._running && this._loopLm === this.landmarker) return;
    this._running = true;
    const gen = this._gen = (this._gen || 0) + 1;
    this._loopLm = this.landmarker;
    // requestVideoFrameCallback은 영상 요소가 가려지거나 작으면 호출되지 않는 경우가 있어 rAF만 씁니다.
    const next = () => requestAnimationFrame(tick);
    const tick = () => {
      if (gen !== this._gen) return;
      if (!this.landmarker || this.st.cam !== 'on') { this._running = false; return; }
      this._step();
      next();
    };
    next();
  }

  _step() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    if (v.currentTime === this._lastVT) return;
    this._lastVT = v.currentTime;
    let ts = performance.now();
    if (ts <= this._lastTs) ts = this._lastTs + 1;
    this._lastTs = ts;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, ts);
      this._errRun = 0;
    } catch (e) {
      this.st.detectErrors++;
      this._errRun++;
      this._logErr(`인식 오류(${this.st.delegate}): ${e && e.message || e}`);
      if (this._errRun >= 5 && this.st.delegate === 'GPU') {
        this._logErr('GPU 인식이 계속 실패 → CPU로 다시 불러옵니다');
        this.st.model = 'off';
        this.loadModel('CPU');
      }
      return;
    }
    this.st.frames++;
    this._fpsN++;
    const now = performance.now();
    if (now - this._fpsT >= 1000) { this.st.fps = Math.round(this._fpsN * 1000 / (now - this._fpsT)); this._fpsN = 0; this._fpsT = now; }

    const raw = res && res.landmarks && res.landmarks[0];
    this.st.people = res && res.landmarks ? res.landmarks.length : 0;
    this.lm = raw ? raw.map(p => ({ x: 1 - p.x, y: p.y, v: p.visibility ?? 1 })) : null;
    if (this.lm && !this.st.t.firstPose) this.st.t.firstPose = now;
    this._analyze(now);
    this.dispatchEvent(new CustomEvent('frame', { detail: this.lm }));
  }

  _ok(L, i) { const p = L[i]; return p.v >= this.s.visMin && p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05; }

  _emit(type, detail = {}) {
    const now = performance.now();
    if (now - (this._cool[type] || 0) < this.s.cooldownMs) return;
    this._cool[type] = now;
    this.dispatchEvent(new CustomEvent('signal', { detail: { type, ...detail, source: 'camera' } }));
  }

  _reset() {
    this._stable = 0;
    this._raise.L = this._raise.R = 0;
    this._move.anchor = null; this._move.n = 0;
    this._wave.L.length = 0; this._wave.R.length = 0;
    this.targets.forEach(t => t._n = 0);
  }

  _analyze(now) {
    const L = this.lm, s = this.s;
    if (!L) { this._reset(); this.st.guide = '화면 안으로 들어와 주세요 (1.5~2m 뒤)'; return; }
    const shoulders = this._ok(L, IDX.sL) && this._ok(L, IDX.sR);
    const sw = shoulders ? Math.hypot(L[IDX.sL].x - L[IDX.sR].x, L[IDX.sL].y - L[IDX.sR].y) : 0;
    const anyWrist = this._ok(L, IDX.wL) || this._ok(L, IDX.wR);
    if (!shoulders || sw < 0.04) { this._reset(); this.st.guide = '어깨가 보이지 않습니다. 뒤로 물러나 주세요'; return; }
    if (sw > 0.45) { this._reset(); this.st.guide = '너무 가깝습니다. 뒤로 물러나 주세요'; return; }
    this.st.guide = anyWrist ? '' : '손이 보이지 않습니다. 뒤로 물러나 주세요';
    this._stable++;
    if (this._stable < s.stableFrames) return;

    const sides = [['L', IDX.sL, IDX.eL, IDX.wL], ['R', IDX.sR, IDX.eR, IDX.wR]];

    /* 손 들기 */
    for (const [k, si, , wi] of sides) {
      const up = this._ok(L, wi) && (L[si].y - L[wi].y) / sw >= s.raiseRatio;
      this._raise[k] = up ? this._raise[k] + 1 : 0;
      const down = !this._ok(L, wi) || L[wi].y > L[si].y;
      if (down) this._raise['latch' + k] = false;
      if (this._raise[k] >= s.raiseFrames && !this._raise['latch' + k]) {
        this._raise['latch' + k] = true;
        this._emit('raise', { side: k });
      }
    }

    /* 손 뻗어 터치 */
    const aspect = this.video.videoWidth / this.video.videoHeight || 4 / 3;
    for (const t of this.targets) {
      let hit = null;
      for (const [k, , , wi] of sides) {
        if (!this._ok(L, wi)) continue;
        const dx = (L[wi].x - t.x) * aspect, dy = L[wi].y - t.y;
        if (Math.hypot(dx, dy) <= (t.r ?? s.touchRadius)) hit = k;
      }
      t._n = hit ? t._n + 1 : 0;
      if (hit && t._n === s.touchFrames) {
        this.dispatchEvent(new CustomEvent('signal', { detail: { type: 'touch', id: t.id, side: hit, source: 'camera' } }));
      }
    }

    /* 좌우 이동 */
    const cx = (L[IDX.sL].x + L[IDX.sR].x) / 2, m = this._move;
    if (m.anchor === null) m.anchor = cx;
    const d = cx - m.anchor;
    if (Math.abs(d) >= s.moveDist) {
      const dir = d > 0 ? 'right' : 'left';
      m.n = m.dir === dir ? m.n + 1 : 1; m.dir = dir;
      if (m.n >= s.moveFrames) { this._emit('move', { dir }); m.anchor = cx; m.n = 0; }
    } else {
      m.n = 0;
      m.anchor += (cx - m.anchor) * 0.03;
    }

    /* 손 흔들기 (손목이 팔꿈치나 어깨보다 위에 있을 때만) */
    for (const [k, si, ei, wi] of sides) {
      const h = this._wave[k];
      const up = this._ok(L, wi) && (L[wi].y < L[si].y || (this._ok(L, ei) && L[wi].y < L[ei].y));
      if (!up) { h.length = 0; continue; }
      h.push({ t: now, x: L[wi].x });
      while (h.length && now - h[0].t > s.waveWindowMs) h.shift();
      if (countReversals(h, s.waveAmp * sw) >= s.waveReversals) { h.length = 0; this._emit('wave', { side: k }); }
    }
  }
}

function countReversals(h, amp) {
  if (h.length < 4) return 0;
  let rev = 0, dir = 0, ext = h[0].x;
  for (const p of h) {
    if (dir === 0) { if (p.x - ext > amp) { dir = 1; ext = p.x; } else if (ext - p.x > amp) { dir = -1; ext = p.x; } }
    else if (dir === 1) { if (p.x > ext) ext = p.x; else if (ext - p.x > amp) { rev++; dir = -1; ext = p.x; } }
    else { if (p.x < ext) ext = p.x; else if (p.x - ext > amp) { rev++; dir = 1; ext = p.x; } }
  }
  return rev;
}

/* 화면(contain 맞춤) 좌표 변환: 거울 좌표 → 요소 안 픽셀 */
export function fitRect(boxW, boxH, vw, vh, mode = 'contain') {
  const sc = mode === 'cover' ? Math.max(boxW / vw, boxH / vh) : Math.min(boxW / vw, boxH / vh);
  const w = vw * sc, h = vh * sc;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}
