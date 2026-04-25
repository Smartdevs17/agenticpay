export type AuthProvider = {
  getAccessToken: () => Promise<string | null> | string | null;
};

export function buildAuthHeader(token: string | null | undefined): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
