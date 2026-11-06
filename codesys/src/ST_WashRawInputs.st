(*
 * ST_WashRawInputs
 * 目的 : IO から来る「生の値」。I/O 層（PRG_IoModbus）が詰め、変換層（FB_WashInputConv）が読む。
 *        実機の IO ユニットに替えるときは、この構造体に I/O マッピングで値を入れる。
 *        単位の換算や判断はしない。来た値をそのまま持つ。
 * 履歴 : 2026-11-06 新規作成（入力を構造体にまとめ、層に分けた）
 *)
TYPE ST_WashRawInputs :
STRUCT
    bEStopOk       : BOOL;   (* 非常停止 NC接点。閉 = TRUE = 健全 *)
    bSeated        : BOOL;   (* 着座センサ *)
    bWashButton    : BOOL;   (* 「おしり」ボタン *)
    bStopButton    : BOOL;   (* 「止」ボタン *)
    bResetButton   : BOOL;   (* リセットボタン *)
    bNozzleAtFront : BOOL;   (* ノズル伸長端センサ *)
    bNozzleAtHome  : BOOL;   (* ノズル収納端センサ *)
    wWaterTempRaw  : WORD;   (* 水温 [℃×100]（38.00℃ → 3800） *)
    wHeartbeat     : WORD;   (* 機械側のハートビート。毎回 +1 される *)
END_STRUCT
END_TYPE
