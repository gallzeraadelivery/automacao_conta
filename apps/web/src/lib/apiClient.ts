const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}
export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function rawRequest<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (!options.skipAuth && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const json = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!json) {
    return {
      success: false,
      error: { code: "NETWORK_ERROR", message: "Falha ao comunicar com o servidor" },
    };
  }

  return json;
}

async function tryRefresh(): Promise<boolean> {
  const result = await rawRequest<{ accessToken: string }>("/api/auth/refresh", {
    method: "POST",
    skipAuth: true,
  });
  if (result.success) {
    setAccessToken(result.data.accessToken);
    return true;
  }
  return false;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<ApiResponse<T>> {
  let result = await rawRequest<T>(path, options);

  if (!result.success && result.error.code === "INVALID_TOKEN" && !options.skipAuth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      result = await rawRequest<T>(path, options);
    }
  }

  return result;
}

/**
 * Baixa um arquivo autenticado (ex: exportação de relatório em CSV/PDF) -
 * um `<a href>` simples não consegue enviar o header Authorization, então
 * isto busca via fetch e aciona o download no navegador com um link
 * temporário. Retorna `false` se a resposta não for OK (ex: sessão expirada).
 */
export async function apiDownload(path: string, filename: string): Promise<boolean> {
  async function doFetch(): Promise<Response> {
    const headers = new Headers();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${API_URL}${path}`, { headers, credentials: "include" });
  }

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) response = await doFetch();
  }
  if (!response.ok) return false;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
