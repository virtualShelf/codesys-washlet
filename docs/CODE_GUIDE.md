# CODESYS 側コード解説

MOMO-WASH 3000 の PLC 側（`codesys/src/`）を、図を中心にざっくり説明する。
図は Mermaid で書いてあるので、GitHub や VS Code のプレビューでそのまま表示できる。

## 1. 全体像：PLC は「判断係」

PLC はセンサを読んで、出力を返すだけ。ノズルが動く、お湯が温まるといった物理は Web 側の機械モデルが持つ。

```mermaid
flowchart LR
    subgraph WEB["Web 側（機械モデル）"]
        SENS["センサ・ボタン<br/>非常停止 / 着座 / 端センサ / 水温"]
        ACT["アクチュエータ<br/>ノズル / ポンプ / ヒーター"]
        HW["PLC の外の安全回路<br/>安全リレー / 温度ヒューズ"]
    end
    subgraph PLC["CODESYS"]
        IO["PRG_IoModbus<br/>I/O 層：詰め替え"]
        CONV["FB_WashInputConv<br/>変換層：換算・通信の見張り"]
        FB["FB_Washlet<br/>制御層：判断"]
    end
    SENS -- "HR0〜HR2" --> IO
    IO --> CONV
    CONV --> FB
    FB --> IO
    IO -- "IR0〜IR5" --> ACT
    HW -. "PLC と関係なく動力を切る" .-> ACT
```

ポイントは、安全リレーと温度ヒューズが **PLC の外** にあること。PLC が壊れても、バグっていても、ここで止まる。

## 2. ファイルの役割

| ファイル | 種類 | 役割 |
|---|---|---|
| `E_WashState.st` | 列挙型 | 状態（IDLE / NOZZLE_EXTEND / SPRAY / NOZZLE_RETRACT / ESTOP / FAULT） |
| `E_WashAlarm.st` | 列挙型 | 異常の理由（最初の1件だけ残す） |
| `ST_WashRawInputs.st` | 構造体 | IO から来る生の値（ボタン・センサの BOOL、水温 ×100、ハートビート） |
| `ST_WashInputs.st` | 構造体 | 制御が使う値（水温 [℃]、通信 OK を含む 9 つ） |
| `ST_WashOutputs.st` | 構造体 | 機械を動かす出力 4 つ（伸長・収納・ポンプ・ヒーター） |
| `GVL_Modbus.st` | GVL | Modbus のレジスタ配列（`aFromTS` = HR、`aToTS` = IR） |
| `GVL_IO.st` | GVL | 層の間の受け渡し（`stRawIn` / `stIn` / `stOut` / `stRawOut`） |
| `PRG_IoModbus.st` | プログラム | I/O 層。Modbus 配列 ⇔ `stRawIn` / `stRawOut`。アクション `ReadInputs` / `WriteOutputs` |
| `FB_WashInputConv.st` | FB | 変換層。水温の換算、通信ウォッチドッグ |
| `FB_Washlet.st` | FB | 制御層。非常停止・異常・インターロック・状態遷移・ヒーター制御 |
| `PLC_PRG.st` | プログラム | 層を順に呼ぶだけ |

## 3. 層に分ける：差し替えるのは I/O 層だけ

PLC の中を 3 つの層に分けてある。狙いは、Web の機械モデルから実機の IO ユニットに替えるとき、**I/O 層だけを書き換えれば済む** ようにすること。

```mermaid
flowchart TB
    subgraph L1["I/O 層（PRG_IoModbus）… IO の種類ごとに替える"]
        RIN["ReadInputs<br/>aFromTS → stRawIn"]
        ROUT["WriteOutputs<br/>stRawOut → aToTS"]
    end
    subgraph L2["変換層（FB_WashInputConv）… IO が替わってもそのまま"]
        CONV["水温 ÷100<br/>通信ウォッチドッグ 500ms<br/>（チャタリング除去を入れるならここ）"]
    end
    subgraph L3["制御層（FB_Washlet）… IO が替わってもそのまま"]
        FB["非常停止・異常・インターロック<br/>状態遷移・ヒーター"]
    end
    RIN -- "GVL_IO.stRawIn<br/>ST_WashRawInputs" --> CONV
    CONV -- "GVL_IO.stIn<br/>ST_WashInputs" --> FB
    FB -- "GVL_IO.stOut → stRawOut<br/>ST_WashOutputs" --> ROUT
```

- 実機にするときは `PRG_IoModbus` を外し、`GVL_IO.stRawIn` / `stRawOut` を IO ユニットの I/O マッピングに割り当てる
- 生の値（`stRawIn`）と制御が使う値（`stIn`）を分けておくと、「IO からは何が来ているか」と「FB は何を見て判断したか」を別々にモニタできる
- `FB_Washlet` の入力は `stIn` 1 本（VAR_INPUT）。数十バイトと小さく、呼んだ時点の値がコピーされるので 1 サイクルの間は値が変わらない
- アクチュエータは `stOut` にまとめ、状態の出力（`eState` / `eAlarm` / 許可）は個別のまま残す。「機械を動かす出力」と「状態を知らせる出力」を分けるため
- `GVL_IO` の各変数を書くのは 1 か所だけ（`stRawIn` は `PRG_IoModbus`、ほかは `PLC_PRG`）

