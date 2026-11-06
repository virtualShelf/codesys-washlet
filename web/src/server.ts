// ウォシュレット画面のサーバー
//   - 機械モデル（plant.ts）を動かす
//   - 50ms ごとに PLC と1往復：出力を読む → 機械を進める → センサを書く
//   - 状態を SSE（サーバーからブラウザへ値を流し続ける仕組み）で配る
//   - 画面の操作（ボタン・着座・非常停止・いたずら）を受け付ける
// 依存ライブラリなし（Node 標準の http のみ）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModbusTcpClient } from "./modbus.ts";
import { washletConfig as cfg, HR, IR, IR_COUNT, InBit, OutBit } from "./config.ts";
import { Plant, type ButtonName, type FaultName, type PlcOutputs } from "./plant.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const client = new ModbusTcpClient(cfg.host, cfg.port, cfg.unitId);
const plant = new Plant();
const clients = new Set<http.ServerResponse>();
let tsBeat = 0;

const bit = (w: number, n: number) => ((w >> n) & 1) === 1;

let connecting: Promise<void> | null = null;
function ensureConnected(): Promise<void> {
  if (connecting) return connecting;
  if (client.connected) return Promise.resolve();
  connecting = client
    .connect()
    .catch((e) => {
      client.close();
      throw e;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

/** 機械のセンサ・ボタンを HR0 のビットに詰める */
function packInputs(): number {
  const b = plant.buttons();
  const bits: [number, boolean][] = [
    [InBit.EStopOk, plant.estopContactClosed],
    [InBit.Seated, plant.seated],
    [InBit.Wash, b.wash],
    [InBit.Stop, b.stop],
    [InBit.Reset, b.reset],
    [InBit.NozzleFront, plant.sensorFront],
    [InBit.NozzleHome, plant.sensorHome],
  ];
  return bits.reduce((w, [n, on]) => (on ? w | (1 << n) : w), 0);
}

let last = Date.now();
async function tick() {
  const now = Date.now();
  const dt = Math.min(0.2, (now - last) / 1000); // 止まっていた後に一気に進まないよう上限を置く
  last = now;

  let plc: Record<string, unknown> | null = null;
  let outputs: PlcOutputs | null = null;
  let error: string | null = null;

  try {
    await ensureConnected();
    const r = await client.readInputRegisters(0, IR_COUNT);
    const o = r[IR.outputs];
    const e = r[IR.inputsEcho];
    outputs = {
      extend: bit(o, OutBit.Extend),
      retract: bit(o, OutBit.Retract),
      pump: bit(o, OutBit.Pump),
      heater: bit(o, OutBit.Heater),
    };
    plc = {
      state: r[IR.state],
      alarm: r[IR.alarm],
      outputs,
      extendPermit: bit(o, OutBit.ExtendPermit),
      sprayPermit: bit(o, OutBit.SprayPermit),
      sees: {
        estopOk: bit(e, InBit.EStopOk),
        seated: bit(e, InBit.Seated),
        front: bit(e, InBit.NozzleFront),
        home: bit(e, InBit.NozzleHome),
        ioHealthy: bit(e, InBit.IoHealthy),
        temp: r[IR.tempEcho] / 100,
      },
      heartbeat: r[IR.heartbeat],
    };
  } catch (e) {
    client.close();
    error = (e as Error).message;
  }

  plant.step(dt, outputs);

  // 「通信ケーブルを抜く」いたずら中は、センサを書かない（PLC から見ると入力が固まる）
  if (plc && !plant.faults.commCut) {
    try {
      tsBeat = (tsBeat + 1) & 0xffff;
      const temp = Math.max(0, Math.min(0xffff, Math.round(plant.temp * 100)));
      await client.writeMultipleRegisters(HR.inputs, [packInputs(), temp, tsBeat]);
    } catch (e) {
      client.close();
      error = (e as Error).message;
    }
  }

  const payload = JSON.stringify({ connected: plc !== null, error, plc, plant: plant.snapshot(now) });
  for (const res of clients) res.write(`data: ${payload}\n\n`);

  setTimeout(tick, Math.max(0, cfg.intervalMs - (Date.now() - now)));
}
tick();

// ---- 画面からの操作 ----
const BUTTONS: ButtonName[] = ["wash", "stop", "reset"];
const FAULTS: FaultName[] = ["nozzleJam", "sensorShort", "heaterWeld", "estopWire", "commCut"];

function handleAction(body: Record<string, unknown>) {
  switch (body.action) {
    case "press":
      if (!BUTTONS.includes(body.button as ButtonName)) throw new Error("unknown button");
      plant.press(body.button as ButtonName);
      return;
    case "sit":
      plant.sit(Boolean(body.seated));
      return;
    case "estop":
      plant.estopPressed = Boolean(body.pressed);
      return;
    case "fault":
      if (!FAULTS.includes(body.name as FaultName)) throw new Error("unknown fault");
      plant.setFault(body.name as FaultName, Boolean(body.on));
      return;
    case "replaceFuse":
      plant.replaceFuse();
      return;
    case "mop": // 床を拭く
      plant.floodMl = 0;
      return;
    default:
      throw new Error("unknown action");
  }
}

async function readBody(req: http.IncomingMessage) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/api/action" && req.method === "POST") {
    try {
      handleAction(await readBody(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
    }
    return;
  }

  const filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  });
});

server.listen(cfg.webPort, () => {
  console.log(`MOMO-WASH UI: http://localhost:${cfg.webPort}   (PLC: ${cfg.host}:${cfg.port})`);
});
