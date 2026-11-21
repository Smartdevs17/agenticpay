const CSRF_TOKEN_KEY = "csrfToken";
const CSRF_HEADER_NAME = "x-csrf-token";

class CsrfManager {
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  async getToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    this.tokenPromise = this.fetchToken();
    this.token = await this.tokenPromise;
    this.tokenPromise = null;

    return this.token;
  }

  private async fetchToken(): Promise<string> {
    try {
      const response = await fetch("/api/csrf-token", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch CSRF token");
      }

      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error("Error fetching CSRF token:", error);
      throw error;
    }
  }

  clearToken(): void {
    this.token = null;
    this.tokenPromise = null;
  }

  async attachToRequest(headers: HeadersInit = {}): Promise<HeadersInit> {
    const token = await this.getToken();
    return {
      ...headers,
      [CSRF_HEADER_NAME]: token,
    };
  }
}

export const csrfManager = new CsrfManager();

export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const method = options.method?.toUpperCase() || "GET";
  const safeMethods = ["GET", "HEAD", "OPTIONS"];

  if (safeMethods.includes(method)) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  }

  const headers = await csrfManager.attachToRequest(options.headers);

  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}

export function clearCsrfToken(): void {
  csrfManager.clearToken();
}

export async function initializeCsrf(): Promise<void> {
  await csrfManager.getToken();
}
