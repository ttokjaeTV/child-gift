/* 자녀 증여 계산 엔진 — 상속세 및 증여세법 (2025-10-01 시행본). 금액 원, 나이 만 나이, 1년 단위.
 * 제도 숫자는 모두 rules.js(R.GIFT, v2026.3 이상)에서 읽는다.
 *
 * 증여 한 건(나이 a, 금액 g)의 세금 — 같은 증여자(부모는 두 분을 한 사람으로 봄)로부터 받은 것 기준
 *   10년 합산(제47조②): 이번 증여 + 직전 10년 안의 증여. 정확히 10년 전 같은 날 증여도 넣는다(민법 기간 역산 — 보수적).
 *     '10년마다 한도만큼' 계획(afterTen)은 지난 증여에서 10년이 지난 다음 날 준다고 보고 뺀다
 *   증여재산공제(제53조): 이번 증여 때 나이로 정한 한도(미성년 2천만·성년 5천만). 10년 안에 받은 공제도 이 한도 안에 든다
 *   혼인·출산 공제(제53조의2): 그 증여에 붙인 금액만큼 별도로, 평생 1억 안에서
 *   과세표준 50만원 미만은 0(제55조②) → 세율표(제26조) → 손주면 30% 할증(제57조)
 *   − 합산된 이전 증여 때 그 증여에 붙은 산출세액(제58조) → 신고세액공제 3%(제69조②)
 *   각 증여에 '붙은 산출세액' = 그때 산출세액 − 그때 뺀 이전 세액 (합산이 이어져도 겹치지 않게)
 */
function giftCalcTax(base, R) {
  const B = R.GIFT.brackets;
  if (!(base > 0)) return 0;
  for (const [lim, rate, ded] of B) if (base <= lim) return base * rate - ded;
  return 0;
}
function giftLimit(age, R) { return age < R.GIFT.minorAgeUnder ? R.GIFT.deductionLinealMinor : R.GIFT.deductionLineal; }

/* 증여 목록 [{age, amt, mb}] (mb = 그중 혼인·출산 공제를 붙일 금액) → 건별 세금 */
function giftTaxes(events, opt, R) {
  const G = R.GIFT, grand = opt && opt.donor === 'grand';
  const ev = events.filter(e => e.amt > 0).map(e => ({ ...e })).sort((a, b) => a.age - b.age);
  let mbUsed = 0;
  ev.forEach((e, k) => {
    const win = ev.slice(0, k).filter(x => x.age > e.age - G.periodYears || (x.age === e.age - G.periodYears && !e.afterTen));
    const agg = e.amt + win.reduce((s, x) => s + x.amt, 0);
    const mb = Math.min(e.mb || 0, e.amt, Math.max(0, G.marriageBirthDeduction - mbUsed));
    mbUsed += mb;
    const mbWin = mb + win.reduce((s, x) => s + (x.mbUsed || 0), 0);
    const ded = Math.min(giftLimit(e.age, R), Math.max(0, agg - mbWin));
    const baseRaw = Math.max(0, agg - ded - mbWin);
    const base = baseRaw < G.minTaxBase ? 0 : baseRaw;   // 과세최저한(제55조②): 50만원 미만이면 과세 안 함
    let calc = Math.floor(giftCalcTax(base, R));
    if (grand && calc > 0) {
      const big = e.age < G.minorAgeUnder && e.amt > G.generationSkipLargeThreshold;
      calc = Math.floor(calc * (1 + (big ? G.generationSkipSurchargeMinorLarge : G.generationSkipSurcharge)));
    }
    const prev = Math.min(calc, win.reduce((s, x) => s + x.own, 0));
    const before = calc - prev;
    const credit = Math.floor(before * G.filingCreditRate);
    Object.assign(e, { agg, ded, mbUsed: mb, base, baseRaw, calc, prev, own: before, credit, tax: before - credit, win: win.length });
  });
  return ev;
}

