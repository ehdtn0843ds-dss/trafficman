// 버스 1회 탄소 손익분기 — model.js 래퍼
// 계산은 js/model.js(파이썬 모델 재현, node js/model.test.mjs로 검증)가 하고, 상수는 data/model.json에서 읽어요.
//   유니버스 디젤 44석, 연비 3.49 km/L, 회송 1회, 승용차 재차 1.1명. 단위는 모두 kgCO2/km.
// 히어로(hero.js)와 파이프라인 7단계(pipeline.js)가 씀. top-level await를 쓰지 않아서,
// model.json이 늦거나 실패해도 이 모듈을 import한 쪽은 바로 실행돼요. 계산 전에 `await ready`.
import { loadModel, getModel, breakeven as mb } from './model.js';

export const MODEL_URL = new URL('../data/model.json', import.meta.url).href;

// PCTR 배분 4개 축의 평균 길이(km). model.json을 받으면 scenario_grid.ours_km로 바꿔요.
export let AXIS_KM = 29.3;

/** model.json을 받으면 풀리고, 실패하면 거부되는 약속 */
export const ready = loadModel(MODEL_URL).then(() => {
  AXIS_KM = getModel().scenario_grid.ours_km;
  return true;
});
ready.catch(() => {}); // 실패 처리는 쓰는 쪽(히어로·7단계)이 안내 문구로 해요. 콘솔에 처리 안 된 거부가 남지 않게.

/**
 * @param {number} n    회당 탑승 인원
 * @param {number} phi  승객 중 원래 승용차 통근자 비율 (0~1)
 * @param {number} [km] 축 길이 (km)
 * @returns {{mStar:number, nStar:number, netKg:number}}
 *   mStar 본전에 필요한 회당 승용차 출신 승객 수
 *   nStar 이 φ에서 본전에 필요한 탑승 인원 (φ가 너무 낮으면 Infinity)
 *   netKg 출근 1회(회송 포함) 순감축 kg, 음수면 증가
 * `ready`가 풀리기 전에 부르면 model.js가 오류를 던져요.
 */
export function breakeven(n, phi, km = AXIS_KM) {
  const r = mb({ N: n, phi });
  return { mStar: r.mstar, nStar: r.Nstar, netKg: r.netKgPerKm * km };
}
