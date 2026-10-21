// 버스 1회 탄소 손익분기 (임시 래퍼)
// 상수 출처: pctr_commute/result/capture_rate.json
//   유니버스 디젤 44석, 연비 3.49 km/L, 회송 1회, 승용차 재차 1.1명. 단위는 모두 kgCO2/km.
// docs/js/model.js로 바꿀 때는 이 파일의 아래 상수·함수를 다음으로 바꾸면 돼요(반환 모양은 그대로).
//   import { loadModel, breakeven as mb } from './model.js';
//   await loadModel('./data/model.json');           // 페이지 기준 경로
//   export function breakeven(n, phi, km = AXIS_KM) {
//     const r = mb({ N: n, phi });
//     return { mStar: r.mstar, nStar: r.Nstar, netKg: r.netKgPerKm * km };
//   }
// 히어로(hero.js)와 파이프라인 7단계(pipeline.js)가 이 함수 하나만 써요.

export const C0 = 0.79307;      // 버스 1회 운행 (승객 0명)
export const CDH = 0.61233;     // 빈 차 회송 1회
export const CPAX = 0.0021842;  // 승객 1명이 늘 때마다 더해지는 버스 배출
export const CCAR = 0.132923;   // 승용차 통근 1인 (재차 1.1명)
export const AXIS_KM = 29.3;    // PCTR 배분 4개 축의 평균 길이

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
  const busPerKm = C0 + CDH + n * CPAX;
  const denom = phi * CCAR - CPAX;
  return {
    mStar: busPerKm / CCAR,
    nStar: denom > 0 ? (C0 + CDH) / denom : Infinity,
    netKg: (n * phi * CCAR - busPerKm) * km,
  };
}
