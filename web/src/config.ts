// ウォシュレットのレジスタマップ。codesys/src/PLC_PRG.st と一致させること

export const washletConfig = {
  host: process.env.MB_HOST ?? "127.0.0.1",
  port: Number(process.env.MB_PORT ?? 502),
  unitId: Number(process.env.MB_UNIT ?? 1),
  webPort: Number(process.env.WEB_PORT ?? 3002), // エレベータ（3001）と同時に起動できるよう分ける
  intervalMs: 50, // 機械モデルの1ステップ = PLC との1往復。PLC のウォッチドッグ（500ms）より十分短く
};

// Input Registers（PLC → TS）
export const IR = {
  state: 0, // E_WashState
  alarm: 1, // E_WashAlarm
  outputs: 2, // OutBit
  inputsEcho: 3, // PLC から見えている入力（InBit と同じ並び + bit7 通信OK）
  tempEcho: 4, // PLC が受け取った水温 ×100
  heartbeat: 5,
} as const;
export const IR_COUNT = 10;

// Holding Registers（TS → PLC）
export const HR = {
  inputs: 0, // InBit
  waterTemp: 1, // 水温 ×100（38.00℃ → 3800）
  heartbeat: 2, // 毎回 +1。止まると PLC は通信断と判断する
} as const;
export const HR_COUNT = 10;

// HR0 / IR3 のビット
export const InBit = {
  EStopOk: 0, // 非常停止 NC接点（閉 = 1 = 健全）
  Seated: 1,
  Wash: 2,
  Stop: 3,
  Reset: 4,
  NozzleFront: 5,
  NozzleHome: 6,
  IoHealthy: 7, // IR3 のみ
} as const;

// IR2 のビット
export const OutBit = {
  Extend: 0,
  Retract: 1,
  Pump: 2,
  Heater: 3,
  ExtendPermit: 4,
  SprayPermit: 5,
} as const;

// E_WashState
export const State = {
  Idle: 0,
  NozzleExtend: 1,
  Spray: 2,
  NozzleRetract: 3,
  EStop: 10,
  Fault: 20,
} as const;

// E_WashAlarm
export const Alarm = {
  None: 0,
  EStopPressed: 1,
  ExtendTimeout: 11,
  RetractTimeout: 12,
  NozzleSensorBoth: 13,
  WaterOverTemp: 21,
  IoLinkLost: 31,
  InvalidState: 99,
} as const;
