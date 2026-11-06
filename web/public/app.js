// MOMO-WASH 3000 の画面。状態は SSE（/api/stream）で受け、操作は /api/action に送る
const State = { Idle: 0, NozzleExtend: 1, Spray: 2, NozzleRetract: 3, EStop: 10, Fault: 20 };
const Alarm = { None: 0, EStopPressed: 1, ExtendTimeout: 11, RetractTimeout: 12, NozzleSensorBoth: 13, WaterOverTemp: 21, IoLinkLost: 31, InvalidState: 99 };

// 状態バッジの色。文言は i18n.js の state.<番号>
const STATE_TONE = {
  [State.Idle]: "ok",
  [State.NozzleExtend]: "active",
  [State.Spray]: "active",
  [State.NozzleRetract]: "active",
  [State.EStop]: "alarm",
  [State.Fault]: "alarm",
};
const FAULTS = ["nozzleJam", "sensorShort", "heaterWeld", "estopWire", "commCut"];
const WIRES = ["extend", "retract", "pump", "heater"];
const PEACH_SEATED = [300, 176];
const PEACH_STANDING = [520, 272];
const TEMP_LIMIT = 42;

const el = (id) => document.getElementById(id);
const post = (body) =>
  fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let latest = null;

// ---- 言語 ----
// 選んだ言語はこのブラウザだけに覚えておく（保存できない環境では毎回ブラウザの言語から決める）
const LANG_KEY = "momo-wash.lang";
let lang = (() => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {}
  return (navigator.language || "ja").toLowerCase().startsWith("ja") ? "ja" : "en";
})();

/** 文言を引く。{name} は vars で置き換える。英語に無ければ日本語、それも無ければキーを返す */
function t(key, vars = {}) {
  const s = window.I18N[lang]?.[key] ?? window.I18N.ja[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function applyStaticText() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
  document.querySelectorAll("[data-i18n-html]").forEach((n) => (n.innerHTML = t(n.dataset.i18nHtml)));
  document.querySelectorAll("[data-i18n-aria]").forEach((n) => n.setAttribute("aria-label", t(n.dataset.i18nAria)));
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  for (const key of WIRES) wiringLabels[key].textContent = t(`wire.${key}`);
  for (const name of FAULTS) {
    faultLabels[name].label.textContent = t(`fault.${name}`);
    faultLabels[name].hint.textContent = t(`fault.${name}.hint`);
    faultSwitches[name].setAttribute("aria-label", t(`fault.${name}`));
  }
}

function setLang(next) {
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {}
  applyStaticText();
  if (latest) render(latest);
}

// ---- 部品を作る ----
const wiringLamps = {};
const wiringLabels = {};
for (const key of WIRES) {
  const name = document.createElement("span");
  wiringLabels[key] = name;
  const cmd = document.createElement("span");
  cmd.className = "lamp";
  const act = document.createElement("span");
  act.className = "lamp";
  el("wiring").append(name, cmd, act);
  wiringLamps[key] = { cmd, act };
}

const faultSwitches = {};
const faultLabels = {};
for (const name of FAULTS) {
  const row = document.createElement("div");
  row.className = "toggle";
  const text = document.createElement("span");
  const label = document.createElement("span");
  const hint = document.createElement("small");
  text.append(label, hint);
  faultLabels[name] = { label, hint };
  const sw = document.createElement("button");
  sw.className = "switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", "false");
  row.append(text);
  sw.addEventListener("click", () => post({ action: "fault", name, on: sw.getAttribute("aria-checked") !== "true" }));
  row.append(sw);
  el("faults").append(row);
  faultSwitches[name] = sw;
}

// ---- 操作 ----
document.querySelectorAll("[data-press]").forEach((b) =>
  b.addEventListener("click", () => post({ action: "press", button: b.dataset.press })),
);
el("sitBtn").addEventListener("click", () => post({ action: "sit", seated: !latest?.plant.seated }));
el("mopBtn").addEventListener("click", () => post({ action: "mop" }));
el("fuseBtn").addEventListener("click", () => post({ action: "replaceFuse" }));
el("estopBtn").addEventListener("click", () => post({ action: "estop", pressed: !latest?.plant.estopPressed }));
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
applyStaticText();

// ---- 表示 ----
function waterColor(t) {
  if (t >= 45) return "#ff4d3d";
  if (t > 40) return "#ff9a4a";
  if (t >= 30) return "#45c4c9";
  return "#4aa9f0";
}

function chip(label, ok) {
  return `<span class="chip ${ok ? "ok" : "ng"}">${ok ? "✓" : "✗"} ${label}</span>`;
}

