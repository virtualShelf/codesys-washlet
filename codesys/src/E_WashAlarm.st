(*
 * E_WashAlarm
 * 目的 : FB_Washlet が FAULT / ESTOP に入った理由（最初の1件だけ保持する）
 * 履歴 : 2026-10-30 新規作成
 *)
{attribute 'qualified_only'}  // CODESYS 拡張
{attribute 'strict'}          // CODESYS 拡張
TYPE E_WashAlarm :
(
    NONE                := 0,
    ESTOP_PRESSED       := 1,   (* 非常停止ボタンが押された（または配線が切れた） *)
    EXTEND_TIMEOUT      := 11,  (* ノズルが時間内に伸びきらない *)
    RETRACT_TIMEOUT     := 12,  (* ノズルが時間内に戻らない *)
    NOZZLE_SENSOR_BOTH  := 13,  (* 伸長端と収納端が同時に ON（センサ異常） *)
    WATER_OVER_TEMP     := 21,  (* 水温が上限を超えた。やけど防止 *)
    IO_LINK_LOST        := 31,  (* 機械（Web側）からの入力が途絶えた *)
    INVALID_STATE       := 99   (* CASE の ELSE。来てはいけない *)
);
END_TYPE
