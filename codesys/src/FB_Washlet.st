(*
 * FB_Washlet
 * 目的 : 温水洗浄便座のノズル・ポンプ・ヒーターを制御する。
 *        非常停止とインターロックの学習用サンプル。
 *
 * 考え方（優先順位の高い順）:
 *   1. 非常停止 … どの状態からでも ESTOP へ。動く出力はすべて OFF。
 *                  解除しただけでは動かない。リセット操作が必要。
 *   2. 異常      … センサ矛盾・水温上限・タイムアウトで FAULT へ。
 *   3. インターロック … 「条件がそろわないと、その動作をさせない」。
 *                  状態遷移と出力の両方でチェックする（二重化）。
 *
 * ※ 本物の非常停止は、ソフトではなく安全リレー／安全PLCで
 *    動力を物理的に切る。この FB は「通常PLC側の振る舞い」の学習用。
 *
 * 入力:
 *   bEStopOk        非常停止が健全（NC接点。押される・断線で FALSE）
 *   bSeated         着座センサ
 *   bWashButton     「おしり」ボタン
 *   bStopButton     「止」ボタン（通常停止）
 *   bResetButton    リセットボタン
 *   bNozzleAtFront  ノズル伸長端センサ
 *   bNozzleAtHome   ノズル収納端センサ
 *   rWaterTemp      水温 [℃]
 *   bIoHealthy      入力が生きている（通信ウォッチドッグ。PLC_PRG で判定）
 * 出力:
 *   bNozzleExtend / bNozzleRetract  ノズル駆動
 *   bPump                           噴射ポンプ
 *   bHeater                         温水ヒーター
 *   eState / eAlarm                 状態と、最初に起きた異常
 *   bExtendPermit / bSprayPermit    インターロック成立（監視用）
 *
 * 履歴 : 2026-10-30 新規作成
 *)
FUNCTION_BLOCK FB_Washlet
VAR_INPUT
    bEStopOk       : BOOL;
    bSeated        : BOOL;
    bWashButton    : BOOL;
    bStopButton    : BOOL;
    bResetButton   : BOOL;
    bNozzleAtFront : BOOL;
    bNozzleAtHome  : BOOL;
    rWaterTemp     : REAL;   (* [℃] *)
    bIoHealthy     : BOOL;   (* 入力が生きている（通信ウォッチドッグ OK） *)
END_VAR
VAR_OUTPUT
    bNozzleExtend  : BOOL;
    bNozzleRetract : BOOL;
    bPump          : BOOL;
    bHeater        : BOOL;
    eState         : E_WashState := E_WashState.IDLE;
    eAlarm         : E_WashAlarm := E_WashAlarm.NONE;
    bExtendPermit  : BOOL;
    bSprayPermit   : BOOL;
END_VAR
VAR
    rtrigWash   : R_TRIG;
    rtrigReset  : R_TRIG;
    tonExtend   : TON;
    tonRetract  : TON;
    tonSpray    : TON;
    bTempOk     : BOOL;
    bHeatDemand : BOOL;   (* ヒーターのヒステリシス保持 *)
END_VAR
VAR CONSTANT
    T_EXTEND_TIMEOUT  : TIME := T#3S;    (* 設計値。実機に合わせて調整 *)
    T_RETRACT_TIMEOUT : TIME := T#3S;
    T_SPRAY_MAX       : TIME := T#60S;   (* 押しっぱなし防止の自動停止 *)
    R_TEMP_MAX        : REAL := 42.0;    (* [℃] これ以上は噴射させない *)
    R_TEMP_TARGET     : REAL := 38.0;    (* [℃] ヒーター目標 *)
    R_TEMP_HYST       : REAL := 1.0;     (* [℃] ヒーターのON/OFF幅 *)
END_VAR

(* ---- 1. FB は毎サイクル呼ぶ（IN で制御する） ---- *)
rtrigWash(CLK := bWashButton);
rtrigReset(CLK := bResetButton);
tonExtend (IN := eState = E_WashState.NOZZLE_EXTEND,  PT := T_EXTEND_TIMEOUT);
tonRetract(IN := eState = E_WashState.NOZZLE_RETRACT, PT := T_RETRACT_TIMEOUT);
tonSpray  (IN := eState = E_WashState.SPRAY,          PT := T_SPRAY_MAX);

(* ---- 2. インターロック条件 ---- *)
bTempOk       := rWaterTemp < R_TEMP_MAX;
bExtendPermit := bEStopOk AND bIoHealthy AND bSeated AND bNozzleAtHome AND bTempOk;
bSprayPermit  := bEStopOk AND bIoHealthy AND bSeated AND bNozzleAtFront AND bTempOk;

