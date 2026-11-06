(*
 * PLC_PRG
 * 目的 : 入力の取り込み → 制御 FB → 出力の公開 の順に呼ぶ。
 *        GVL_IO を書くのはここだけ。
 *
 * 構成 : 機械（ノズル・ヒーター・温度センサ・ボタン・非常停止）は Web 側にある。
 *        PLC は Modbus で「センサを読んで、出力を返す」だけ。実機の PLC と同じ立場。
 *
 * 通信ウォッチドッグ :
 *        Web 側は毎回 aFromTS[2] のハートビートを進めて書く。
 *        これが T_LINK_TIMEOUT の間変わらなければ、入力が途絶えたと判断する。
 *        （実機なら、リモート I/O の通信断やケーブル抜けに相当）
 *
 * 履歴 : 2026-10-30 新規作成
 *        2026-10-30 PRG_Sim を廃止。機械モデルを Web 側に移した
 *)
PROGRAM PLC_PRG
VAR
    fbWashlet    : FB_Washlet;
    tonLinkLost  : TON;
    wLastTsBeat  : WORD;
    wInBits      : WORD;
    wOutBits     : WORD;
    wEchoBits    : WORD;
    wHeartbeat   : WORD;
END_VAR
VAR CONSTANT
    T_LINK_TIMEOUT : TIME := T#500MS;   (* Web 側の書き込み周期 50 ms の 10 倍 *)
END_VAR

(* ---- 1. 入力の取り込み（機械 → PLC） ---- *)
wInBits := GVL_Modbus.aFromTS[0];
GVL_IO.bEStopOk       := wInBits.0;   (* 接点が閉じている = 1 = 健全 *)
GVL_IO.bSeated        := wInBits.1;
GVL_IO.bWashButton    := wInBits.2;
GVL_IO.bStopButton    := wInBits.3;
GVL_IO.bResetButton   := wInBits.4;
GVL_IO.bNozzleAtFront := wInBits.5;
GVL_IO.bNozzleAtHome  := wInBits.6;
GVL_IO.rWaterTemp     := WORD_TO_REAL(GVL_Modbus.aFromTS[1]) / 100.0;   (* [℃×100] → [℃] *)

(* ハートビートが止まったら入力を信用しない。TON は毎サイクル呼ぶ *)
tonLinkLost(IN := GVL_Modbus.aFromTS[2] = wLastTsBeat, PT := T_LINK_TIMEOUT);
wLastTsBeat := GVL_Modbus.aFromTS[2];
GVL_IO.bIoHealthy := NOT tonLinkLost.Q;

(* ---- 2. 制御 ---- *)
fbWashlet(
    bEStopOk       := GVL_IO.bEStopOk,
    bSeated        := GVL_IO.bSeated,
    bWashButton    := GVL_IO.bWashButton,
    bStopButton    := GVL_IO.bStopButton,
    bResetButton   := GVL_IO.bResetButton,
    bNozzleAtFront := GVL_IO.bNozzleAtFront,
    bNozzleAtHome  := GVL_IO.bNozzleAtHome,
    rWaterTemp     := GVL_IO.rWaterTemp,
    bIoHealthy     := GVL_IO.bIoHealthy);

GVL_IO.bNozzleExtend  := fbWashlet.bNozzleExtend;
GVL_IO.bNozzleRetract := fbWashlet.bNozzleRetract;
GVL_IO.bPump          := fbWashlet.bPump;
GVL_IO.bHeater        := fbWashlet.bHeater;

(* ---- 3. 出力の公開（PLC → 機械） ---- *)
wOutBits := 0;
wOutBits.0 := GVL_IO.bNozzleExtend;
wOutBits.1 := GVL_IO.bNozzleRetract;
wOutBits.2 := GVL_IO.bPump;
wOutBits.3 := GVL_IO.bHeater;
wOutBits.4 := fbWashlet.bExtendPermit;
wOutBits.5 := fbWashlet.bSprayPermit;

(* PLC から見えている入力を、そのまま返す（画面の「PLC の気持ち」用） *)
wEchoBits := wInBits;
wEchoBits.7 := GVL_IO.bIoHealthy;

wHeartbeat := wHeartbeat + 1;

GVL_Modbus.aToTS[0] := TO_WORD(fbWashlet.eState);
GVL_Modbus.aToTS[1] := TO_WORD(fbWashlet.eAlarm);
GVL_Modbus.aToTS[2] := wOutBits;
GVL_Modbus.aToTS[3] := wEchoBits;
GVL_Modbus.aToTS[4] := GVL_Modbus.aFromTS[1];   (* PLC が受け取った水温 [℃×100] *)
GVL_Modbus.aToTS[5] := wHeartbeat;
