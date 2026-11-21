/**
 * backend/src/repositories/ReportRepository.ts
 *
 * Repository encapsulation for ReportJob, ReportArchive, SavedReport, and ScheduledReport.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export class ReportRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): ReportRepository {
    return new ReportRepository(tx);
  }

  async findJobById(id: string) {
    return this.db.reportJob.findUnique({
      where: { id },
    });
  }

  async createJob(data: any) {
    return this.db.reportJob.create({ data });
  }

  async updateJobStatus(id: string, status: string, resultUrl?: string, error?: string) {
    return this.db.reportJob.update({
      where: { id },
      data: { status, resultUrl, error, updatedAt: new Date() },
    });
  }

  async listJobsByMerchant(merchantId: string, limit = 50) {
    return this.db.reportJob.findMany({
      where: { merchantId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createArchive(data: any) {
    return this.db.reportArchive.create({ data });
  }

  async listArchives(reportType?: string, limit = 50) {
    return this.db.reportArchive.findMany({
      where: reportType ? { reportType } : undefined,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const defaultReportRepository = new ReportRepository();
