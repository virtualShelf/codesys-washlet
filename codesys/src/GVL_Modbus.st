(*
 * GVL_Modbus
 * 目的 : Web 側の「機械（plant）」とのやり取り（Modbus TCP）
 *   aFromTS : Holding Register（TS → PLC）＝ 機械のセンサ・ボタン
 *   aToTS   : Input Register  （PLC → TS）＝ PLC の出力・状態
 * レジスタの中身は README のレジスタマップ表を参照。
 * Modbus TCP Slave Device の I/O マッピングで、この2つの配列に割り当てる。
 * 履歴 : 2026-10-30 新規作成
 *        2026-10-30 機械モデルを Web 側に移したので、10 ワードずつに整理
 *)
VAR_GLOBAL
    aFromTS : ARRAY[0..9] OF WORD;
    aToTS   : ARRAY[0..9] OF WORD;
END_VAR