## 4. PLC_PRG：1サイクルの流れ

PLC は 10ms ごとに、上から下まで1回ずつ実行する。順番が大事。

```mermaid
flowchart TD
    A([サイクル開始]) --> B["① I/O 層（入力）<br/>PRG_IoModbus.ReadInputs<br/>aFromTS → GVL_IO.stRawIn"]
    B --> C["② 変換層<br/>fbInputConv：stRawIn → GVL_IO.stIn"]
    C --> C1{"ハートビートは<br/>前回から変わった？"}
    C1 -- 変わった --> D["タイマをリセット"]
    C1 -- "500ms 変わらない" --> E["stIn.bIoHealthy := FALSE<br/>（入力を信用しない）"]
    D --> F
    E --> F
    F["③ 制御層<br/>fbWashlet(stIn) → GVL_IO.stOut"] --> G["④ 出力のコピー<br/>stOut → stRawOut"]
    G --> H["⑤ I/O 層（出力）<br/>PRG_IoModbus.WriteOutputs<br/>出力・状態・異常を aToTS へ。PLC のハートビートを +1"]
    H --> Z([サイクル終了])
```

- 通信の見張り（ウォッチドッグ）は「Web 側が毎回 +1 する数字が止まったら、ケーブルが抜けたとみなす」仕組み
- 入力が止まると、センサの値は「最後に見えた値」のまま固まる。座っていないのに「座っている」と見え続けるかもしれないので、信用せずに止める
- ウォッチドッグは変換層にある。実機の IO ユニットでも「入力が生きているか」の判断は要るので、I/O 層ではなく変換層に置いた（実機では、IO ユニットの通信状態のビットなどを使う形に替える）

## 5. FB_Washlet：中は6段構え

FB の中も上から順に実行する。**止める判断が、動かす判断より先** に来るのが肝。

```mermaid
flowchart TD
    S1["1. タイマ・エッジ検出を毎回呼ぶ"] --> S2["2. インターロック条件を計算<br/>bExtendPermit / bSprayPermit"]
    S2 --> S3{"3. 非常停止が押されている？"}
    S3 -- はい --> ES["状態 := ESTOP"]
    S3 -- いいえ --> S3b{"異常がある？<br/>通信断 / 端センサ両方ON / 水温 ≥ 42℃"}
    S3b -- はい --> FA["状態 := FAULT"]
    S3b -- いいえ --> S4
    ES --> S4
    FA --> S4
    S4["4. CASE で通常の状態遷移"] --> S5["5. ヒーターの ON/OFF 判定<br/>（ヒステリシス）"]
    S5 --> S6["6. 出力を決める<br/>状態 AND 条件をもう一度"]
```

### 1. タイマとエッジ検出は毎回呼ぶ

```
tonExtend(IN := eState = E_WashState.NOZZLE_EXTEND, PT := T_EXTEND_TIMEOUT);
```

- `IF` の中で呼ぶと、呼ばれないサイクルにタイマがリセットされず、2回目から即タイムアウトしたりする
- 「いつ数えるか」は `IN` に条件を書いて決める
- ボタンは `R_TRIG`（立ち上がりエッジ）で見る。押しっぱなしで何度も反応しないように

### 2. インターロック条件を名前つきで計算

「この動作をしてよいか」を、先に1本の BOOL にまとめておく。

```mermaid
flowchart LR
    E1["非常停止 OK"] --> X(("AND"))
    E2["通信 OK"] --> X
    E3["着座"] --> X
    E4["収納端にいる"] --> X
    E5["水温 < 42℃"] --> X
    X --> P1["bExtendPermit<br/>ノズルを出してよい"]

    F1["非常停止 OK"] --> Y(("AND"))
    F2["通信 OK"] --> Y
    F3["着座"] --> Y
    F4["伸長端にいる"] --> Y
    F5["水温 < 42℃"] --> Y
    Y --> P2["bSprayPermit<br/>水を出してよい"]
```

名前をつけておくと、Modbus で公開して画面の「PLC の気持ち」に出せる。「なぜ動かないか」が一目で分かる。

### 3. 非常停止と異常は CASE の前で割り込む

- どの状態にいても、ここで ESTOP / FAULT に飛ぶ
- CASE の各状態に書き散らすと、状態を足したときに書き忘れる。入口で1回だけ判定すれば漏れない
- 異常の理由（`eAlarm`）は **最初の1件だけ** 残す。連鎖して出る2件目で上書きすると、本当の原因が分からなくなる

### 4. 状態遷移（6 章で図にする）

### 5. ヒーターはヒステリシスで制御

37℃ 未満で ON、38℃ 以上で OFF。間の 37〜38℃ は「今の状態を保つ」。

```mermaid
stateDiagram-v2
    direction LR
    HeatOff: ヒーター OFF
    HeatOn: ヒーター ON
    [*] --> HeatOff
    HeatOff --> HeatOn: 水温 < 37℃
    HeatOn --> HeatOff: 水温 ≥ 38℃
```