/* 계획 → 증여 목록
 *   p = { age0, target, mode: 'cycle'|'monthly'|'custom', monthly, mFrom, mTo, custom: [{age, amt}], mbOn, mbAge, mbAmt }
 *   cycle: 지금 나이부터 10년마다 그 나이의 공제 한도만큼 / monthly: 매달 같은 금액(해마다 묶어 그해 증여로 봄) / custom: 직접 */
function giftEvents(p, R) {
  const G = R.GIFT, out = [];
  if (p.mode === 'cycle') {
    for (let a = p.age0; a <= p.target; a += G.periodYears) out.push({ age: a, amt: giftLimit(a, R), kind: 'cycle', afterTen: a > p.age0 });
  } else if (p.mode === 'monthly') {
    for (let a = Math.max(p.age0, p.mFrom); a < Math.min(p.target, p.mTo); a++) out.push({ age: a, amt: p.monthly * 12, kind: 'monthly' });
  } else {
    (p.custom || []).forEach(c => { if (c.amt > 0 && c.age >= p.age0 && c.age <= p.target) out.push({ age: Math.round(c.age), amt: c.amt, kind: 'custom' }); });
  }
  if (p.mbOn && p.mbAmt > 0 && p.mbAge >= p.age0 && p.mbAge <= p.target) out.push({ age: Math.round(p.mbAge), amt: p.mbAmt, mb: p.mbAmt, kind: 'mb' });
  // 같은 나이 증여는 한 번으로 묶는다 (같은 해에 준 돈)
  const by = {};
  out.forEach(e => { const k = e.age; if (!by[k]) by[k] = { age: k, amt: 0, mb: 0, kinds: [], afterTen: false }; by[k].amt += e.amt; by[k].afterTen = by[k].afterTen || !!e.afterTen; by[k].mb += e.mb || 0; by[k].kinds.push(e.kind); });
  return Object.values(by).sort((a, b) => a.age - b.age);
}

/* 굴리기: 증여받은 해 초에 (증여 − 증여세)를 넣고 연 수익률로 불림. 매달 증여는 매달 말에 넣고 그해 증여세는 연말에 냄 */
function giftSim(p, R) {
  const ev = giftTaxes(giftEvents(p, R), { donor: p.donor }, R);
  const r = p.rate, rm = Math.pow(1 + r, 1 / 12) - 1;
  const mFactor = rm === 0 ? 12 : (Math.pow(1 + rm, 12) - 1) / rm;
  const path = [];
  let bal = 0, principal = 0, taxPaid = 0;
  const at = a => ev.find(e => e.age === a);
  for (let a = p.age0; a <= p.target; a++) {
    const e = at(a);
    const monthlyYear = p.mode === 'monthly' && e && e.kinds.includes('monthly');
    if (e) { principal += e.amt; taxPaid += e.tax; }
    if (a === p.target) {   // 목표 나이가 되는 날: 그날 준 돈까지 더하고 끝
      if (e) bal += e.amt - e.tax;
      path.push({ age: a, bal, principal, taxPaid });
      break;
    }
    if (e && !monthlyYear) bal += e.amt - e.tax;
    path.push({ age: a, bal, principal, taxPaid });
    if (monthlyYear) {
      const lump = e.amt - p.monthly * 12;   // 같은 해에 다른 증여(혼인·출산 등)가 겹친 몫은 연초에
      bal += lump;
      bal = bal * (1 + r) + p.monthly * mFactor - e.tax;
    } else bal *= 1 + r;
  }
  const last = path[path.length - 1];
  // 같은 돈을 목표 나이에 한 번에 줬다면 (자녀 자산 전체를 그때 증여, 혼인·출산 공제는 같은 조건)
  const lumpAmt = last.bal + last.taxPaid;
  const lump = giftTaxes([{ age: p.target, amt: lumpAmt, mb: p.mbOn ? Math.min(p.mbAmt, R.GIFT.marriageBirthDeduction) : 0 }], { donor: p.donor }, R)[0];
  return { events: ev, path, final: last.bal, principal: last.principal, taxPaid: last.taxPaid, gain: last.bal - (last.principal - last.taxPaid), lump, lumpAmt };
}

if (typeof module !== 'undefined') module.exports = { giftCalcTax, giftLimit, giftTaxes, giftEvents, giftSim };
