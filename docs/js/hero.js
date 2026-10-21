// 히어로: 44석 좌석 배치도 + 페이지 공통 동작(용어 풀이, 네비 현재 위치)
// 좌석과 기본 상태(20명, φ 0.25, 본전 10.9명)는 index.html에 미리 그려 두고,
// 계산 모형(model.json)을 받으면 슬라이더로 다시 칠해요. 모형이 늦거나 실패해도 기본 상태는 그대로 보여요.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* 1. 좌석 배치도                                                        */
/* ------------------------------------------------------------------ */
function hero() {
  const bus = document.getElementById('bus');
  const plan = document.getElementById('seats');
  const nIn = document.getElementById('n');
  const phiIn = document.getElementById('phi');
  if (!bus || !plan || !nIn || !phiIn) return;
  window.__heroAnim = true;

  const nOut = document.getElementById('nOut');
  const phiOut = document.getElementById('phiOut');
  const verdict = document.getElementById('verdict');
  const dest = document.getElementById('bus-dest');
  const note = document.getElementById('bus-note');
  const mark = document.getElementById('be-mark');
  const chips = [...bus.querySelectorAll('.chip')];
  // HTML의 좌석 순서가 곧 채우는 순서예요(앞쪽 열부터, 같은 열에서는 창가부터).
  const order = [...plan.querySelectorAll('.seat')];
  const colOf = (i) => 11 - Math.floor(i / 4);

  let be = null;          // breakeven.js 모듈 (모형을 받은 뒤)
  let animating = false;
  let pending = false;    // 연출 중에 들어온 입력

  const fmt1 = (v) => v.toFixed(1);
  const setFill = (input) => {
    const p = ((+input.value - +input.min) / (+input.max - +input.min)) * 100;
    input.style.setProperty('--fill', p + '%');
  };
  setFill(nIn); setFill(phiIn);

  function render() {
    if (!be) return;
    if (animating) { pending = true; return; }
    const N = +nIn.value;
    const P = +phiIn.value;
    const m = N * P;                       // 기대 승용차 출신 승객 (소수)
    const { mStar, netKg } = be.breakeven(N, P);
    const full = Math.floor(m + 1e-9);
    const part = m - full;
    const need = Math.ceil(mStar - 1e-9);

    order.forEach((el, i) => {
      let cls = 'seat';
      if (i < full) cls += ' is-car';
      else if (i === full && part > 0.001 && i < N) cls += ' is-part';
      else if (i < N) cls += ' is-transit';
      if (i < need) cls += ' is-need';
      el.className = cls;
      if (cls.includes('is-part')) el.style.setProperty('--p', Math.round(part * 100) + '%');
      else el.style.removeProperty('--p');
    });
    if (mark) mark.style.gridColumn = colOf(Math.max(0, Math.min(43, need - 1)));

    nOut.textContent = N + '명';
    phiOut.textContent = P.toFixed(2);
    setFill(nIn); setFill(phiIn);
    plan.setAttribute('aria-label', `44석 중 ${N}석 탑승, 그중 승용차 출신 ${fmt1(m)}명. 본전에 필요한 승용차 출신은 ${fmt1(mStar)}명.`);

    const ok = N > 0 && m >= mStar;
    let head;
    if (N === 0) head = '아직 아무도 타지 않았어요';
    else if (ok) head = `승용차 출신 ${fmt1(m)}명, 탄소를 줄여요`;
    else head = `승용차 출신 ${fmt1(m)}명, 아직 탄소가 늘어요`;

    const v = Math.min(100, (m / 44) * 100);
    const t = Math.min(100, (mStar / 44) * 100);
    verdict.className = 'bus-verdict ' + (ok ? 'is-cut' : 'is-add');
    // 출근 1회(회송 포함) 순감축. 0.5 kg 미만이면 반올림해 0이 되니 '거의 본전'이라고 말해요.
    let kg = '';
    if (N > 0) {
      kg = Math.abs(netKg) < 0.5
        ? ` ${be.AXIS_KM} km 축 기준 출근 1회(회송 포함)마다 거의 본전이에요.`
        : ` ${be.AXIS_KM} km 축 기준 출근 1회(회송 포함)마다 약 ${Math.abs(netKg).toFixed(0)} kg CO₂가 ${netKg >= 0 ? '줄어요' : '늘어요'}.`;
    }
    const lead = N > 0
      ? `이 탑승 인원에서 본전은 승용차 출신 <b>${fmt1(mStar)}명</b>이에요.${kg}`
      : '버스는 빈 차로 달려도 연료를 써요. 탑승 인원을 올려 보세요.';
    verdict.innerHTML =
      `<strong class="verdict-head">${head}</strong>` +
      `<div class="meter${ok ? ' is-cut' : ''}" style="--v:${v}%;--t:${t}%" aria-hidden="true"><i></i><b></b></div>` +
      `<p class="verdict-text">${lead}` +
      `<small>보고서와 같은 모형이에요. 유니버스 디젤 3.49 km/L, 회송 1회, 승용차 재차 1.1명.</small></p>`;

    let matched = null;
    chips.forEach((b) => {
      const on = +b.dataset.n === N && Math.abs(+b.dataset.phi - P) < 1e-9;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) matched = b;
    });
    if (dest) dest.textContent = matched ? matched.dataset.dest : '직접 고른 값';
  }

  nIn.addEventListener('input', render);
  phiIn.addEventListener('input', render);
  chips.forEach((b) => b.addEventListener('click', () => {
    if (!be) return;
    nIn.value = b.dataset.n;
    phiIn.value = b.dataset.phi;
    render();
  }));

  // 계산 모형은 나중에 받아요. 그동안은 HTML에 그려 둔 기본 상태를 보여 줘요.
  const controls = [nIn, phiIn, ...chips];
  const setEnabled = (on) => controls.forEach((c) => { c.disabled = !on; });
  bus.classList.add('is-loading');
  setEnabled(false);
  const slow = setTimeout(() => {
    if (be || !note) return;
    note.hidden = false;
    note.textContent = '계산 모형을 불러오는 중이에요. 그동안은 기본값(약 20명, φ 0.25, 본전 10.9명)을 보여 드려요.';
  }, 1500);
  import('./breakeven.js')
    .then(async (mod) => { await mod.ready; return mod; })
    .then((mod) => {
      be = mod;
      clearTimeout(slow);
      if (note) note.hidden = true;
      bus.classList.remove('is-loading');
      setEnabled(true);
      render();
    })
    .catch(() => {
      clearTimeout(slow);
      bus.classList.remove('is-loading');
      if (note) {
        note.hidden = false;
        note.textContent = '계산 모형(model.json)을 불러오지 못해 슬라이더가 멈춰 있어요. 위 좌석은 기본값(약 20명, φ 0.25, 본전 10.9명)이에요. 새로고침해 보세요.';
      }
    });

  // 탑승 연출: 처음 화면에 들어올 때 한 번. 앞자리부터 한 명씩 탄 뒤 본전 표시가 나타나요.
  const root = document.documentElement;
  if (!root.classList.contains('hero-anim')) return;
  if (reduceMotion || !('IntersectionObserver' in window)) { root.classList.remove('hero-anim'); return; }
  const finalCls = order.map((el) => el.className);
  const boardN = finalCls.filter((c) => /is-(car|transit|part)/.test(c)).length;
  const STEP = Math.max(28, Math.min(45, 850 / Math.max(1, boardN)));
  const finish = () => {
    plan.classList.add('anim-done');
    plan.classList.remove('show-need');
    order.forEach((el) => el.classList.remove('boarded'));
    root.classList.remove('hero-anim');
    animating = false;
    if (pending) { pending = false; render(); }
  };
  const run = () => {
    animating = true;
    // 연출 중에 손을 대면 바로 끝내요.
    const cut = () => { if (animating) { timers.forEach(clearTimeout); finish(); } };
    const timers = [];
    controls.forEach((c) => c.addEventListener('pointerdown', cut, { once: true }));
    for (let i = 0; i < boardN; i++) timers.push(setTimeout(() => order[i].classList.add('boarded'), i * STEP));
    timers.push(setTimeout(() => plan.classList.add('show-need'), boardN * STEP + 120));
    timers.push(setTimeout(finish, boardN * STEP + 520));
  };
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
  }, { threshold: 0.35 });
  io.observe(plan);
}

