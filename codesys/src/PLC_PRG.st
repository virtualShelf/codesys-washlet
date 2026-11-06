(*
 * PLC_PRG
 * 目的 : 層を順に呼ぶ。
 *        I/O 層（入力）→ 変換層 → 制御層 → 出力のコピー → I/O 層（出力）
 *
 *   I/O 層  : PRG_IoModbus      Modbus 配列 ⇔ GVL_IO.stRawIn / stRawOut
 *   変換層  : FB_WashInputConv  生の値 → 制御が使う値（換算・通信ウォッチドッグ）
 *   制御層  : FB_Washlet        判断（非常停止・異常・インターロック・状態遷移）
 *
 * GVL_IO の各変数を書くのは 1 か所だけ（stRawIn は PRG_IoModbus、ほかはここ）。
 *
 * 構成 : 機械（ノズル・ヒーター・温度センサ・ボタン・非常停止）は Web 側にある。
 *        PLC は Modbus で「センサを読んで、出力を返す」だけ。実機の PLC と同じ立場。
 *        実機の IO ユニットに替えるときは、I/O 層だけを替える。
 *
 * 履歴 : 2026-10-30 新規作成
 *        2026-10-30 PRG_Sim を廃止。機械モデルを Web 側に移した
 *        2026-11-06 層に分けた。詰め替えを PRG_IoModbus、換算とウォッチドッグを FB_WashInputConv へ移した
 *)
PROGRAM PLC_PRG
VAR
    fbInputConv : FB_WashInputConv;
    fbWashlet   : FB_Washlet;
END_VAR

(* ---- 1. I/O 層（入力）：aFromTS → GVL_IO.stRawIn ---- *)
PRG_IoModbus.ReadInputs();

(* ---- 2. 変換層：生の値 → 制御が使う値 ---- *)
fbInputConv(stRawIn := GVL_IO.stRawIn);
GVL_IO.stIn := fbInputConv.stIn;

(* ---- 3. 制御層 ---- *)
fbWashlet(stIn := GVL_IO.stIn);
GVL_IO.stOut := fbWashlet.stOut;

(* ---- 4. 出力のコピー ---- *)
// 実機で出力の向き（反転など）を合わせるなら、ここで詰め替える。今はそのまま
GVL_IO.stRawOut := GVL_IO.stOut;

(* ---- 5. I/O 層（出力）：GVL_IO.stRawOut と状態 → aToTS ---- *)
PRG_IoModbus.eState        := fbWashlet.eState;
PRG_IoModbus.eAlarm        := fbWashlet.eAlarm;
PRG_IoModbus.bExtendPermit := fbWashlet.bExtendPermit;
PRG_IoModbus.bSprayPermit  := fbWashlet.bSprayPermit;
PRG_IoModbus.WriteOutputs();
