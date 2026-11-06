# codesys-washlet

温水洗浄便座を題材に、非常停止とインターロックを学ぶ CODESYS（ST）サンプル。
画面の名前は **全自動もも洗浄装置 MOMO-WASH 3000**。お尻のかわりに桃を洗います。

> 注意: 学習用です。本物の非常停止は、安全リレーや安全PLCで動力を物理的に遮断します。
> 通常PLCのソフトだけで安全機能を作らないでください。

PLC 側は `codesys/`、TypeScript 側は `web/` にまとめてある。Node 22.18 以上で `.ts` を直接実行する。依存ライブラリはないので `npm install` は不要。

CODESYS 側のコードの解説（状態遷移図・フローチャート付き）は [`docs/CODE_GUIDE.md`](docs/CODE_GUIDE.md)。

## 構成：機械は Web 側、判断は PLC 側

実機と同じ役割分担にしてある。PLC は「センサを読んで、出力を返す」だけで、物理現象は持たない。

```
┌──────────── Web（web/src/plant.ts） ────────────┐        ┌────── CODESYS ───────┐
│ 機械モデル                                      │        │                      │
│  ・非常停止ボタン（NC接点）                     │  HR    │  I/O 層              │
│  ・着座センサ / リモコン（おしり・止・リセット）│ ─────▶ │   PRG_IoModbus       │
│  ・ノズル（ソレノイド + 伸長端/収納端センサ）   │        │  変換層              │
│  ・温水タンク（ヒーター + 温度センサ）          │  IR    │   FB_WashInputConv   │
│  ・ポンプ                                       │ ◀───── │  制御層              │
│                                                 │        │   FB_Washlet         │
│ PLC の外の安全回路                              │        └──────────────────────┘
│  ・安全リレー（非常停止で全動力を遮断）         │
│  ・温度ヒューズ（55℃で切れる。交換するまで戻らない）│
└─────────────────────────────────────────────────┘
```

| 持ち場 | 中身 |
|---|---|
| PLC（FB_Washlet） | 状態遷移、インターロック、非常停止・異常の判断、ヒーターの温度制御（38℃ ヒステリシス）、42℃ で FAULT |
| PLC（FB_WashInputConv） | 変換層。生の値 → 制御が使う値（水温 ÷100、通信ウォッチドッグ 500ms） |
| PLC（PRG_IoModbus） | I/O 層。Modbus 配列 ⇔ `GVL_IO.stRawIn` / `stRawOut` の詰め替え |
| PLC（PLC_PRG） | 層を順に呼ぶだけ（I/O 層の入力 → 変換層 → 制御層 → 出力のコピー → I/O 層の出力） |
| Web（plant.ts） | ノズルの動き、水温の変化、センサの値、水の行き先（もも・床・便器）、安全リレー、温度ヒューズ、故障注入 |
| Web（server.ts） | 50ms ごとに PLC と1往復（IR を読む → 機械を進める → HR を書く）、SSE 配信 |

PLC の中は 3 つの層に分けてある。層の間の受け渡しは `GVL_IO` の構造体 4 つ（`stRawIn` / `stIn` / `stOut` / `stRawOut`）。
実機の IO ユニットにつなぐときは、I/O 層（`PRG_IoModbus`）を外して `stRawIn` / `stRawOut` を I/O マッピングで割り当てるだけで、変換層と制御層はそのまま使える。

数値（ヒーターの上がり方、噴射量、ヒューズの温度など）はすべてシミュレーション用の設定値で、実在の製品の仕様ではない。

画面の補足:

- 右上で日本語 / English を切り替えられる。文言は `web/public/i18n.js` にまとめてあり、選んだ言語はブラウザに保存される
- 非常停止ボタンは、赤い操作部・背後は黄色・文字なし
- 壁リモコンのボタン色は、おしり（始動）= 緑、止（停止）= 黒、リセット = 青。停止に赤を使わないのは、すぐ横の非常停止と見分けるため

## 優先順位（FB_Washlet）

