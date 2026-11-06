(*
 * PRG_IoModbus
 * 目的 : I/O 層。Modbus の配列と GVL_IO の生の値を、相互に詰め替える。
 *        今は Web 側の機械モデルと Modbus TCP でつないでいるので、この PRG がある。
 *        実機の IO ユニットに替えるときは、この PRG を外し、
 *        GVL_IO.stRawIn / stRawOut を I/O マッピングで割り当てる。
 *
 * 呼び方（PLC_PRG から）:
 *   PRG_IoModbus.ReadInputs();    サイクルの最初。aFromTS → GVL_IO.stRawIn
 *   PRG_IoModbus.WriteOutputs();  サイクルの最後。GVL_IO.stRawOut と状態 → aToTS
 *
 * 入力（WriteOutputs の前に PLC_PRG が入れる。画面に出す状態。機械は動かさない）:
 *   eState / eAlarm                 状態と、最初に起きた異常
 *   bExtendPermit / bSprayPermit    インターロック成立
 *
 * レジスタの並びは README のレジスタマップ表のとおり（構造体にする前から変えていない）。
 *
 * 履歴 : 2026-11-06 新規作成（PLC_PRG にあった Modbus の詰め替えを移した）
 *)
PROGRAM PRG_IoModbus
VAR_INPUT
    eState        : E_WashState;
    eAlarm        : E_WashAlarm;
    bExtendPermit : BOOL;
    bSprayPermit  : BOOL;
END_VAR
VAR
    wInBits    : WORD;   (* HR0 のビット。画面へのエコーにも使う *)
    wOutBits   : WORD;
    wEchoBits  : WORD;
    wHeartbeat : WORD;   (* PLC 側のハートビート *)
END_VAR

(* 本体は使わない。ReadInputs / WriteOutputs を呼ぶ *)

ACTION ReadInputs
(* ---- 機械 → PLC：aFromTS → GVL_IO.stRawIn ---- *)
wInBits := GVL_Modbus.aFromTS[0];
GVL_IO.stRawIn.bEStopOk       := wInBits.0;   (* 接点が閉じている = 1 = 健全 *)
GVL_IO.stRawIn.bSeated        := wInBits.1;
GVL_IO.stRawIn.bWashButton    := wInBits.2;
GVL_IO.stRawIn.bStopButton    := wInBits.3;
GVL_IO.stRawIn.bResetButton   := wInBits.4;
GVL_IO.stRawIn.bNozzleAtFront := wInBits.5;
GVL_IO.stRawIn.bNozzleAtHome  := wInBits.6;
GVL_IO.stRawIn.wWaterTempRaw  := GVL_Modbus.aFromTS[1];   (* [℃×100] のまま。換算は変換層 *)
GVL_IO.stRawIn.wHeartbeat     := GVL_Modbus.aFromTS[2];
END_ACTION

ACTION WriteOutputs
(* ---- PLC → 機械：GVL_IO.stRawOut → aToTS ---- *)
wOutBits := 0;
wOutBits.0 := GVL_IO.stRawOut.bNozzleExtend;
wOutBits.1 := GVL_IO.stRawOut.bNozzleRetract;
wOutBits.2 := GVL_IO.stRawOut.bPump;
wOutBits.3 := GVL_IO.stRawOut.bHeater;
wOutBits.4 := bExtendPermit;
wOutBits.5 := bSprayPermit;

(* PLC から見えている入力を、そのまま返す（画面の「PLC の気持ち」用） *)
wEchoBits := wInBits;
wEchoBits.7 := GVL_IO.stIn.bIoHealthy;

wHeartbeat := wHeartbeat + 1;

GVL_Modbus.aToTS[0] := TO_WORD(eState);
GVL_Modbus.aToTS[1] := TO_WORD(eAlarm);
GVL_Modbus.aToTS[2] := wOutBits;
GVL_Modbus.aToTS[3] := wEchoBits;
GVL_Modbus.aToTS[4] := GVL_IO.stRawIn.wWaterTempRaw;   (* PLC が受け取った水温 [℃×100] *)
GVL_Modbus.aToTS[5] := wHeartbeat;
END_ACTION

END_PROGRAM
