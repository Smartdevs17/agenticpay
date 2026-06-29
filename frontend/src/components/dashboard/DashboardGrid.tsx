import React, { useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useDashboardStore } from '../../store/useDashboardStore';

const DashboardGrid = () => {
  const { widgets, isEditing, updateLayout, removeWidget } = useDashboardStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const onLayoutChange = (layout: any) => {
    if (isEditing) {
      updateLayout(layout);
    }
  };

  const renderWidgetContent = (widget: any) => {
    switch (widget.type) {
      case 'metric-card':
        return <div className="p-4 bg-blue-50 h-full rounded-lg shadow"><h3 className="font-bold text-gray-700">{widget.title}</h3><p className="text-2xl font-bold text-blue-600">$10,400.00</p></div>;
      case 'line-chart':
        return <div className="p-4 bg-green-50 h-full rounded-lg shadow flex items-center justify-center"><p className="text-gray-500 italic">[Line Chart Visualization Placeholder]</p></div>;
      case 'data-table':
        return (
          <div className="p-4 bg-white h-full rounded-lg shadow overflow-auto">
            <h3 className="font-bold text-gray-700 mb-2">{widget.title}</h3>
            <table className="w-full text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr><th>ID</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr className="bg-white border-b"><td>#1001</td><td>$400</td><td>Completed</td></tr>
                <tr className="bg-white border-b"><td>#1002</td><td>$250</td><td>Pending</td></tr>
              </tbody>
            </table>
          </div>
        );
      default:
        return <div>Unknown Widget</div>;
    }
  };

  if (!mounted) return null;

  return (
    <div className="w-full relative">
      <GridLayout
        className="layout"
        layout={widgets}
        cols={12}
        rowHeight={30}
        width={1200} // In a real app use WidthProvider
        isDraggable={isEditing}
        isResizable={isEditing}
        onLayoutChange={onLayoutChange}
      >
        {widgets.map((widget) => (
          <div key={widget.i} className="relative group">
            {isEditing && (
              <button 
                onClick={() => removeWidget(widget.i)}
                className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded z-10 hidden group-hover:block text-xs"
              >
                X
              </button>
            )}
            {renderWidgetContent(widget)}
          </div>
        ))}
      </GridLayout>
    </div>
  );
};

export default DashboardGrid;
