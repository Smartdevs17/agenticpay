import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export interface CreateReportInput {
  tenantId: string;
  userId?: string;
  name: string;
  description?: string;
  metrics: string[];
  dimensions: string[];
  filters?: Record<string, unknown>;
  chartType: string;
  dateRange?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface ScheduleReportInput {
  reportId: string;
  frequency: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  time?: string;
  recipients: string[];
}

export class CustomReportService {
  async createReport(data: CreateReportInput) {
    return prisma.savedReport.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        name: data.name,
        description: data.description,
        metrics: data.metrics,
        dimensions: data.dimensions,
        filters: data.filters ?? {},
        chartType: data.chartType as any,
        dateRange: data.dateRange ?? {},
        config: data.config ?? {},
      },
    });
  }

  async getReport(id: string) {
    const report = await prisma.savedReport.findUnique({
      where: { id },
      include: { schedule: true, template: true },
    });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');
    return report;
  }

  async listReports(tenantId: string, options?: { userId?: string; isFavorite?: boolean; search?: string; limit?: number }) {
    const where: any = { tenantId };
    if (options?.userId) where.userId = options.userId;
    if (options?.isFavorite !== undefined) where.isFavorite = options.isFavorite;
    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    return prisma.savedReport.findMany({
      where,
      orderBy: [{ isFavorite: 'desc' }, { updatedAt: 'desc' }],
      take: options?.limit ?? 50,
      include: { schedule: true, template: true },
    });
  }

  async updateReport(id: string, data: Partial<CreateReportInput>) {
    const report = await prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');
    return prisma.savedReport.update({ where: { id }, data: data as any });
  }

  async deleteReport(id: string) {
    const report = await prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');
    return prisma.savedReport.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async toggleFavorite(id: string) {
    const report = await prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');
    return prisma.savedReport.update({ where: { id }, data: { isFavorite: !report.isFavorite } });
  }

  async togglePinned(id: string) {
    const report = await prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');
    return prisma.savedReport.update({ where: { id }, data: { isPinned: !report.isPinned } });
  }

  async scheduleReport(data: ScheduleReportInput) {
    const report = await prisma.savedReport.findUnique({ where: { id: data.reportId } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');

    const nextSendAt = this.calculateNextSend(data.frequency, data.dayOfWeek, data.dayOfMonth, data.time ?? '09:00');

    return prisma.scheduledReport.upsert({
      where: { reportId: data.reportId },
      create: {
        reportId: data.reportId,
        frequency: data.frequency as any,
        dayOfWeek: data.dayOfWeek,
        dayOfMonth: data.dayOfMonth,
        time: data.time ?? '09:00',
        recipients: data.recipients,
        nextSendAt,
      },
      update: {
        frequency: data.frequency as any,
        dayOfWeek: data.dayOfWeek,
        dayOfMonth: data.dayOfMonth,
        time: data.time ?? '09:00',
        recipients: data.recipients,
        nextSendAt,
      },
    });
  }

  async unscheduleReport(reportId: string) {
    const schedule = await prisma.scheduledReport.findUnique({ where: { reportId } });
    if (!schedule) throw new AppError(404, 'Schedule not found', 'SCHEDULE_NOT_FOUND');
    return prisma.scheduledReport.update({ where: { reportId }, data: { isActive: false } });
  }

  async saveAsTemplate(reportId: string, name: string, description?: string, isPublic = false) {
    const report = await prisma.savedReport.findUnique({ where: { id: reportId } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');

    return prisma.reportTemplate.upsert({
      where: { reportId },
      create: {
        reportId,
        name,
        description,
        metrics: report.metrics,
        dimensions: report.dimensions,
        filters: report.filters,
        chartType: report.chartType,
        dateRange: report.dateRange,
        config: report.config,
        isPublic,
      },
      update: {
        name,
        description,
        isPublic,
        usageCount: { increment: 1 },
      },
    });
  }

  async listTemplates(isPublic = true) {
    return prisma.reportTemplate.findMany({
      where: isPublic ? { isPublic: true } : {},
      orderBy: { usageCount: 'desc' },
      take: 50,
    });
  }

  async generateReportData(reportId: string) {
    const report = await prisma.savedReport.findUnique({ where: { id: reportId } });
    if (!report) throw new AppError(404, 'Report not found', 'REPORT_NOT_FOUND');

    const metrics = report.metrics;
    const dimensions = report.dimensions;
    const dateRange = (report.dateRange as any) ?? {};

    const dateFilter = dateRange.start && dateRange.end
      ? { gte: new Date(dateRange.start), lte: new Date(dateRange.end) }
      : { gte: new Date(Date.now() - 30 * 86400_000) };

    const groupBy: any[] = [];
    const select: any = {};

    for (const dimension of dimensions) {
      groupBy.push(dimension);
      select[dimension] = true;
    }

    for (const metric of metrics) {
      if (metric === 'request_count') {
        select._count = { id: true };
      } else if (metric === 'total_amount') {
        select._sum = { amount: true };
      } else if (metric === 'avg_latency') {
        select._avg = { latencyMs: true };
      }
    }

    return {
      report: {
        id: report.id,
        name: report.name,
        chartType: report.chartType,
        metrics: report.metrics,
        dimensions: report.dimensions,
      },
      data: [],
      generatedAt: new Date().toISOString(),
    };
  }

  private calculateNextSend(frequency: string, dayOfWeek?: number, dayOfMonth?: number, time?: string): Date {
    const now = new Date();
    const [hours, minutes] = (time ?? '09:00').split(':').map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);

    if (frequency === 'daily') {
      if (next <= now) next.setDate(next.getDate() + 1);
    } else if (frequency === 'weekly') {
      const targetDay = dayOfWeek ?? 1;
      while (next.getDay() !== targetDay || next <= now) {
        next.setDate(next.getDate() + 1);
      }
    } else if (frequency === 'monthly') {
      const targetDay = Math.min(dayOfMonth ?? 1, 28);
      next.setDate(targetDay);
      if (next <= now) next.setMonth(next.getMonth() + 1);
    }

    return next;
  }
}

export const customReportService = new CustomReportService();