1つのしきい値だけだと、38℃ 付近で ON/OFF を高速に繰り返してリレーが傷む。幅（ヒステリシス）を持たせるのはそのため。

### 6. 出力は「状態 AND 条件」で二重にかける

```
stOut.bPump := eState = E_WashState.SPRAY AND bSprayPermit;
```

- 状態遷移にバグがあって SPRAY のまま残っても、立った瞬間に `bSprayPermit` が FALSE になりポンプは止まる
- 出力を書くのはこの1か所だけ。誰が止めたか追いやすい
- ヒーターは ESTOP 中と FAULT 中も OFF。「解除しただけでは何も動かさない」を徹底する

## 6. 状態遷移図

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE: IDLE 待機
    NOZZLE_EXTEND: NOZZLE_EXTEND ノズル伸長中
    SPRAY: SPRAY 洗浄中
    NOZZLE_RETRACT: NOZZLE_RETRACT ノズル収納中
    ESTOP: ESTOP 非常停止
    FAULT: FAULT 異常

    IDLE --> NOZZLE_EXTEND: おしり（立ち上がり）かつ 伸長許可
    IDLE --> NOZZLE_RETRACT: ノズルが収納端にいない

    NOZZLE_EXTEND --> SPRAY: 伸長端に到達
    NOZZLE_EXTEND --> NOZZLE_RETRACT: 立った / 止
    NOZZLE_EXTEND --> FAULT: 3秒で届かない

    SPRAY --> NOZZLE_RETRACT: 噴射許可が消えた / 止 / 60秒

    NOZZLE_RETRACT --> IDLE: 収納端に到達
    NOZZLE_RETRACT --> FAULT: 3秒で戻らない

    ESTOP --> NOZZLE_RETRACT: 非常停止解除 かつ リセット
    FAULT --> NOZZLE_RETRACT: リセット かつ 原因が消えた

    note right of ESTOP
        どの状態からでも
        非常停止で ESTOP へ
    end note
    note right of FAULT
        どの状態からでも
        通信断 / 端センサ両方ON / 水温 42℃以上 で FAULT へ
    end note
```

読み方のコツ:

- **普段の流れ** は IDLE → 伸長 → 洗浄 → 収納 → IDLE の輪
- **立つ・止・60秒** は異常ではない。「正常な停止」として収納に向かう。リセットはいらない
- **ESTOP と FAULT からの出口は、必ず NOZZLE_RETRACT**。続きから再開せず、まずノズルを引っ込める（安全側の動作から始める）
- FAULT は、原因が残っている間はリセットを受け付けない（例：お湯が冷めるまで待つ）
- CASE の `ELSE`（想定外の値）も FAULT に落とす。来てはいけない場所に来たら止める

## 7. 異常の一覧

| 異常（E_WashAlarm） | いつ出る | リセットできる条件 |
|---|---|---|
| ESTOP_PRESSED | 非常停止が押された・配線が切れた | 非常停止を戻してからリセット |
| EXTEND_TIMEOUT | ノズルが 3 秒で伸びきらない | リセットで収納から再試行 |
| RETRACT_TIMEOUT | ノズルが 3 秒で戻らない | 同上 |
| NOZZLE_SENSOR_BOTH | 伸長端と収納端が同時に ON | センサが直ってから |
| WATER_OVER_TEMP | 水温が 42℃ 以上 | 42℃ 未満に冷めてから |
| IO_LINK_LOST | 機械からの入力が 500ms 途絶えた | 通信が戻ってから |
| INVALID_STATE | 状態が想定外の値 | リセット |

## 8. 非常停止を押したときの流れ

ハード（安全リレー）が先に動力を切り、PLC はあとから状態を合わせる。PLC は「後始末係」。

```mermaid
sequenceDiagram
    actor U as 人
    participant B as 非常停止ボタン<br/>(NC接点)
    participant R as 安全リレー
    participant P as PLC (FB_Washlet)
    participant M as ノズル・ポンプ

    U->>B: 押す
    B->>R: 接点が開く
    R->>M: 動力を遮断（PLC を通さない）
    B->>P: HR0 bit0 = 0
    P->>P: 状態 := ESTOP、出力をすべて OFF
    Note over M: ノズルはその場で止まる

    U->>B: ひねって戻す
    B->>R: 接点が閉じる（動力は戻る）
    B->>P: HR0 bit0 = 1
    Note over P: まだ ESTOP のまま。勝手に動かない

    U->>P: リセット
    P->>M: ノズル収納
    M-->>P: 収納端 ON
    P->>P: 状態 := IDLE
```

## 9. まとめ

- PLC は判断だけ。物理と最後の安全装置（安全リレー・温度ヒューズ）は外にある
- PLC の中は I/O 層・変換層・制御層の 3 つ。IO を替えるときは I/O 層だけを替える
- 止める判断は CASE より先。非常停止と異常は入口で1回だけ見る
- インターロックは名前つきの BOOL にして、遷移と出力の2か所でかける
- 非常停止・異常からの再開は、リセット操作のあと、安全側（ノズル収納）から
- タイマとエッジ検出は毎サイクル呼ぶ