const EYES = {
  normal: '<circle cx="-18" cy="-12" r="4"/><circle cx="18" cy="-12" r="4"/>',
  happy: '<path d="M-24 -10 q6 -8 12 0" fill="none"/><path d="M12 -10 q6 -8 12 0" fill="none"/>',
  squeeze: '<path d="M-24 -18 l10 6 l-10 6" fill="none"/><path d="M24 -18 l-10 6 l10 6" fill="none"/>',
  shocked: '<circle cx="-18" cy="-12" r="6" fill="#fff"/><circle cx="18" cy="-12" r="6" fill="#fff"/><circle cx="-18" cy="-12" r="2"/><circle cx="18" cy="-12" r="2"/>',
};
const MOUTH = {
  normal: "M-10 10 q10 8 20 0",
  happy: "M-12 8 q12 16 24 0",
  wavy: "M-14 12 l7 -4 l7 4 l7 -4 l7 4",
  open: "M-7 8 q7 16 14 0 q-7 -4 -14 0",
  flat: "M-8 12 h16",
};

function mood(d) {
  const p = d.plant;
  const plc = d.plc;
  if (p.spray === "floor") return ["shocked", "open", t("say.floor"), ""];
  if (!p.seated) return null;
  if (p.spray === "peach") {
    if (p.temp >= 45) return ["squeeze", "open", t("say.burn"), "hot"];
    if (p.temp > 40) return ["squeeze", "wavy", t("say.hot"), "hot"];
    if (p.temp < 30) return ["squeeze", "wavy", t("say.cold"), "cold"];
    return ["happy", "happy", t("say.bliss"), ""];
  }
  if (!d.connected) return ["normal", "flat", t("say.noPlc"), ""];
  switch (plc.state) {
    case State.EStop: return ["shocked", "open", t("say.estop"), ""];
    case State.Fault:
      if (plc.alarm === Alarm.IoLinkLost) return ["shocked", "flat", t("say.ioLost"), ""];
      if (plc.alarm === Alarm.WaterOverTemp) return ["shocked", "flat", t("say.overTemp"), ""];
      if (plc.alarm === Alarm.NozzleSensorBoth) return ["shocked", "flat", t("say.sensor"), ""];
      return ["shocked", "flat", t("say.timeout"), ""];
    case State.NozzleExtend: return ["normal", "flat", t("say.extend"), ""];
    case State.NozzleRetract: return ["happy", "normal", t("say.retract"), ""];
    default:
      return p.cleanliness >= 100 ? ["happy", "happy", t("say.clean"), ""] : ["normal", "normal", t("say.ready"), ""];
  }
}

function renderToilet(d) {
  const p = d.plant;
  const tipX = 186 + p.nozzlePos * 1.1;
  el("nozzleRod").setAttribute("width", String(10 + p.nozzlePos * 1.1));
  el("nozzleTip").setAttribute("cx", String(tipX));

  const color = waterColor(p.temp);
  el("waterStop0").setAttribute("stop-color", color);
  el("waterStop1").setAttribute("stop-color", color + "99");
  document.querySelectorAll(".spray path").forEach((s) => (s.style.stroke = color));
  el("heaterCoil").classList.toggle("on", p.actual.heater);
  el("fuse").classList.toggle("blown", p.fuseBlown);
  el("steam").classList.toggle("on", p.temp > 40);

  el("sprayPeachPath").setAttribute("d", p.spray === "peach"
    ? `M${tipX} 252 L${tipX} 222 M${tipX - 4} 224 q-30 -26 -66 -6 M${tipX + 4} 224 q30 -26 66 -6` : "");
  el("sprayFloorPath").setAttribute("d", p.spray === "floor" ? `M${tipX} 250 C${tipX} 20, 470 30, 500 356` : "");
  el("sprayBowlPath").setAttribute("d", p.spray === "bowl" ? `M${tipX} 260 Q${tipX + 4} 280 ${tipX} 300` : "");

  const r = Math.min(90, Math.sqrt(p.floodMl) * 6);
  el("puddle").setAttribute("rx", String(r));
  el("puddle").setAttribute("ry", String(r / 6));

  const [x, y] = p.seated ? PEACH_SEATED : PEACH_STANDING;
  const peach = el("peach");
  peach.style.transform = `translate(${x}px, ${y}px)`;

  const m = mood(d);
  const [eyes, mouth, text, cls] = m ?? ["normal", "normal", "", ""];
  el("eyes").innerHTML = EYES[eyes];
  el("mouth").setAttribute("d", MOUTH[mouth]);
  peach.classList.toggle("hot", cls === "hot");
  peach.classList.toggle("cold", cls === "cold");

  const bubble = el("bubble");
  bubble.style.opacity = text ? "1" : "0";
  if (text) {
    // 吹き出しの幅は、実際の文字の幅を測って決める（日本語と英語で1文字の幅が違うため）
    const label = el("bubbleText");
    label.textContent = text;
    const w = Math.max(90, Math.ceil(label.getComputedTextLength()) + 32);
    el("bubbleBox").setAttribute("width", String(w));
    label.setAttribute("x", String(w / 2));
    const bx = Math.min(600 - w - 4, Math.max(4, x - w / 2));
    bubble.setAttribute("transform", `translate(${bx} ${y - 122})`);
  }
  el("sitBtn").textContent = t(p.seated ? "btn.stand" : "btn.sit");
}

