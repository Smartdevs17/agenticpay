// API versioning service — Issue #526
// Manages API versions, changelog generation, and deprecation handling

import { PrismaClient, ApiVersion, ApiVersionStatus } from '@prisma/client';

export class ApiVersioningService {
  constructor(private prisma: PrismaClient) {}

  async createVersion(
    version: string,
    description?: string,
    changelogUrl?: string,
    migrationGuideUrl?: string,
  ): Promise<ApiVersion> {
    return this.prisma.apiVersion.create({
      data: {
        version,
        description,
        changelogUrl,
        migrationGuideUrl,
        status: 'active' as ApiVersionStatus,
      },
    });
  }

  async getVersion(version: string): Promise<ApiVersion | null> {
    return this.prisma.apiVersion.findUnique({
      where: { version },
      include: { endpoints: true, usage: true },
    });
  }

  async listVersions(status?: ApiVersionStatus) {
    const where = status ? { status } : undefined;
    return this.prisma.apiVersion.findMany({
      where,
      include: { endpoints: true },
      orderBy: { releaseDate: 'desc' },
    });
  }

  async deprecateVersion(versionId: string, sunsetDate: Date): Promise<ApiVersion> {
    return this.prisma.apiVersion.update({
      where: { id: versionId },
      data: {
        status: 'deprecated' as ApiVersionStatus,
        deprecationDate: new Date(),
        sunsetDate,
      },
    });
  }

  async sunsetVersion(versionId: string): Promise<ApiVersion> {
    return this.prisma.apiVersion.update({
      where: { id: versionId },
      data: { status: 'sunset' as ApiVersionStatus },
    });
  }

  async registerEndpoint(
    versionId: string,
    path: string,
    method: string,
    changes?: string,
    migrationNotes?: string,
  ) {
    return this.prisma.apiVersionEndpoint.create({
      data: {
        versionId,
        path,
        method,
        changes,
        migrationNotes,
      },
    });
  }

  async getEndpoint(versionId: string, path: string, method: string) {
    return this.prisma.apiVersionEndpoint.findUnique({
      where: { versionId_path_method: { versionId, path, method } },
    });
  }

  async recordUsage(versionId: string, requestCount: number = 1, uniqueClients: number = 1) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.apiVersionUsage.findUnique({
      where: { versionId_date: { versionId, date: today } },
    });

    if (existing) {
      return this.prisma.apiVersionUsage.update({
        where: { id: existing.id },
        data: {
          requestCount: { increment: requestCount },
          uniqueClients: { increment: uniqueClients },
        },
      });
    }

    return this.prisma.apiVersionUsage.create({
      data: { versionId, date: today, requestCount, uniqueClients },
    });
  }

  async getVersionUsage(versionId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.prisma.apiVersionUsage.findMany({
      where: {
        versionId,
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
    });
  }

  async generateChangelog(fromVersion: string, toVersion: string): Promise<string> {
    const from = await this.getVersion(fromVersion);
    const to = await this.getVersion(toVersion);

    if (!from || !to) {
      return 'Version not found';
    }

    let changelog = `# Changelog: ${fromVersion} to ${toVersion}\n\n`;
    changelog += `Generated: ${new Date().toISOString()}\n\n`;

    if (to.endpoints && to.endpoints.length > 0) {
      changelog += '## Endpoint Changes\n\n';
      for (const endpoint of to.endpoints) {
        changelog += `### ${endpoint.method} ${endpoint.path}\n`;
        if (endpoint.changes) {
          changelog += `**Changes:** ${endpoint.changes}\n`;
        }
        if (endpoint.migrationNotes) {
          changelog += `**Migration:** ${endpoint.migrationNotes}\n`;
        }
        changelog += '\n';
      }
    }

    return changelog;
  }

  async getMigrationGuide(version: string): Promise<string> {
    const versionData = await this.getVersion(version);
    if (!versionData) {
      return 'Version not found';
    }

    let guide = `# Migration Guide: ${version}\n\n`;
    guide += `Release Date: ${versionData.releaseDate.toISOString()}\n`;
    guide += `Status: ${versionData.status}\n\n`;

    if (versionData.description) {
      guide += `## Overview\n${versionData.description}\n\n`;
    }

    guide += `## Endpoints\n`;
    if (versionData.endpoints && versionData.endpoints.length > 0) {
      for (const endpoint of versionData.endpoints) {
        guide += `\n### ${endpoint.method} ${endpoint.path}\n`;
        if (endpoint.migrationNotes) {
          guide += `${endpoint.migrationNotes}\n`;
        }
      }
    }

    guide += `\n## Support\nFor more information, see the [API documentation](${versionData.migrationGuideUrl || '#'})\n`;

    return guide;
  }

  async getVersionStats() {
    const versions = await this.listVersions();
    const stats: Record<string, any> = {};

    for (const version of versions) {
      const usage = await this.getVersionUsage(version.id, 90);
      const totalRequests = usage.reduce((sum, u) => sum + u.requestCount, 0);

      stats[version.version] = {
        status: version.status,
        endpoints: version.endpoints?.length || 0,
        lastMonth: totalRequests,
        releaseDate: version.releaseDate,
        deprecatedSince: version.deprecationDate,
        sunsetDate: version.sunsetDate,
      };
    }

    return stats;
  }
}
