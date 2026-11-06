(*
 * GVL_IO
 * 目的 : 機械の I/O の置き場所。ロジックは %IX/%QX や Modbus 配列を直接使わず、ここを使う。
 *        今は Web 側の機械モデルとつないでいるので、PLC_PRG が Modbus 配列と相互に詰め替える。
 *        実機につなぐときは、ここを実 I/O のマッピング先に変えるだけで FB_Washlet はそのまま使える。
 * 履歴 : 2026-10-30 新規作成
 *)
VAR_GLOBAL
    (* 入力（機械 → PLC） *)
    bEStopOk       : BOOL;   (* 非常停止 NC接点。TRUE = 健全 *)
    bSeated        : BOOL;   (* 着座センサ *)
    bWashButton    : BOOL;
    bStopButton    : BOOL;
    bResetButton   : BOOL;
    bNozzleAtFront : BOOL;   (* ノズル伸長端センサ *)
    bNozzleAtHome  : BOOL;   (* ノズル収納端センサ *)
    rWaterTemp     : REAL;   (* [℃] *)
    bIoHealthy     : BOOL;   (* 入力が生きている（ウォッチドッグ） *)

    (* 出力（PLC → 機械） *)
    bNozzleExtend  : BOOL;
    bNozzleRetract : BOOL;
    bPump          : BOOL;
    bHeater        : BOOL;
END_VAR
