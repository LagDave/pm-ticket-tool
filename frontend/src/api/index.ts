/**
 * The ONE HTTP client (§12.1, §14.2). The only place axios lives, the only
 * place an Authorization header is set (§17.5), and the only place the
 * { success, data, error } envelope is unwrapped/thrown (§16.1). Domain files
 * (api/*.ts) and components never call axios/fetch directly.
 */
import axios, { AxiosRequestConfig } from "axios";

/** Error carrying the backend's machine code (§16.1). */
export class ApiError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message);
    this.name = "ApiError";
    this.code = opts?.code;
    this.status = opts?.status;
  }
}

/** Backend envelope shape (§8.1). */
interface ApiEnvelope<T = unknown> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details: unknown } | null;
}

/**
 * In dev the Vite proxy rewrites /api -> the backend. In prod set
 * VITE_API_BASE_URL (a public VITE_ var, §17.3). Only VITE_-prefixed config is
 * ever shipped to the bundle.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** The ONE place the JWT is read (§17.5). No auth layer yet — header is empty. */
export function getCommonHeaders(): Record<string, string> {
  // The auth spec will read a verified token here; foundation sends none.
  return {};
}

const client = axios.create({ baseURL: BASE_URL });

/** Unwrap the envelope, throwing ApiError on success:false (§16.1). */
function unwrap<T>(payload: unknown): T {
  const env = (payload ?? {}) as ApiEnvelope<T>;
  if (env && env.success === false) {
    throw new ApiError(env.error?.message ?? "Request failed", {
      code: env.error?.code,
    });
  }
  return (env.data ?? payload) as T;
}

/** Normalize transport/HTTP errors into ApiError (§16.1) — never leak raw axios. */
function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const env = error.response?.data as ApiEnvelope | undefined;
    return new ApiError(env?.error?.message ?? error.message, {
      code: env?.error?.code,
      status: error.response?.status,
    });
  }
  return new ApiError(error instanceof Error ? error.message : "Request failed");
}

async function withHeaders(config?: AxiosRequestConfig): Promise<AxiosRequestConfig> {
  return { ...config, headers: { ...getCommonHeaders(), ...config?.headers } };
}

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  try {
    const res = await client.get(url, await withHeaders(config));
    return unwrap<T>(res.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await client.post(url, body, await withHeaders(config));
    return unwrap<T>(res.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await client.patch(url, body, await withHeaders(config));
    return unwrap<T>(res.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function apiPut<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await client.put(url, body, await withHeaders(config));
    return unwrap<T>(res.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  try {
    const res = await client.delete(url, await withHeaders(config));
    return unwrap<T>(res.data);
  } catch (error) {
    throw toApiError(error);
  }
}
