// Upstream 1.0.0 ships these types, but omits them from its package exports map.
declare module "@web3-storage/multipart-parser" {
  export function streamMultipart(body: ReadableStream<Uint8Array>, boundary: string): AsyncGenerator<{
    name: string;
    filename?: string;
    contentType?: string;
    data: AsyncIterable<Uint8Array>;
  }>;
}
