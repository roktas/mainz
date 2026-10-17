import type { Failure, Operation, Reply, Result } from "./protocol.ts";
import type { Job } from "./model.ts";
import type { Scalar } from "./styles.ts";

const messages: Record<string, string> = {
  "pdf-syntax": "PDF Composer cannot read this PDF. Try an unprotected copy that opens in a PDF viewer.",
  "missing-contract": "This PDF has no editable styles. Choose a PDF prepared for styling.",
  "unsupported-version":
    "This PDF uses a style format that PDF Composer does not support. Update PDF Composer or ask its creator for a compatible PDF.",
  "unsupported-context":
    "This PDF contains features that PDF Composer does not support. Ask its creator for a supported PDF.",
  "invalid-contract":
    "The style information in this PDF is invalid or incompatible with PDF Composer. Ask its creator to prepare it again with the current Mainz format.",
  "invalid-request": "The page or style choices are invalid. Review your choices and try again.",
  "limit-exceeded": "This PDF or Output exceeds the processing limits. Try a smaller PDF or fewer Output pages.",
};

class OperationError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind === "processor" ? (messages[failure.record.code] ?? failure.record.message) : failure.message);
  }
}

export class Processor {
  private worker?: Worker;
  private active?: {
    revision: number;
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
  };

  run(
    bytes: Uint8Array,
    revision: number,
    changes?: {
      apply: Record<string, Scalar>;
      reset: string[];
      buffer?: { input: string; pages: number[] };
    },
  ): Promise<Result> {
    const input = bytes.slice().buffer;
    return this.send({ bytes: input, changes }, revision, [input]);
  }

  compose(job: Job, inputs: { id: string; bytes: Uint8Array }[], revision: number): Promise<Result> {
    const bindings = Object.fromEntries(inputs.map((input) => [input.id, input.bytes.slice().buffer]));
    return this.send({ job, inputs: bindings }, revision, Object.values(bindings));
  }

  private send(operation: Operation, revision: number, transfers: ArrayBuffer[]): Promise<Result> {
    if (this.active) return Promise.reject(new Error("A processing job is already active."));
    if (!this.worker) {
      this.worker = new Worker(new URL("./processor.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.addEventListener("message", (event: MessageEvent<Reply>) => {
        const reply = event.data;
        if (!this.active || reply.revision !== this.active.revision) return;
        const active = this.active;
        this.active = undefined;
        if ("failure" in reply) active.reject(new OperationError(reply.failure));
        else active.resolve(reply);
      });
      this.worker.addEventListener("error", (event) => {
        event.preventDefault();
        this.stop(new Error("PDF processing failed. Reload PDF Composer and try again."));
      });
      this.worker.addEventListener("messageerror", () =>
        this.stop(new Error("PDF processing returned an unreadable result. Try the action again.")),
      );
    }
    return new Promise((resolve, reject) => {
      this.active = { revision, resolve, reject };
      try {
        this.worker!.postMessage(
          {
            revision,
            ...operation,
            moduleUrl: new URL(`${import.meta.env.BASE_URL}processor.mjs`, location.href).href,
          },
          transfers,
        );
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error("Cannot send the processing input."));
      }
    });
  }

  cancel() {
    if (this.active) this.dispose();
  }

  dispose() {
    this.stop(new DOMException("Processing cancelled.", "AbortError"));
  }

  private stop(error: Error) {
    this.worker?.terminate();
    this.worker = undefined;
    const active = this.active;
    this.active = undefined;
    active?.reject(error);
  }
}
