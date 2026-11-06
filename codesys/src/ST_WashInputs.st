(*
 * ST_WashInputs
 * 目的 : 制御（FB_Washlet）が使う入力。変換層（FB_WashInputConv）が作る。
 *        中身は、構造体にする前の FB_Washlet の入力 9 本と同じ。
 *        生の値（ST_WashRawInputs）と違い、単位は換算済み、通信の健全性も判断済み。
 * 履歴 : 2026-11-06 新規作成（入力を構造体にまとめ、層に分けた）
 *)
TYPE ST_WashInputs :
STRUCT
    bEStopOk       : BOOL;   (* 非常停止が健全（NC接点。押される・断線で FALSE） *)
    bSeated        : BOOL;   (* 着座センサ *)
    bWashButton    : BOOL;   (* 「おしり」ボタン *)
    bStopButton    : BOOL;   (* 「止」ボタン（通常停止） *)
    bResetButton   : BOOL;   (* リセットボタン *)
    bNozzleAtFront : BOOL;   (* ノズル伸長端センサ *)
    bNozzleAtHome  : BOOL;   (* ノズル収納端センサ *)
    rWaterTemp     : REAL;   (* 水温 [℃] *)
    bIoHealthy     : BOOL;   (* 入力が生きている（通信ウォッチドッグ OK） *)
END_STRUCT
END_TYPE
