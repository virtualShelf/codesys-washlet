(*
 * ST_WashOutputs
 * 目的 : 機械を動かす出力（アクチュエータ）4 つ。
 *        状態を知らせる出力（eState・eAlarm・許可）はここに入れない。
 *        「機械を動かす出力」と「状態を知らせる出力」を分けるため。
 * 履歴 : 2026-11-06 新規作成（出力を構造体にまとめ、層に分けた）
 *)
TYPE ST_WashOutputs :
STRUCT
    bNozzleExtend  : BOOL;   (* ノズル伸長 *)
    bNozzleRetract : BOOL;   (* ノズル収納 *)
    bPump          : BOOL;   (* 噴射ポンプ *)
    bHeater        : BOOL;   (* 温水ヒーター *)
END_STRUCT
END_TYPE
