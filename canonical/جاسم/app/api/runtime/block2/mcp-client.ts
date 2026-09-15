/**
 * Minimal MCP JSON-RPC 2.0 client. This is intentionally a real HTTP
 * transport boundary: no SDK, in-memory adapter, retries, or invented task
 * completion.
 */

import { lookup } from "node:dns/promises";
import { request as requestHttp, type IncomingHttpHeaders } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export type McpClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export class McpClientError extends Error {
  readonly rpcCode?: number;
  readonly code: "TRANSPORT" | "PROTOCOL" | "TIMEOUT";

  constructor(
    message: string,
    code: "TRANSPORT" | "PROTOCOL" | "TIMEOUT",
    rpcCode?: number,
  ) {
    super(message);
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
};

export type McpTaskReference = {
  id: string;
  status: unknown;
};

export type McpToolCallResult = {
  content: unknown;
  isError: boolean;
  receiptSignature?: string;
  taskReference?: McpTaskReference;
};

const PROTOCOL_VERSION = "2025-06-18";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function ipv4Number(address: string): number | undefined {
  if (isIP(address) !== 4) return undefined;
  return address
    .split(".")
    .map(Number)
    .reduce((value, octet) => value * 256 + octet, 0);
}

function isNonPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return true;
  const first = value >>> 24;
  const second = (value >>> 16) & 0xff;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function ipv6Number(address: string): bigint | undefined {
  let source = address.toLowerCase();
  const zoneIndex = source.indexOf("%");
  if (zoneIndex >= 0) source = source.slice(0, zoneIndex);

  const ipv4Match = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Match) {
    const ipv4 = ipv4Number(ipv4Match[1]);
    if (ipv4 === undefined) return undefined;
    source = `${source.slice(0, -ipv4Match[1].length)}${(ipv4 >>> 16).toString(16)}:${(
      ipv4 & 0xffff
    ).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return undefined;
  }
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return undefined;
  }
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isNonPublicIpv6(address: string): boolean {
  const value = ipv6Number(address);
  if (value === undefined) return true;
  if (value === 0n || value === 1n) return true;
  if ((value >> 121n) === 0x7en) return true; // fc00::/7
  if ((value >> 118n) === 0x3fan) return true; // fe80::/10
  if ((value >> 32n) === 0xffffn) {
    const mapped = Number(value & 0xffffffffn);
    const addressV4 = [
      mapped >>> 24,
      (mapped >>> 16) & 0xff,
      (mapped >>> 8) & 0xff,
      mapped & 0xff,
    ].join(".");
    return isNonPublicIpv4(addressV4);
  }
  return false;
}

function isNonPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isNonPublicIpv4(address);
  if (version === 6) return isNonPublicIpv6(address);
  return true;
}

/**
 * Synchronous portion of the remote endpoint trust boundary. DNS names are
 * resolved by assertResolvedPublicEndpoint before transport is attempted.
 */
export function assertTrustedRemoteEndpoint(rawUrl: string | URL): void {
  let url: URL;
  try {
    url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  } catch {
    throw new McpClientError("Remote endpoint URL is invalid", "TRANSPORT");
  }
  const host = normalizedHostname(url);
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new McpClientError("Remote endpoints require HTTPS outside loopback", "TRANSPORT");
  }
  if (!loopback && isIP(host) !== 0 && isNonPublicAddress(host)) {
    throw new McpClientError("Remote endpoint targets a private network address", "TRANSPORT");
  }
}

type PinnedAddress = {
  address: string;
  family: number;
};

type PinnedEndpoint = {
  url: URL;
  addresses: PinnedAddress[];
};

export async function assertResolvedPublicEndpoint(url: URL): Promise<PinnedEndpoint> {
  assertTrustedRemoteEndpoint(url);
  const host = normalizedHostname(url);
  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    return { url, addresses: [{ address: host, family: literalFamily }] };
  }

  let addresses: PinnedAddress[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new McpClientError(
      `Remote endpoint DNS resolution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "TRANSPORT",
    );
  }
  if (addresses.length === 0) {
    throw new McpClientError("Remote endpoint DNS resolution returned no addresses", "TRANSPORT");
  }
  const trusted = addresses.every(({ address }) => {
    if (host === "localhost" && (address === "127.0.0.1" || address === "::1")) return true;
    return !isNonPublicAddress(address);
  });
  if (!trusted) {
    throw new McpClientError("Remote endpoint resolves to a private network address", "TRANSPORT");
  }
  return {
    url,
    addresses: addresses.map(({ address, family }) => ({ address, family })),
  };
}

function pinnedLookup(endpoint: PinnedEndpoint): LookupFunction {
  const expectedHostname = normalizedHostname(endpoint.url);
  const addresses = endpoint.addresses.map(({ address, family }) => ({ address, family }));
  return (hostname, options, callback) => {
    if (hostname.toLowerCase().replace(/^\[|\]$/g, "") !== expectedHostname) {
      const error = new Error("Pinned DNS lookup received an unexpected hostname");
      Object.assign(error, { code: "EPERM" });
      callback(error, "", 0);
      return;
    }
    const requestedFamily =
      typeof options.family === "number" && options.family !== 0 ? options.family : undefined;
    const eligible = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    if (eligible.length === 0) {
      const error = new Error("Pinned DNS lookup has no address for the requested family");
      Object.assign(error, { code: "ENOTFOUND" });
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(
        null,
        eligible.map(({ address, family }) => ({ address, family })),
      );
      return;
    }
    callback(null, eligible[0].address, eligible[0].family);
  };
}

