import { create } from 'zustand';

export interface WidgetLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'line-chart' | 'metric-card' | 'data-table';
  title?: string;
  config?: any;
}

interface DashboardState {
  widgets: WidgetLayout[];
  isEditing: boolean;
  setEditing: (editing: boolean) => void;
  addWidget: (widget: Omit<WidgetLayout, 'i'>) => void;
  removeWidget: (id: string) => void;
  updateLayout: (layout: any[]) => void;
  saveDashboard: (tenantId: string, userId: string) => Promise<void>;
  loadDashboard: (tenantId: string, userId: string) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  widgets: [
    { i: '1', x: 0, y: 0, w: 6, h: 4, type: 'metric-card', title: 'Total Volume' },
    { i: '2', x: 6, y: 0, w: 6, h: 4, type: 'line-chart', title: 'Revenue Trend' },
    { i: '3', x: 0, y: 4, w: 12, h: 6, type: 'data-table', title: 'Recent Transactions' },
  ],
  isEditing: false,
  setEditing: (editing) => set({ isEditing: editing }),
  addWidget: (widget) => set((state) => ({
    widgets: [...state.widgets, { ...widget, i: Date.now().toString() }]
  })),
  removeWidget: (id) => set((state) => ({
    widgets: state.widgets.filter((w) => w.i !== id)
  })),
  updateLayout: (layout) => set((state) => {
    const newWidgets = state.widgets.map(w => {
      const layoutItem = layout.find(l => l.i === w.i);
      if (layoutItem) {
        return { ...w, x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h };
      }
      return w;
    });
    return { widgets: newWidgets };
  }),
  saveDashboard: async (tenantId, userId) => {
    const { widgets } = get();
    await fetch('/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        userId,
        name: 'Default Dashboard',
        widgets
      })
    });
  },
  loadDashboard: async (tenantId, userId) => {
    const res = await fetch(`/api/dashboards?tenantId=${tenantId}&userId=${userId}`);
    const data = await res.json();
    if (data && data.length > 0 && data[0].widgets) {
      const dbWidgets = data[0].widgets.map((w: any) => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        type: w.type,
        title: w.title,
        config: w.config
      }));
      set({ widgets: dbWidgets });
    }
  }
}));
