import type { Description, Scalar } from "./styles.ts";
import type { Content, Job } from "./model.ts";

export type ProcessorError = {
  code: string;
  message: string;
  parameter?: string;
  page?: string;
  region?: string;
  source?: "manifest" | "request";
  location?: string;
};
export type Failure = { kind: "processor"; record: ProcessorError } | { kind: "host"; message: string };
export type Operation =
  | {
      bytes: ArrayBuffer;
      changes?: {
        apply: Record<string, Scalar>;
        reset: string[];
        buffer?: { input: string; pages: number[] };
      };
    }
  | { job: Job; inputs: Record<string, ArrayBuffer> };
export type Request = Operation & {
  revision: number;
  moduleUrl: string;
};
export type Report = {
  version: 1;
  pages: (Content & { part: number; copy: number; padding?: boolean })[];
  parameters: Record<string, { source: string; parameter: string }>;
};
export type Result = {
  revision: number;
  bytes: ArrayBuffer;
  description: Description;
  report?: Report;
};
export type Reply = Result | { revision: number; failure: Failure };