1. 非常停止（どの状態からでも ESTOP。解除＋リセットで、収納から再開。ESTOP 中はヒーターも止める）
2. 異常（通信断・センサ矛盾・水温上限・タイムアウトで FAULT。原因が消えるまでリセット不可）
3. インターロック（着座・ノズル位置・水温・通信がそろわないと伸長／噴射しない。遷移と出力の二重チェック）

## CODESYS の設定

1. ST を取り込む：[codesys-st-sync](https://github.com/virtualShelf/codesys-st-sync) で `codesys\src` をプロジェクト（`codesys\washlet.project`）にインポート
   - 列挙型 2つ（`E_WashState` / `E_WashAlarm`）、構造体 3つ（`ST_WashRawInputs` / `ST_WashInputs` / `ST_WashOutputs`）、GVL 2つ、FB 2つ（`FB_Washlet` / `FB_WashInputConv`）、プログラム 2つ（`PLC_PRG` / `PRG_IoModbus`。`PRG_IoModbus` にはアクション `ReadInputs` / `WriteOutputs`）
   - タスクに入れるのは `PLC_PRG` だけ（`PRG_IoModbus` は `PLC_PRG` から呼ぶ）
2. タスク設定：`MainTask` に `PLC_PRG`（周期 10ms 程度）
3. Modbus：Ethernet の下に ModbusTCP Slave Device を追加
   - Input Registers：**10**、Holding Registers：**10**
   - I/O マッピングで Input Registers → `GVL_Modbus.aToTS`、Holding Registers → `GVL_Modbus.aFromTS`
   - 「変数の更新」を「有効（常に更新）」に
4. ビルド → ログイン → ダウンロード → Run
5. `web` で `npm run ui`、ブラウザで **http://localhost:3002**（接続先は `MB_HOST` / `MB_PORT` で変更可）

エレベータ（3001）と同時に開けるよう、ポートを分けてある。ただし Modbus の 502 番は1つの PLC しか使えないので、PLC 側はどちらか一方を Run する。

## 遊び方

1. 起動直後は PLC から見ると非常停止扱い（HR がまだ 0 のため）。まず「リセット」
2. 水温が 38℃ 付近になるのを待つ。待たずに洗うと「ひゃっ！」が増える
3. ももを座らせて「おしり」。洗浄中に立たせる・「止」・非常停止を試す
4. いたずらパネルで故障を入れて、PLC とハードのどちらが止めたかを見る

| いたずら | 期待する結果 | 止めたのは |
|---|---|---|
| ノズルに異物 | 3秒で EXTEND_TIMEOUT | PLC |
| 端センサ短絡 | 即 NOZZLE_SENSOR_BOTH | PLC |
| ヒーターリレー溶着 | 42℃ で FAULT。でもヒーターは止まらず、55℃ で温度ヒューズが切れる | ハード |
| 非常停止の配線を切る | 押したのと同じく ESTOP（NC接点だから） | ハード＋PLC |
| 通信ケーブルを抜く | 500ms で IO_LINK_LOST | PLC |

## レジスタマップ

Holding Registers（TS → PLC）＝ 機械のセンサ・ボタン

| アドレス | 中身 |
|---|---|
| HR0 | bit0 非常停止 NC接点（閉=1） / bit1 着座 / bit2 おしり / bit3 止 / bit4 リセット / bit5 伸長端 / bit6 収納端 |
| HR1 | 水温 ×100（38.00℃ → 3800） |
| HR2 | ハートビート（毎回 +1。止まると PLC は通信断と判断） |

Input Registers（PLC → TS）

| アドレス | 中身 |
|---|---|
| IR0 | 状態（E_WashState） |
| IR1 | 異常（E_WashAlarm） |
| IR2 | bit0 伸長 / bit1 収納 / bit2 ポンプ / bit3 ヒーター / bit4 伸長許可 / bit5 噴射許可 |
| IR3 | PLC から見えている入力（HR0 と同じ並び）+ bit7 通信OK |
| IR4 | PLC が受け取った水温 ×100 |
| IR5 | PLC のハートビート |

## テスト

```bash
cd web
npm test   # 機械モデル（安全リレー・温度ヒューズ・NC接点など）のテスト
```
