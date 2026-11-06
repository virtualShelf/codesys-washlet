(*
 * FB_WashInputConv
 * 目的 : 変換層。IO から来た生の値（ST_WashRawInputs）を、制御が使う値（ST_WashInputs）にする。
 *        - 水温の換算 [℃×100] → [℃]
 *        - 通信ウォッチドッグ（ハートビートが T_LINK_TIMEOUT の間変わらなければ、入力を信用しない）
 *        IO の種類（Modbus か、実機の IO ユニットか）には関係しない。差し替えても、ここはそのまま使う。
 *
 * 入力:
 *   stRawIn   IO から来た生の値
 * 出力:
 *   stIn      制御が使う値
 *
 * 履歴 : 2026-11-06 新規作成（PLC_PRG にあった換算とウォッチドッグを移した）
 *)
FUNCTION_BLOCK FB_WashInputConv
VAR_INPUT
    stRawIn : ST_WashRawInputs;
END_VAR
VAR_OUTPUT
    stIn : ST_WashInputs;
END_VAR
VAR
    tonLinkLost : TON;
    wLastBeat   : WORD;   (* 前のサイクルに見えたハートビート *)
END_VAR
VAR CONSTANT
    T_LINK_TIMEOUT : TIME := T#500MS;   (* Web 側の書き込み周期 50 ms の 10 倍 *)
    R_TEMP_SCALE   : REAL := 100.0;     (* [℃×100] → [℃] *)
END_VAR

(* ---- 1. ボタン・センサ ---- *)
// チャタリング除去を入れるなら、ここ（ボタンやセンサごとに TON / TOF をかける）。
// 今は Web 側の機械モデルなので、接点のばたつきが無く、入れていない。
stIn.bEStopOk       := stRawIn.bEStopOk;
stIn.bSeated        := stRawIn.bSeated;
stIn.bWashButton    := stRawIn.bWashButton;
stIn.bStopButton    := stRawIn.bStopButton;
stIn.bResetButton   := stRawIn.bResetButton;
stIn.bNozzleAtFront := stRawIn.bNozzleAtFront;
stIn.bNozzleAtHome  := stRawIn.bNozzleAtHome;

(* ---- 2. 水温の換算 ---- *)
stIn.rWaterTemp := WORD_TO_REAL(stRawIn.wWaterTempRaw) / R_TEMP_SCALE;   (* [℃] *)

(* ---- 3. 通信ウォッチドッグ ---- *)
// ハートビートが止まったら、センサの値は「最後に見えた値」でしかない。信用しない。
// TON は毎サイクル呼ぶ（IF の中に入れない）
tonLinkLost(IN := stRawIn.wHeartbeat = wLastBeat, PT := T_LINK_TIMEOUT);
wLastBeat := stRawIn.wHeartbeat;
stIn.bIoHealthy := NOT tonLinkLost.Q;
