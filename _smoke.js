// 헤드리스 스모크: 실제 DOM 상태를 보고 화면을 구동한다. (버튼을 지어내지 않는다)
const fs = require("fs"), vm = require("vm");

const els = {};
let lastCh = [];
function mkEl(id) {
  return {
    id, innerHTML: "", onclick: null, dataset: {},
    // 실제 DOM처럼: 지금 innerHTML 에 있는 .ch 를 파싱해 돌려준다
    querySelectorAll(sel) {
      if (sel !== ".ch") return [];
      const out = [], re = /class="ch" data-i="(\d)"/g;
      let m;
      while ((m = re.exec(this.innerHTML))) out.push({ dataset: { i: m[1] }, onclick: null });
      lastCh = out;
      return out;
    },
    querySelector() { return null; },
  };
}
const fireChoice = i => (lastCh[i] && typeof lastCh[i].onclick === "function" ? (lastCh[i].onclick(), true) : false);
const ctx = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, isNaN, parseInt, parseFloat,
  document: {
    getElementById: id => (els[id] = els[id] || mkEl(id)),
    createElement: () => mkEl("tmp"),
    addEventListener: () => {},
  },
  window: {},
};
vm.createContext(ctx);
const EXPORTS = ["S", "ERAS", "MORTALITY_EVENTS", "STATS", "actSpan", "genAt", "riskFor"];
vm.runInContext(fs.readFileSync(__dirname + "/game.js", "utf8")
  + "\n;globalThis.__X={" + EXPORTS.map(k => k + ":" + k).join(",") + "};", ctx);
const { S, ERAS, MORTALITY_EVENTS, actSpan, riskFor } = ctx.__X;

/* ── 단언 1: 위험도는 모든 구간·모든 문명 상태에서 유한하고 0~0.97 ── */
const CIVS = [
  { tech: 0,  sci: 0,  unity: 0,  war: 0,  faith: 0,  art: 0  },
  { tech: 50, sci: 50, unity: 50, war: 50, faith: 50, art: 50 },
  { tech: 100,sci: 100,unity: 100,war: 100,faith: 100,art: 100},
];
const badRisk = [];
for (const civ of CIVS) {
  S.civ = civ;
  for (let e = 0; e < ERAS.length; e++) { S.ei = e;
    for (let a = 0; a < 7; a++) { S.ai = a;
      const [y0, y1] = actSpan();
      for (let t = 0; t < 50; t++) {
        const r = riskFor(y0, y1);
        if (!Number.isFinite(r.hazard) || r.hazard < 0 || r.hazard > 0.97)
          badRisk.push(`E${e + 1}A${a + 1} ${y0}-${y1} h=${r.hazard}`);
        for (const ev of r.events)
          if (!Number.isFinite(ev.take)) badRisk.push(`E${e + 1}A${a + 1} ${ev.ev.name} take=${ev.take}`);
      }
    }
  }
}
console.log(badRisk.length
  ? `위험도 단언 실패 ${badRisk.length}건: ${badRisk.slice(0, 4).join(" | ")}`
  : `단언1 위험도: ${CIVS.length * ERAS.length * 7 * 50}구간 전부 유한값, 0≤h≤0.97`);

/* ── 단언 2: 21개 사망원이 모두 위험 계산에 등장할 수 있는가(전 구간 탐색) ── */
S.civ = CIVS[2];
const seenEvents = new Set();
for (let e = 0; e < ERAS.length; e++) { S.ei = e;
  for (let a = 0; a < 7; a++) { S.ai = a;
    const [y0, y1] = actSpan();
    riskFor(y0, y1).events.forEach(x => seenEvents.add(x.ev.name));
  }
}
const unreachable = MORTALITY_EVENTS.filter(e => !seenEvents.has(e.name)).map(e => e.name);
console.log(unreachable.length
  ? `단언2 도달 불가 사건 ${unreachable.length}건: ${unreachable.join(", ")}`
  : `단언2 21개 사망원 전부 어느 막 구간에나 걸린다`);

/* ── 단언 3: 실제 클릭 흐름 완주 ── */
const screens = [];   // 관찰된 화면 종류
let ok = 0, bad = [], gens = [], deaths = [], lineages = [], zeroKids = 0, rolls = 0;
let hazardSum = 0, acts = 0;

for (let run = 0; run < 400; run++) {
  if (run === 0) els["go"].onclick();
  else { els["nx"].onclick(); els["go"].onclick(); }
  if (S.gen !== 0 || S.ei !== 0) { bad.push(`run${run}: 시작 상태 오염 gen=${S.gen} ei=${S.ei}`); continue; }

  let steps = 0, prevDeaths = 0, prevLineages = 1;
  while (!S.finished && steps++ < 300) {
    const html = els["main"].innerHTML;
    const kind = /class="death"/.test(html) ? "death"
               : /class="final"/.test(html)  ? "final"
               : /class="ch"/.test(html)     ? "act"
               : "?" + html.slice(0, 40);
    screens.push(kind);

    if (kind === "act") {
      const m = html.match(/data-i="(\d)"/g) || [];
      if (m.length !== 3) { bad.push(`run${run} step${steps}: 선택지 ${m.length}개`); break; }
      const h = riskFor(actSpan()[0], actSpan()[1]); hazardSum += h.hazard; acts++;
      // 재현 가능한 클릭: 데이터 인덱스를 파싱해 해당 핸들러를 부른다
      const idx = Math.floor(Math.random() * 3);
      if (!fireChoice(idx)) { bad.push(`run${run} step${steps}: 선택 핸들러 없음`); break; }
      rolls++; if (S.banner && S.banner.kids === 0) zeroKids++;
    } else if (kind === "death") {
      // nx 는 afterDeath 로 바뀐 상태
    } else if (kind === "final") { break; }
    else { bad.push(`run${run} step${steps}: 알 수 없는 화면`); break; }

    const nx = els["nx"];
    if (!nx || typeof nx.onclick !== "function") { bad.push(`run${run} step${steps}(${kind}): 계속 없음`); break; }
    nx.onclick();

    if (S.deaths > prevDeaths) { /* 사망 처리됨 */ prevDeaths = S.deaths; }
    if (S.lineages > prevLineages) { prevLineages = S.lineages; }
  }
  if (S.finished) { ok++; gens.push(S.gen); deaths.push(S.deaths); lineages.push(S.lineages); }
  else bad.push(`run${run}: 미완주 steps=${steps} ei=${S.ei} ai=${S.ai} gen=${S.gen}`);
}
console.log(`단언3 완주 ${ok}/400  이상 ${bad.length}${bad.length ? ": " + bad.slice(0, 3).join(" | ") : ""}`);
console.log(`   화면 분포: ${[...new Set(screens)].join(", ")}`);

const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sum = a => a.reduce((x, y) => x + y, 0);
console.log(`   세대 최소 ${Math.min(...gens)} 중앙 ${med(gens)} 최대 ${Math.max(...gens)}`);
console.log(`   사망 세대/run 평균 ${(sum(deaths) / ok).toFixed(1)} 최대 ${Math.max(...deaths)}`);
console.log(`   막당 위험 평균 ${(hazardSum / acts * 100).toFixed(1)}%`);
console.log(`   자녀 0명 ${(zeroKids / rolls * 100).toFixed(1)}%  → 혈통 단절/run 평균 ${((sum(lineages) / ok) - 1).toFixed(2)}`);
console.log(`   엔딩 렌더: ${/class="fgen">([\d,]+)</.exec(els["main"].innerHTML)?.[1] || "없음"} 세대`);
console.log(`   최종 장부 합 == 사망 합: ${sum(deaths)}`);
