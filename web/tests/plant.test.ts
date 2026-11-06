// 機械モデルのテスト。PLC ではなく「ハードの安全回路」が期待どおりに効くかを確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { Plant, PLANT } from "../src/plant.ts";

const ALL_ON = { extend: false, retract: false, pump: true, heater: true };
const run = (p: Plant, sec: number, out = ALL_ON) => {
  for (let t = 0; t < sec; t += 0.05) p.step(0.05, out);
};

test("非常停止を押すと、PLC が出力を出していても動力は切れる", () => {
  const p = new Plant();
  p.estopPressed = true;
  p.step(0.05, { extend: true, retract: false, pump: true, heater: true });
  assert.deepEqual(p.actual, { extend: false, retract: false, pump: false, heater: false });
});

test("非常停止の配線が切れても、押されたのと同じく止まる（NC接点）", () => {
  const p = new Plant();
  p.setFault("estopWire", true);
  assert.equal(p.estopContactClosed, false);
  p.step(0.05, ALL_ON);
  assert.equal(p.actual.pump, false);
});

test("ヒーターリレー溶着：PLC が OFF でも加熱が続き、温度ヒューズで止まる", () => {
  const p = new Plant();
  p.setFault("heaterWeld", true);
  run(p, 60, { extend: false, retract: false, pump: false, heater: false });
  assert.equal(p.fuseBlown, true);
  assert.equal(p.actual.heater, false);
  assert.ok(p.temp < PLANT.fuseBlowC + 1);
});

test("座っていないのに噴射すると、床が濡れる", () => {
  const p = new Plant();
  p.nozzlePos = 100;
  run(p, 1, { extend: false, retract: false, pump: true, heater: false });
  assert.equal(p.spray, "floor");
  assert.ok(p.floodMl > 0);
});

test("端センサ短絡：伸長端と収納端が同時に ON になる", () => {
  const p = new Plant();
  p.setFault("sensorShort", true);
  assert.equal(p.sensorFront && p.sensorHome, true);
});

test("ボタンは一定時間だけ押された状態になる", () => {
  const p = new Plant();
  p.press("wash", 1000);
  assert.equal(p.buttons(1000 + PLANT.buttonHoldMs - 1).wash, true);
  assert.equal(p.buttons(1000 + PLANT.buttonHoldMs).wash, false);
});
