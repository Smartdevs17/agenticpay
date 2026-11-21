export interface GitHubRepository { id: number; fullName: string; url: string; private: boolean; }

export class GitHubIntegrationService {
  async listRepositories(token: string): Promise<GitHubRepository[]> {
    if (!token) throw new Error('GitHub token is required');
    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    const repositories = await response.json() as Array<{ id: number; full_name: string; html_url: string; private: boolean }>;
    return repositories.map((repo) => ({ id: repo.id, fullName: repo.full_name, url: repo.html_url, private: repo.private }));
  }

  async verifyRepository(repositoryUrl: string, token?: string): Promise<GitHubRepository> {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/#]+)\/?$/.exec(repositoryUrl);
    if (!match) throw new Error('Invalid GitHub repository URL');
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}`, { headers });
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    const repo = await response.json() as { id: number; full_name: string; html_url: string; private: boolean };
    return { id: repo.id, fullName: repo.full_name, url: repo.html_url, private: repo.private };
  }
}

export const githubIntegrationService = new GitHubIntegrationService();