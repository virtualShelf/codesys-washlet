(*
 * E_WashState
 * 目的 : 温水洗浄便座コントローラ（FB_Washlet）の状態
 * 履歴 : 2026-10-30 新規作成
 *)
{attribute 'qualified_only'}  // CODESYS 拡張: E_WashState.IDLE の形でしか書けなくする
{attribute 'strict'}          // CODESYS 拡張: 列挙型に整数を直接代入できなくする
TYPE E_WashState :
(
    IDLE           := 0,   (* 待機。通常はノズル収納済み *)
    NOZZLE_EXTEND  := 1,   (* ノズル伸長中 *)
    SPRAY          := 2,   (* 噴射中 *)
    NOZZLE_RETRACT := 3,   (* ノズル収納中 *)
    ESTOP          := 10,  (* 非常停止中。動く出力はすべて OFF *)
    FAULT          := 20   (* 異常。リセット待ち *)
);
END_TYPE
