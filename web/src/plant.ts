// 機械モデル（plant）。トイレ本体のハードウェアを、Web 側で持つ。
//
//   PLC が持つもの : 判断（いつ伸ばす・いつ噴射する・いつ止める）
//   ここが持つもの : 物理（ノズルが動く・お湯が温まる・センサが反応する）と、
//                    PLC の外にある安全回路（安全リレー・温度ヒューズ）
//
// 実機の配線をそのまま写している:
//
//   PLC出力 ──┬─ ノズル伸長ソレノイド
//             ├─ ノズル収納ソレノイド      ← すべて「安全リレー」の下流。
//             ├─ ポンプ                       非常停止を押すと PLC と関係なく電源が切れる
//             └─ ヒーターリレー ─ 温度ヒューズ ─ ヒーター
//
// 数値はすべてシミュレーション用の設定値で、実在の製品の仕様ではない。

export type PlcOutputs = {
  extend: boolean;
  retract: boolean;
  pump: boolean;
  heater: boolean;
};

export type FaultName = "nozzleJam" | "sensorShort" | "heaterWeld" | "estopWire" | "commCut";
export type ButtonName = "wash" | "stop" | "reset";

export const PLANT = {
  nozzleSpeedPctPerS: 125, // 0 → 100% を 0.8 秒
  endSensorPct: 2, // 端からこの範囲に入ったら端センサ ON
  heaterRatePerS: 1.5, // [℃/s] ヒーター ON 時の上昇
  ambientC: 20, // [℃] 室温
  lossRatePerS: 0.01, // 放熱（室温との差 × この値）
  supplyWaterC: 15, // [℃] 噴射で入ってくる水道水
  sprayCoolRatePerS: 0.04, // 噴射中の冷却（水道水との差 × この値）
  fuseBlowC: 55, // [℃] 温度ヒューズが切れる温度（PLC の上限 42℃ より上）
  maxC: 90,
  flowMlPerS: 8, // [ml/s] 噴射量
  buttonHoldMs: 300, // リモコンのボタンを押している時間（PLC が確実に1サイクル以上見るため）
  cleanPerS: 12, // [%/s] 適温で洗ったときの清潔度の上がり方
  comfortMinC: 30,
  comfortMaxC: 40,
  burnC: 45,
} as const;

export class Plant {
  // 機械の状態
  nozzlePos = 0; // [%] 0 = 収納端, 100 = 伸長端
  temp = 25; // [℃] タンクの水温
  seated = false;
  estopPressed = false; // きのこボタンが押し込まれてロック中
  fuseBlown = false;

  // いたずら（故障注入）
  faults: Record<FaultName, boolean> = {
    nozzleJam: false,
    sensorShort: false,
    heaterWeld: false,
    estopWire: false,
    commCut: false,
  };

  // 被害報告
  floodMl = 0;
  burns = 0;
  coldShocks = 0;
  cleanliness = 0;

  // 実際に動いているもの（PLC の出力とは別）
  actual: PlcOutputs = { extend: false, retract: false, pump: false, heater: false };
  spray: "peach" | "floor" | "bowl" | null = null;

  private buttonUntil: Record<ButtonName, number> = { wash: 0, stop: 0, reset: 0 };
  private wasOnPeach = false;
  private wasBurning = false;

  press(button: ButtonName, now = Date.now()) {
    this.buttonUntil[button] = now + PLANT.buttonHoldMs;
  }

  sit(seated: boolean) {
    if (seated && !this.seated) this.cleanliness = 0; // 新しい「もも」が来た
    this.seated = seated;
  }

  setFault(name: FaultName, on: boolean) {
    this.faults[name] = on;
  }

  replaceFuse() {
    this.fuseBlown = false;
  }

  buttons(now = Date.now()) {
    return {
      wash: now < this.buttonUntil.wash,
      stop: now < this.buttonUntil.stop,
      reset: now < this.buttonUntil.reset,
    };
  }

