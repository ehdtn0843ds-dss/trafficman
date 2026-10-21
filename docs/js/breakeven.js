// 버스 1회 탄소 손익분기 — model.js 래퍼
// 계산은 js/model.js(파이썬 모델 재현, node js/model.test.mjs로 검증)가 하고, 상수는 data/model.json에서 읽어요.
//   유니버스 디젤 44석, 연비 3.49 km/L, 회송 1회, 승용차 재차 1.1명. 단위는 모두 kgCO2/km.
// 히어로(hero.js)와 파이프라인 7단계(pipeline.js)가 이 함수 하나만 써요. 반환 모양은 예전 임시 래퍼와 같아요.
import { loadModel, getModel, vehicleConstants, breakeven as mb } from './model.js';

export const MODEL_URL = new URL('../data/model.json', import.meta.url).href;
await loadModel(MODEL_URL);

const k = vehicleConstants({});
export const C0 = k.C0;       // 버스 1회 운행 (승객 0명)
export const CDH = k.CDH;     // 빈 차 회송 1회
export const CPAX = k.CPAX;   // 승객 1명이 늘 때마다 더해지는 버스 배출
export const CCAR = k.CCAR;   // 승용차 통근 1인 (재차 1.1명)
export const AXIS_KM = getModel().scenario_grid.ours_km;  // PCTR 배분 4개 축의 평균 길이 29.3 km

/**
 * @param {number} n    회당 탑승 인원
 * @param {number} phi  승객 중 원래 승용차 통근자 비율 (0~1)
 * @param {number} [km] 축 길이 (km)
 * @returns {{mStar:number, nStar:number, netKg:number}}
 *   mStar 본전에 필요한 회당 승용차 출신 승객 수
 *   nStar 이 φ에서 본전에 필요한 탑승 인원 (φ가 너무 낮으면 Infinity)
 *   netKg 출근 1회(회송 포함) 순감축 kg, 음수면 증가
 */
export function breakeven(n, phi, km = AXIS_KM) {
  const r = mb({ N: n, phi });
  return { mStar: r.mstar, nStar: r.Nstar, netKg: r.netKgPerKm * km };
}
