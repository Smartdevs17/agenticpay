import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get dashboards for a user
router.get('/', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = req.query;
    if (!tenantId || !userId) {
      return res.status(400).json({ error: 'tenantId and userId required' });
    }

    const dashboards = await prisma.userDashboard.findMany({
      where: {
        tenantId: tenantId as string,
        userId: userId as string
      },
      include: {
        widgets: true
      }
    });

    res.json(dashboards);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create/Update a dashboard and its widgets
router.post('/', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId, name, isDefault, widgets } = req.body;
    
    // Simplistic approach for epic: always create new or update based on name
    // In production, we'd use dashboard IDs.
    
    let dashboard = await prisma.userDashboard.findFirst({
      where: { tenantId, userId, name }
    });

    if (!dashboard) {
      dashboard = await prisma.userDashboard.create({
        data: { tenantId, userId, name, isDefault }
      });
    }

    // Replace widgets (simplistic logic)
    await prisma.dashboardWidget.deleteMany({
      where: { dashboardId: dashboard.id }
    });

    if (widgets && widgets.length > 0) {
      await prisma.dashboardWidget.createMany({
        data: widgets.map((w: any) => ({
          dashboardId: dashboard!.id,
          type: w.type,
          title: w.title,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          config: w.config || {}
        }))
      });
    }

    const updatedDashboard = await prisma.userDashboard.findUnique({
      where: { id: dashboard.id },
      include: { widgets: true }
    });

    res.json(updatedDashboard);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