function render(d) {
  latest = d;
  const p = d.plant;
  const plc = d.plc;

  // 接続
  el("linkLamp").className = "lamp " + (d.connected ? "on" : "bad");
  el("linkText").textContent = d.connected ? t("link.ok") : t("link.ng", { err: d.error ?? "…" });
  el("plcBeat").textContent = plc ? `♥ ${plc.heartbeat}` : "♥ –";

  // 状態
  const known = plc && plc.state in STATE_TONE;
  el("stateBadge").textContent = !plc ? "–" : known ? t(`state.${plc.state}`) : t("state.unknown");
  el("stateBadge").dataset.tone = !plc ? "" : known ? STATE_TONE[plc.state] : "alarm";
  el("alarmText").textContent = plc && plc.alarm ? `⚠ ${t(`alarm.${plc.alarm}`)}` : "";

  renderToilet(d);

  // リモコン
  document.querySelectorAll("[data-press]").forEach((b) => b.classList.toggle("held", p.buttons[b.dataset.press]));

  // 非常停止
  el("estopBtn").setAttribute("aria-pressed", String(p.estopPressed));
  el("estopHint").textContent = t(p.estopPressed ? "estop.locked" : "estop.hint");

  // PLC の気持ち
  const s = plc?.sees;
  el("permitExtend").className = "lamp " + (plc?.extendPermit ? "on" : "");
  el("permitSpray").className = "lamp " + (plc?.sprayPermit ? "on" : "");
  if (s) {
    const common = chip(t("chip.estop"), s.estopOk) + chip(t("chip.io"), s.ioHealthy) + chip(t("chip.seated"), s.seated);
    const temp = chip(t("chip.temp", { limit: TEMP_LIMIT }), s.temp < TEMP_LIMIT);
    el("chipsExtend").innerHTML = common + chip(t("chip.home"), s.home) + temp;
    el("chipsSpray").innerHTML = common + chip(t("chip.front"), s.front) + temp;
  } else {
    el("chipsExtend").innerHTML = el("chipsSpray").innerHTML = `<span class="chip">${t("chip.offline")}</span>`;
  }

  // 配線
  for (const key of WIRES) {
    const cmd = plc?.outputs[key] ?? false;
    const act = p.actual[key];
    wiringLamps[key].cmd.className = "lamp " + (cmd ? "on" : "");
    wiringLamps[key].act.className = "lamp " + (act && !cmd ? "bad" : act ? "on" : "");
  }
  const relay = el("hwRelay");
  relay.textContent = t(p.safetyRelayOn ? "hw.relayOn" : "hw.relayOff");
  relay.classList.toggle("bad", !p.safetyRelayOn);
  const fuse = el("hwFuse");
  fuse.textContent = t(p.fuseBlown ? "hw.fuseBlown" : "hw.fuseOk");
  fuse.classList.toggle("bad", p.fuseBlown);
  const weld = el("hwWeld");
  weld.textContent = t(p.faults.heaterWeld ? "hw.weld" : "hw.weldOk");
  weld.classList.toggle("bad", p.faults.heaterWeld);

  // 水温
  el("tempText").textContent = p.temp.toFixed(1);
  el("tempPlc").textContent = t("thermo.plc", { v: s ? `${s.temp.toFixed(1)} ℃` : "–" });
  const fill = el("thermoFill");
  fill.style.height = `calc(${Math.min(100, Math.max(4, ((p.temp - 20) / 40) * 100))}% - 6px)`;
  fill.style.background = waterColor(p.temp);

  // いたずら
  for (const name of FAULTS) faultSwitches[name].setAttribute("aria-checked", String(p.faults[name]));
  el("fuseBtn").hidden = !p.fuseBlown;

  // 被害報告
  el("statFlood").textContent = p.floodMl;
  el("statBurn").textContent = p.burns;
  el("statCold").textContent = p.coldShocks;
  el("statFlood").parentElement.classList.toggle("bad", p.floodMl > 0);
  el("statBurn").parentElement.classList.toggle("bad", p.burns > 0);
  el("statCold").parentElement.classList.toggle("bad", p.coldShocks > 0);
  el("cleanFill").style.width = `${p.cleanliness}%`;
  el("cleanText").textContent = `${p.cleanliness}%`;
}

new EventSource("/api/stream").onmessage = (e) => render(JSON.parse(e.data));