type PinnedHttpResponse = {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

function postPinned(
  endpoint: PinnedEndpoint,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
): Promise<PinnedHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = endpoint.url.protocol === "https:" ? requestHttps : requestHttp;
    const request = transport(
      endpoint.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...headers,
          "content-length": String(Buffer.byteLength(body)),
        },
        lookup: pinnedLookup(endpoint),
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("error", reject);
        response.once("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

export class McpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private endpointGuard?: Promise<PinnedEndpoint>;
  private nextId = 1;

  constructor(options: McpClientOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new McpClientError("MCP baseUrl is invalid", "TRANSPORT");
    }
    assertTrustedRemoteEndpoint(url);
    this.baseUrl = url.toString();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new McpClientError("MCP timeoutMs must be positive", "TRANSPORT");
    }
    this.headers = { ...options.headers };
  }

  async initialize(): Promise<Record<string, unknown>> {
    const result = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "jasim", version: "block2" },
    });
    if (!isRecord(result) || result.protocolVersion !== PROTOCOL_VERSION) {
      throw new McpClientError(
        `MCP server selected an unsupported protocolVersion: ${String(
          isRecord(result) ? result.protocolVersion : undefined,
        )}`,
        "PROTOCOL",
      );
    }
    return result;
  }

  async listTools(): Promise<unknown> {
    return this.request("tools/list", {});
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!name) throw new McpClientError("MCP tool name is required", "PROTOCOL");
    const result = await this.request("tools/call", { name, arguments: args });
    if (!isRecord(result)) {
      throw new McpClientError("MCP tools/call returned an invalid result", "PROTOCOL");
    }
    let taskReference: McpTaskReference | undefined;
    if (isRecord(result.task) && typeof result.task.id === "string") {
      taskReference = { id: result.task.id, status: result.task.status };
    }
    return {
      content: result.content,
      isError: result.isError === true,
      ...(isRecord(result.receipt) &&
      result.receipt.algorithm === "hmac-sha256" &&
      typeof result.receipt.signature === "string"
        ? { receiptSignature: result.receipt.signature }
        : {}),
      ...(taskReference ? { taskReference } : {}),
    };
  }

  async getTask(taskId: string): Promise<unknown> {
    if (!taskId) throw new McpClientError("MCP task id is required", "PROTOCOL");
    return this.request("tasks/get", { taskId });
  }

  async cancelTask(taskId: string): Promise<{ confirmed: boolean }> {
    if (!taskId) throw new McpClientError("MCP task id is required", "PROTOCOL");
    const result = await this.request("tasks/cancel", { taskId });
    if (!isRecord(result)) return { confirmed: false };
    // Confirmation is evidence from the server, never inferred from HTTP 2xx.
    return { confirmed: result.confirmed === true };
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.endpointGuard ??= assertResolvedPublicEndpoint(new URL(this.baseUrl));
    let endpoint = await this.endpointGuard;

    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: PinnedHttpResponse;
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      for (let redirects = 0; ; redirects += 1) {
        response = await postPinned(endpoint, this.headers, body, controller.signal);
        if (response.status < 300 || response.status >= 400) break;
        if (redirects >= 3) {
          throw new McpClientError("MCP transport exceeded the redirect limit", "TRANSPORT");
        }
        const rawLocation = response.headers.location;
        const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
        if (!location) {
          throw new McpClientError("MCP redirect response lacks a Location header", "TRANSPORT");
        }
        endpoint = await assertResolvedPublicEndpoint(new URL(location, endpoint.url));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new McpClientError(`MCP request timed out after ${this.timeoutMs}ms`, "TIMEOUT");
      }
      if (error instanceof McpClientError) throw error;
      throw new McpClientError(
        `MCP transport failed: ${error instanceof Error ? error.message : String(error)}`,
        "TRANSPORT",
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new McpClientError(
        `MCP server returned HTTP ${response.status} ${response.statusText}`,
        "TRANSPORT",
      );
    }

    let payload: JsonRpcResponse;
    try {
      payload = JSON.parse(response.body.toString("utf8")) as JsonRpcResponse;
    } catch {
      throw new McpClientError("MCP server returned invalid JSON", "PROTOCOL");
    }
    if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
      throw new McpClientError("Invalid JSON-RPC response envelope", "PROTOCOL");
    }
    if (payload.error !== undefined) {
      const rpcCode =
        isRecord(payload.error) && typeof payload.error.code === "number"
          ? payload.error.code
          : undefined;
      const message =
        isRecord(payload.error) && typeof payload.error.message === "string"
          ? payload.error.message
          : "MCP server returned a JSON-RPC error";
      throw new McpClientError(message, "PROTOCOL", rpcCode);
    }
    if (!Object.prototype.hasOwnProperty.call(payload, "result")) {
      throw new McpClientError("JSON-RPC response lacks a result", "PROTOCOL");
    }
    return payload.result;
  }
}

export function createMcpClient(options: McpClientOptions): McpClient {
  return new McpClient(options);
}