  /** 非常停止の NC 接点。押される・断線で開く */
  get estopContactClosed() {
    return !this.estopPressed && !this.faults.estopWire;
  }

  /** 安全リレー。接点が閉じているときだけ動力を通す（PLC は関与しない） */
  get safetyRelayOn() {
    return this.estopContactClosed;
  }

  /** センサが PLC に返す値（故障注入込み） */
  get sensorFront() {
    return this.faults.sensorShort || this.nozzlePos >= 100 - PLANT.endSensorPct;
  }
  get sensorHome() {
    return this.faults.sensorShort || this.nozzlePos <= PLANT.endSensorPct;
  }

  /** dt 秒ぶん機械を進める。plc が null なら PLC とつながっていない（出力はすべて OFF 扱い） */
  step(dt: number, plc: PlcOutputs | null) {
    const out = plc ?? { extend: false, retract: false, pump: false, heater: false };
    const power = this.safetyRelayOn;

    // ---- 動力（安全リレーの下流） ----
    this.actual = {
      extend: power && out.extend && !out.retract,
      retract: power && out.retract && !out.extend,
      pump: power && out.pump,
      // ヒーターリレーが溶着していると、PLC が OFF にしても通電し続ける
      heater: power && (out.heater || this.faults.heaterWeld) && !this.fuseBlown,
    };

    // ---- ノズル ----
    if (!this.faults.nozzleJam) {
      const d = PLANT.nozzleSpeedPctPerS * dt;
      if (this.actual.extend) this.nozzlePos = Math.min(100, this.nozzlePos + d);
      if (this.actual.retract) this.nozzlePos = Math.max(0, this.nozzlePos - d);
    }

    // ---- 水の行き先 ----
    const atFront = this.nozzlePos >= 100 - PLANT.endSensorPct;
    this.spray = !this.actual.pump ? null : !atFront ? "bowl" : this.seated ? "peach" : "floor";
    if (this.spray === "floor") this.floodMl += PLANT.flowMlPerS * dt;

    // ---- 水温 ----
    let dT = -(this.temp - PLANT.ambientC) * PLANT.lossRatePerS;
    if (this.actual.heater) dT += PLANT.heaterRatePerS;
    if (this.actual.pump) dT -= (this.temp - PLANT.supplyWaterC) * PLANT.sprayCoolRatePerS;
    this.temp = Math.min(PLANT.maxC, this.temp + dT * dt);

    // 温度ヒューズ：PLC が止められなかったときの最後の砦。切れたら交換するまで戻らない
    if (this.temp >= PLANT.fuseBlowC) this.fuseBlown = true;

    // ---- ももの感想 ----
    const onPeach = this.spray === "peach";
    if (onPeach && !this.wasOnPeach && this.temp < PLANT.comfortMinC) this.coldShocks++;
    const burning = onPeach && this.temp >= PLANT.burnC;
    if (burning && !this.wasBurning) this.burns++;
    if (onPeach && this.temp >= PLANT.comfortMinC && this.temp <= PLANT.comfortMaxC) {
      this.cleanliness = Math.min(100, this.cleanliness + PLANT.cleanPerS * dt);
    }
    this.wasOnPeach = onPeach;
    this.wasBurning = burning;
  }

  snapshot(now = Date.now()) {
    return {
      nozzlePos: Math.round(this.nozzlePos),
      temp: Math.round(this.temp * 10) / 10,
      seated: this.seated,
      estopPressed: this.estopPressed,
      estopContactClosed: this.estopContactClosed,
      safetyRelayOn: this.safetyRelayOn,
      fuseBlown: this.fuseBlown,
      sensorFront: this.sensorFront,
      sensorHome: this.sensorHome,
      buttons: this.buttons(now),
      actual: this.actual,
      spray: this.spray,
      faults: this.faults,
      floodMl: Math.round(this.floodMl),
      burns: this.burns,
      coldShocks: this.coldShocks,
      cleanliness: Math.round(this.cleanliness),
    };
  }
}
