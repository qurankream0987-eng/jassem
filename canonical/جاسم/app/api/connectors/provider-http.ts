import { ConnectorExecutionFailure } from "../core/reviewed-http-connector";

export type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function providerJsonRequest(
  connectorId: string,
  fetchImpl: ProviderFetch,
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; maxBytes?: number; sideEffect?: boolean } = {},
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new ConnectorExecutionFailure(
      timedOut ? `Connector ${connectorId} timed out` : `Connector ${connectorId} transport failed`,
      true,
      options.sideEffect === true,
    );
  } finally {
    clearTimeout(timeout);
  }

  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ConnectorExecutionFailure(`Connector ${connectorId} response exceeded its limit`, true, options.sideEffect === true);
  const raw = await readLimited(response, maxBytes, connectorId, options.sideEffect === true);
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ConnectorExecutionFailure(`Connector ${connectorId} returned invalid JSON`, true, options.sideEffect === true && response.ok);
    }
  }
  if (!response.ok) {
    const providerFailure = response.status >= 500 || response.status === 408 || response.status === 429;
    throw Object.assign(
      new ConnectorExecutionFailure(`Connector ${connectorId} returned HTTP ${response.status}`, providerFailure, options.sideEffect === true && providerFailure),
      { statusCode: response.status },
    );
  }
  return { status: response.status, data };
}

async function readLimited(response: Response, maxBytes: number, connectorId: string, sideEffect: boolean): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ConnectorExecutionFailure(`Connector ${connectorId} response exceeded its limit`, true, sideEffect);
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
