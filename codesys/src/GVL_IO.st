(*
 * GVL_IO
 * 目的 : 層と層の受け渡しの置き場所。ロジックは %IX/%QX や Modbus 配列を直接使わず、ここを使う。
 *
 *   stRawIn  … I/O 層（PRG_IoModbus.ReadInputs）が書く。IO から来た生の値
 *   stIn     … 変換層（FB_WashInputConv）の出力を PLC_PRG が書く。制御が使う値
 *   stOut    … 制御層（FB_Washlet）の出力を PLC_PRG が書く
 *   stRawOut … PLC_PRG が stOut をコピーして書く。I/O 層（PRG_IoModbus.WriteOutputs）が読む
 *
 * 各変数を書くのは 1 か所だけ。
 * 実機の IO ユニットに替えるときは、stRawIn / stRawOut を I/O マッピング先にして、
 * PRG_IoModbus を外すだけで済む（変換層と制御層はそのまま）。
 *
 * 履歴 : 2026-10-30 新規作成
 *        2026-11-06 個別の BOOL をやめ、構造体 4 つにした
 *)
VAR_GLOBAL
    stRawIn  : ST_WashRawInputs;   (* 入力：IO → PLC（生の値） *)
    stIn     : ST_WashInputs;      (* 入力：制御が使う値 *)
    stOut    : ST_WashOutputs;     (* 出力：制御の結果 *)
    stRawOut : ST_WashOutputs;     (* 出力：PLC → IO *)
END_VAR
