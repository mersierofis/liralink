import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDKZYQI4HI347ZVAMXT2XPHLYDSDKN6ERELKASGJDII6AQU6ROFQ45EJ",
  }
} as const


export const Errors = {
  1: {message:"AlreadyExists"},
  2: {message:"NotFound"},
  3: {message:"NotPending"},
  4: {message:"Expired"},
  5: {message:"InvalidAmount"}
}

export enum Status {
  Pending = 0,
  Paid = 1,
  Cancelled = 2,
}

export type DataKey = {tag: "Token", values: void} | {tag: "Admin", values: void} | {tag: "Invoice", values: readonly [string]};


export interface Invoice {
  amount: i128;
  code: string;
  deadline: u32;
  merchant: string;
  payer: Option<string>;
  status: Status;
}



export interface Client {
  /**
   * Construct and simulate a get transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read an invoice. Panics with `NotFound` if the code is unknown.
   */
  get: ({code}: {code: string}, options?: MethodOptions) => Promise<AssembledTransaction<Invoice>>

  /**
   * Construct and simulate a pay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payer settles a pending, unexpired invoice: transfers `amount` of the pinned
   * token payer -> merchant (authorized by the payer), then marks it Paid.
   */
  pay: ({code, payer}: {code: string, payer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin cancels a still-pending invoice.
   */
  cancel: ({code}: {code: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin records an invoice payable to `merchant`. Fails if `code` already exists or
   * `amount <= 0`.
   */
  create: ({merchant, code, amount, deadline}: {merchant: string, code: string, amount: i128, deadline: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {token, admin}: {token: string, admin: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({token, admin}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABQAAAAAAAAAAAAAABFBhaWQAAAABAAAABHBhaWQAAAAEAAAAAAAAAARjb2RlAAAAEQAAAAEAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAAAAAACG1lcmNoYW50AAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABQAAAAAAAAANQWxyZWFkeUV4aXN0cwAAAAAAAAEAAAAAAAAACE5vdEZvdW5kAAAAAgAAAAAAAAAKTm90UGVuZGluZwAAAAAAAwAAAAAAAAAHRXhwaXJlZAAAAAAEAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAABQ==",
        "AAAAAwAAAAAAAAAAAAAABlN0YXR1cwAAAAAAAwAAAAAAAAAHUGVuZGluZwAAAAAAAAAAAAAAAARQYWlkAAAAAQAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAAAAAAAAAAABVRva2VuAAAAAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAABAAAAAAAAAAdJbnZvaWNlAAAAAAEAAAAR",
        "AAAAAQAAAAAAAAAAAAAAB0ludm9pY2UAAAAABgAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAARjb2RlAAAAEQAAAAAAAAAIZGVhZGxpbmUAAAAEAAAAAAAAAAhtZXJjaGFudAAAABMAAAAAAAAABXBheWVyAAAAAAAD6AAAABMAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAZTdGF0dXMAAA==",
        "AAAABQAAAAAAAAAAAAAAB0NyZWF0ZWQAAAAAAQAAAAdjcmVhdGVkAAAAAAQAAAAAAAAABGNvZGUAAAARAAAAAQAAAAAAAAAIbWVyY2hhbnQAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAIZGVhZGxpbmUAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAEAAAAJY2FuY2VsbGVkAAAAAAAAAgAAAAAAAAAEY29kZQAAABEAAAABAAAAAAAAAAhtZXJjaGFudAAAABMAAAAAAAAAAg==",
        "AAAAAAAAAD9SZWFkIGFuIGludm9pY2UuIFBhbmljcyB3aXRoIGBOb3RGb3VuZGAgaWYgdGhlIGNvZGUgaXMgdW5rbm93bi4AAAAAA2dldAAAAAABAAAAAAAAAARjb2RlAAAAEQAAAAEAAAfQAAAAB0ludm9pY2UA",
        "AAAAAAAAAJNQYXllciBzZXR0bGVzIGEgcGVuZGluZywgdW5leHBpcmVkIGludm9pY2U6IHRyYW5zZmVycyBgYW1vdW50YCBvZiB0aGUgcGlubmVkCnRva2VuIHBheWVyIC0+IG1lcmNoYW50IChhdXRob3JpemVkIGJ5IHRoZSBwYXllciksIHRoZW4gbWFya3MgaXQgUGFpZC4AAAAAA3BheQAAAAACAAAAAAAAAARjb2RlAAAAEQAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAACZBZG1pbiBjYW5jZWxzIGEgc3RpbGwtcGVuZGluZyBpbnZvaWNlLgAAAAAABmNhbmNlbAAAAAAAAQAAAAAAAAAEY29kZQAAABEAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAGBBZG1pbiByZWNvcmRzIGFuIGludm9pY2UgcGF5YWJsZSB0byBgbWVyY2hhbnRgLiBGYWlscyBpZiBgY29kZWAgYWxyZWFkeSBleGlzdHMgb3IKYGFtb3VudCA8PSAwYC4AAAAGY3JlYXRlAAAAAAAEAAAAAAAAAAhtZXJjaGFudAAAABMAAAAAAAAABGNvZGUAAAARAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACGRlYWRsaW5lAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAJtEZXBsb3ktdGltZTogcGluIHRoZSB0b2tlbiAoVVNEQyBTdGVsbGFyIEFzc2V0IENvbnRyYWN0IGFkZHJlc3MpIHRoYXQgYHBheWAgdHJhbnNmZXJzCmFuZCB0aGUgYWRtaW4gKHBsYXRmb3JtIGFjY291bnQpIHRoYXQgbWF5IGNyZWF0ZSBhbmQgY2FuY2VsIGludm9pY2VzLgAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get: this.txFromJSON<Invoice>,
        pay: this.txFromJSON<Result<void>>,
        cancel: this.txFromJSON<Result<void>>,
        create: this.txFromJSON<Result<void>>
  }
}