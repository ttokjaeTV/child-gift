// 자녀 증여 엔진 시험 — 기대값은 상속세 및 증여세법(2025-10-01 시행본)으로 손계산.
// rules.js는 페이지의 <script src> 버전을 읽어 위쪽 폴더의 허브 clone → 없으면 고정 주소 순으로 찾는다.
(function loadRules() {
  const fs = require('fs'), path = require('path');
  const page = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const rel = page.match(/rules\/v[\d.]+\/rules\.js/)[0];
  let src = null;
  for (let d = __dirname, i = 0; i < 6 && src === null; i++, d = path.dirname(d)) {
    const f = path.join(d, 'ttokjaetv.github.io', rel);
    if (fs.existsSync(f)) src = fs.readFileSync(f, 'utf8');
  }
  if (src === null) src = require('child_process').execFileSync(process.execPath, ['-e',
    `fetch('https://ttokjaetv.github.io/${rel}').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => process.stdout.write(t))`]).toString();
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  global.TTOKJAE_RULES = m.exports;
})();
const R = global.TTOKJAE_RULES;
const { giftCalcTax, giftTaxes, giftSim } = require('./engine.js');
const M = 1e4;
let fail = 0, n = 0;
const eq = (name, got, want) => { n++; if (got !== want) { fail++; console.log(`✗ ${name}: ${got} (기대 ${want})`); } };
const one = (age, amt, o = {}) => giftTaxes([{ age, amt, mb: o.mb || 0 }], { donor: o.donor }, R)[0];

// 세율표 (제26조): 과세표준 × 세율 − 누진공제
eq('1억', giftCalcTax(1e8, R), 1e7);
eq('5억', giftCalcTax(5e8, R), 9e7);
eq('10억', giftCalcTax(1e9, R), 2.4e8);
eq('12억', giftCalcTax(12e8, R), 3.2e8);
eq('30억', giftCalcTax(3e9, R), 10.4e8);

// 한 번 증여
eq('성년 1억 → 과표 5천 → 500만 × 0.97', one(25, 1e8).tax, 4850000);
eq('미성년 5천 → 과표 3천 → 300만 × 0.97', one(5, 5000 * M).tax, 2910000);
eq('미성년 2천 = 공제 안', one(5, 2000 * M).tax, 0);
eq('과세표준 50만원 미만 0', one(25, 5040 * M).tax, 0);
eq('과세표준 50만원이면 과세 (5만 × 0.97)', one(25, 5050 * M).tax, 48500);
eq('손주 1억 → 500만 × 1.3 = 650만 × 0.97', one(25, 1e8, { donor: 'grand' }).tax, 6305000);
eq('혼인 1.5억 = 공제 5천 + 1억 → 0', one(30, 1.5e8, { mb: 1e8 }).tax, 0);
eq('혼인 2억 → 과표 5천', one(30, 2e8, { mb: 1e8 }).base, 5000 * M);
eq('한 번에 5억 → 4.5억 × 20% − 1천 = 8천 × 0.97', one(30, 5e8).tax, 77600000);

// 10년 합산 (제47조②) + 이전 세액 공제 (제58조)
let ev = giftTaxes([{ age: 20, amt: 5000 * M }, { age: 25, amt: 5000 * M }], {}, R);
eq('20세 5천 → 0', ev[0].tax, 0);
eq('25세 5천 → 합산 1억 − 5천 → 500만 × 0.97', ev[1].tax, 4850000);
ev = giftTaxes([{ age: 20, amt: 5000 * M }, { age: 30, amt: 5000 * M }], {}, R);
eq('정확히 10년 전 증여는 합산 안 함', ev[1].tax, 0);
ev = giftTaxes([{ age: 15, amt: 2000 * M }, { age: 20, amt: 5000 * M }], {}, R);
eq('미성년 때 2천 공제 + 성년 → 10년 합계 한도 5천', ev[1].base, 2000 * M);
ev = giftTaxes([{ age: 20, amt: 1e8 }, { age: 22, amt: 1e8 }, { age: 24, amt: 1e8 }], {}, R);
eq('세 번째: 합산 3억 − 5천 = 2.5억 → 4천만 − 이전 붙은 세액(500만 + 1,500만)', ev[2].prev, 20000000);
eq('세 번째 낼 세금 (4천 − 2천) × 0.97', ev[2].tax, 19400000);
const sum3 = ev.reduce((s, e) => s + e.own, 0);
eq('나눠 낸 산출세액 합 = 한 번에 3억 산출세액', sum3, giftCalcTax(2.5e8, R));

// 매달 증여: 월 20만 × 12 = 240만/년, 0~19세. 9세(10번째 해)부터 합산이 2천을 넘음
const sim = giftSim({ age0: 0, target: 30, rate: 0, mode: 'monthly', monthly: 20 * M, mFrom: 0, mTo: 19, donor: 'parent' }, R);
const e8 = sim.events.find(e => e.age === 8), e9 = sim.events.find(e => e.age === 9), e7 = sim.events.find(e => e.age === 7);
eq('7세 합산 1,920만 → 0', e7.tax, 0);
eq('8세 합산 2,160만 → 과표 160만 → 16만 × 0.97', e8.tax, 155200);
eq('9세 합산 2,400만 → 40만 − 16만 = 24만 × 0.97', e9.tax, 232800);

// 10년마다 공제 한도: 0·10·20·30세 = 2천·2천·5천·5천, 세금 0
const cyc = giftSim({ age0: 0, target: 30, rate: 0.06, mode: 'cycle', donor: 'parent' }, R);
eq('10년마다 4번', cyc.events.length, 4);
eq('원금 1.4억', cyc.principal, 1.4e8);
eq('세금 0', cyc.taxPaid, 0);
const fv = Math.round(2000 * M * Math.pow(1.06, 30) + 2000 * M * Math.pow(1.06, 20) + 5000 * M * Math.pow(1.06, 10) + 5000 * M);
eq('30세 자산 = 각 증여 × 1.06^남은 해', Math.round(cyc.final), fv);
eq('한 번에 줬다면 세금 > 0', cyc.lump.tax > 0, true);
eq('수익률 0이면 자산 = 원금 − 세금', Math.round(giftSim({ age0: 0, target: 30, rate: 0, mode: 'custom', custom: [{ age: 25, amt: 1e8 }], donor: 'parent' }, R).final), 1e8 - 4850000);

console.log(`예시(10년마다, 6%): 30세 ${Math.round(cyc.final / M)}만 · 원금 ${cyc.principal / M}만 · 한 번에 주면 세금 ${Math.round(cyc.lump.tax / M)}만`);
console.log(fail ? `실패 ${fail}/${n}` : `ALL PASS (${n}개)`);
process.exit(fail ? 1 : 0);