/* ------------------------------------------------------------------ */
/* 2. 용어 풀이: 점선 밑줄 단어를 누르거나 포커스·마우스를 올리면 열려요   */
/* ------------------------------------------------------------------ */
function terms() {
  const btns = [...document.querySelectorAll('.term')];
  if (!btns.length) return;
  let openBtn = null;
  const tipOf = (b) => document.getElementById(b.getAttribute('aria-describedby'));
  const place = (b, tip) => {
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    tip.style.left = '0px'; tip.style.top = '0px';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(16, Math.min(vw - 16 - w, left));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8 && r.top - h - 8 > 0) top = r.top - h - 8;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  };
  const close = () => {
    if (!openBtn) return;
    tipOf(openBtn)?.classList.remove('is-open');
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn = null;
  };
  const open = (b) => {
    if (openBtn === b) return;
    close();
    const tip = tipOf(b);
    if (!tip) return;
    place(b, tip);
    tip.classList.add('is-open');
    b.setAttribute('aria-expanded', 'true');
    openBtn = b;
  };
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let byClick = false;
  // 터치·마우스로 누른 그 단어만 focus보다 click이 정하게 해요(눌렀는데 바로 닫히지 않게).
  // 단어별로 기억하고, 키를 누르면 바로 풀어서 클릭 직후 Tab으로 옮겨 간 다음 단어는 정상으로 열려요.
  let pressed = null, pressT = 0;
  const release = () => { pressed = null; clearTimeout(pressT); };
  document.addEventListener('keydown', release, true);
  btns.forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('pointerdown', () => { pressed = b; clearTimeout(pressT); pressT = setTimeout(release, 700); });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openBtn === b && byClick) { close(); byClick = false; return; }
      open(b); byClick = true;
    });
    b.addEventListener('focus', () => { if (pressed !== b) { open(b); byClick = false; } });
    b.addEventListener('blur', () => { if (openBtn === b) close(); });
    if (fine) {
      b.addEventListener('mouseenter', () => { if (openBtn !== b) { open(b); byClick = false; } });
      b.addEventListener('mouseleave', () => { if (openBtn === b && !byClick && document.activeElement !== b) close(); });
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', close);
  // 스크롤하면 닫지 않고 단어를 따라가요(키보드로 옮겨 가며 스크롤될 때도 열려 있게).
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (!openBtn || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!openBtn) return;
      const r = openBtn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) close(); else place(openBtn, tipOf(openBtn));
    });
  }, { passive: true });
  window.addEventListener('resize', close);
}

/* ------------------------------------------------------------------ */
/* 3. 상단 네비: 지금 보고 있는 섹션에 aria-current                       */
/* ------------------------------------------------------------------ */
function navCurrent() {
  const links = [...document.querySelectorAll('.sign nav a[href^="#"]')];
  const secs = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if (!secs.length || !('IntersectionObserver' in window)) return;
  const visible = new Map();
  const update = () => {
    // 화면 위쪽 띠에 걸친 섹션 중 가장 아래 것
    let cur = null;
    secs.forEach((s) => { if (visible.get(s)) cur = s; });
    links.forEach((a) => {
      if (cur && a.getAttribute('href') === '#' + cur.id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    const on = links.find((a) => a.hasAttribute('aria-current'));
    const nav = on?.parentElement;
    if (on && nav && nav.scrollWidth > nav.clientWidth) {
      const l = on.offsetLeft, r = l + on.offsetWidth;
      if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: l - 12, behavior: 'auto' });
    }
  };
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => visible.set(e.target, e.isIntersecting));
    update();
  }, { rootMargin: '-60px 0px -60% 0px', threshold: 0 });
  secs.forEach((s) => io.observe(s));
}

hero();
terms();
navCurrent();
