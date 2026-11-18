/* 진행 상황은 이 기기 안(localStorage)에만 저장합니다. 서버로 보내지 않습니다. */
const KEY = 'bt-progress-v1';
export const CLEAR_GOAL = 10;

export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && typeof p.total === 'number' && p.missions) return p;
  } catch (e) {}
  return { total: 0, missions: {} };
}
export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
}
export function resetProgress() {
  try { localStorage.removeItem(KEY); } catch (e) {}
  return loadProgress();
}
/* 미션별 기록: clears 클리어 수, level 현재 단계, camera 인식 성공, manual "했어요", touch 화면 터치 */
export function missionRec(p, id) {
  return p.missions[id] || (p.missions[id] = { clears: 0, level: 1, camera: 0, manual: 0, touch: 0 });
}
