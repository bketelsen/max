export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

function createHeaders(token: string | null, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);

  nextHeaders.set("X-Max-Client", "web");

  if (token) {
    nextHeaders.set("Authorization", `Bearer ${token}`);
  }

  return nextHeaders;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

export function createApiClient(token: string | null): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: createHeaders(token, init?.headers),
    });

    const payload = await parseResponse<unknown>(response);

    if (!response.ok) {
      const errorMessage =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `${response.status} ${response.statusText}`.trim();

      throw new Error(errorMessage);
    }

    return payload as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers:
          body === undefined ? undefined : { "Content-Type": "application/json" },
        method: "POST",
      }),
  };
}
