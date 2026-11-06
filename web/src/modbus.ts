// 依存ライブラリなしの最小 Modbus TCP クライアント
// 対応ファンクション: FC03 / FC04 / FC06 / FC16
import net from "node:net";

type Pending = {
  resolve: (pdu: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export class ModbusTcpClient {
  private host: string;
  private port: number;
  private unitId: number;
  private timeoutMs: number;
  private sock: net.Socket | null = null;
  private tid = 0;
  private buf = Buffer.alloc(0);
  private pending = new Map<number, Pending>();

  constructor(host: string, port = 502, unitId = 1, timeoutMs = 1000) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.timeoutMs = timeoutMs;
  }

  get connected() {
    return this.sock !== null;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      sock.setNoDelay(true);
      const onError = (err: Error) => reject(err);
      sock.once("error", onError);
      sock.once("connect", () => {
        sock.off("error", onError);
        this.sock = sock;
        sock.on("data", (d) => this.onData(d));
        sock.on("error", (e) => this.fail(e));
        sock.on("close", () => this.fail(new Error("connection closed")));
        resolve();
      });
    });
  }

  close() {
    this.sock?.destroy();
    this.sock = null;
  }

  /** FC03 Read Holding Registers */
  async readHoldingRegisters(addr: number, qty: number): Promise<number[]> {
    return this.readRegs(0x03, addr, qty);
  }

  /** FC04 Read Input Registers */
  async readInputRegisters(addr: number, qty: number): Promise<number[]> {
    return this.readRegs(0x04, addr, qty);
  }

  /** FC06 Write Single Register */
  async writeSingleRegister(addr: number, value: number): Promise<void> {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x06, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(value & 0xffff, 3);
    await this.request(pdu);
  }

  /** FC16 Write Multiple Registers（連続したレジスタを1回の通信でまとめて書く） */
  async writeMultipleRegisters(addr: number, values: number[]): Promise<void> {
    const pdu = Buffer.alloc(6 + values.length * 2);
    pdu.writeUInt8(0x10, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(values.length, 3);
    pdu.writeUInt8(values.length * 2, 5);
    values.forEach((v, i) => pdu.writeUInt16BE(v & 0xffff, 6 + i * 2));
    await this.request(pdu);
  }

  // ---- 内部処理 ----

  private async readRegs(fc: number, addr: number, qty: number) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(fc, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(qty, 3);
    const res = await this.request(pdu);
    const byteCount = res.readUInt8(1);
    const out: number[] = [];
    for (let i = 0; i < byteCount / 2; i++) out.push(res.readUInt16BE(2 + i * 2));
    return out;
  }

  // 要求は1つずつ送る（前の応答が返ってから次を送る）。
  // CODESYS の Modbus スレーブは、応答待ちの要求を複数送ると取りこぼすことがあるため
  private chain: Promise<unknown> = Promise.resolve();
  private request(pdu: Buffer): Promise<Buffer> {
    const run = () => this.send(pdu);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  private send(pdu: Buffer): Promise<Buffer> {
    const sock = this.sock;
    if (!sock) return Promise.reject(new Error("not connected"));

    this.tid = (this.tid + 1) & 0xffff;
    const tid = this.tid;

    // MBAP ヘッダ: TransactionID(2) ProtocolID(2)=0 Length(2) UnitID(1)
    const mbap = Buffer.alloc(7);
    mbap.writeUInt16BE(tid, 0);
    mbap.writeUInt16BE(0, 2);
    mbap.writeUInt16BE(pdu.length + 1, 4);
    mbap.writeUInt8(this.unitId, 6);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tid);
        reject(new Error(`timeout (fc=${pdu[0]})`));
      }, this.timeoutMs);
      this.pending.set(tid, { resolve, reject, timer });
      sock.write(Buffer.concat([mbap, pdu]));
    });
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 7) {
      const len = this.buf.readUInt16BE(4);
      const total = 6 + len;
      if (this.buf.length < total) break;

      const frame = this.buf.subarray(0, total);
      this.buf = this.buf.subarray(total);

      const tid = frame.readUInt16BE(0);
      const pdu = frame.subarray(7);
      const p = this.pending.get(tid);
      if (!p) continue;
      this.pending.delete(tid);
      clearTimeout(p.timer);

      const fc = pdu.readUInt8(0);
      if (fc & 0x80) {
        p.reject(new Error(`Modbus exception fc=${fc & 0x7f} code=${pdu.readUInt8(1)}`));
      } else {
        p.resolve(pdu);
      }
    }
  }

  private fail(err: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.sock?.destroy();
    this.sock = null;
  }
}
