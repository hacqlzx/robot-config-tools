declare module "archiver" {
  import { Transform } from "stream";

  interface ArchiverProgress {
    entries: { total: number; processed: number };
    fs: { totalBytes: number; processedBytes: number };
  }

  class Archiver extends Transform {
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T;
    directory(dirpath: string, destpath: string | false): this;
    file(filename: string, data: { name: string }): this;
    finalize(): Promise<void>;
    on(event: "progress", listener: (progress: ArchiverProgress) => void): this;
    on(event: "close", listener: () => void): this;
  }

  interface ZipArchiveOptions {
    zlib?: { level?: number };
  }

  export class ZipArchive extends Archiver {
    constructor(options?: ZipArchiveOptions);
    append(data: Buffer | string, options: { name: string }): this;
  }

  export class TarArchive extends Archiver {
    constructor(options?: any);
  }
}