(* ---- 3. 非常停止・異常の割り込み（CASE より先に判定する） ---- *)
IF NOT bEStopOk THEN
    IF eState <> E_WashState.ESTOP THEN
        eState := E_WashState.ESTOP;
        IF eAlarm = E_WashAlarm.NONE THEN
            eAlarm := E_WashAlarm.ESTOP_PRESSED;
        END_IF
    END_IF
ELSIF eState <> E_WashState.ESTOP AND eState <> E_WashState.FAULT THEN
    IF NOT bIoHealthy THEN
        // 入力が止まったら、センサの値は「最後に見えた値」でしかない。信用せず止める
        eState := E_WashState.FAULT;
        eAlarm := E_WashAlarm.IO_LINK_LOST;
    ELSIF bNozzleAtFront AND bNozzleAtHome THEN
        eState := E_WashState.FAULT;
        eAlarm := E_WashAlarm.NOZZLE_SENSOR_BOTH;
    ELSIF NOT bTempOk THEN
        eState := E_WashState.FAULT;
        eAlarm := E_WashAlarm.WATER_OVER_TEMP;
    END_IF
END_IF

(* ---- 4. 通常の状態遷移 ---- *)
CASE eState OF
E_WashState.IDLE:
    IF NOT bNozzleAtHome THEN
        eState := E_WashState.NOZZLE_RETRACT;      // 起動時など、出ていたら先に戻す
    ELSIF rtrigWash.Q AND bExtendPermit THEN
        eState := E_WashState.NOZZLE_EXTEND;
    END_IF

E_WashState.NOZZLE_EXTEND:
    IF NOT bSeated OR bStopButton THEN
        eState := E_WashState.NOZZLE_RETRACT;
    ELSIF bNozzleAtFront THEN
        eState := E_WashState.SPRAY;
    ELSIF tonExtend.Q THEN
        eState := E_WashState.FAULT;
        eAlarm := E_WashAlarm.EXTEND_TIMEOUT;
    END_IF

E_WashState.SPRAY:
    IF NOT bSprayPermit OR bStopButton OR tonSpray.Q THEN
        eState := E_WashState.NOZZLE_RETRACT;      // 離席・止・時間切れは「正常な停止」
    END_IF

E_WashState.NOZZLE_RETRACT:
    IF bNozzleAtHome THEN
        eState := E_WashState.IDLE;
    ELSIF tonRetract.Q THEN
        eState := E_WashState.FAULT;
        eAlarm := E_WashAlarm.RETRACT_TIMEOUT;
    END_IF

E_WashState.ESTOP:
    // 解除しただけでは動かさない。解除＋リセット操作で、安全側（収納）から再開
    IF bEStopOk AND rtrigReset.Q THEN
        eAlarm := E_WashAlarm.NONE;
        eState := E_WashState.NOZZLE_RETRACT;
    END_IF

E_WashState.FAULT:
    // 原因が残っているうちはリセットを受け付けない
    IF rtrigReset.Q AND bIoHealthy AND bTempOk AND NOT (bNozzleAtFront AND bNozzleAtHome) THEN
        eAlarm := E_WashAlarm.NONE;
        eState := E_WashState.NOZZLE_RETRACT;
    END_IF

ELSE
    eState := E_WashState.FAULT;
    eAlarm := E_WashAlarm.INVALID_STATE;
END_CASE

(* ---- 5. ヒーターのヒステリシス ---- *)
IF rWaterTemp < R_TEMP_TARGET - R_TEMP_HYST THEN
    bHeatDemand := TRUE;
ELSIF rWaterTemp >= R_TEMP_TARGET THEN
    bHeatDemand := FALSE;
END_IF

(* ---- 6. 出力（書き込みはここだけ）。状態に加えて条件をもう一度かける ---- *)
bNozzleExtend  := eState = E_WashState.NOZZLE_EXTEND  AND bEStopOk AND bSeated;
bNozzleRetract := eState = E_WashState.NOZZLE_RETRACT AND bEStopOk AND bIoHealthy;
bPump          := eState = E_WashState.SPRAY          AND bSprayPermit;
bHeater        := bHeatDemand AND bEStopOk AND bIoHealthy AND bTempOk
                  AND eState <> E_WashState.FAULT
                  AND eState <> E_WashState.ESTOP;   // 解除しただけでは何も動かさない（ヒーターも）
