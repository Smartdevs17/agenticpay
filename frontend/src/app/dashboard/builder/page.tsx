"use client";

import React, { useEffect } from 'react';
import DashboardGrid from '../../../components/dashboard/DashboardGrid';
import { useDashboardStore } from '../../../store/useDashboardStore';

export default function DashboardBuilderPage() {
  const { isEditing, setEditing, addWidget, saveDashboard, loadDashboard } = useDashboardStore();

  const tenantId = 't_123';
  const userId = 'u_456';

  useEffect(() => {
    loadDashboard(tenantId, userId);
  }, [loadDashboard]);

  const handleSave = async () => {
    setEditing(false);
    await saveDashboard(tenantId, userId);
    alert('Dashboard saved!');
  };

  const handleAddWidget = (type: any) => {
    addWidget({ x: 0, y: Infinity, w: 6, h: 4, type, title: `New ${type}` });
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 text-gray-900">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Customizable Dashboard Builder</h1>
        
        <div className="space-x-4">
          {isEditing ? (
            <>
              <button onClick={() => handleAddWidget('metric-card')} className="bg-blue-500 text-white px-4 py-2 rounded shadow hover:bg-blue-600 transition">Add Metric Card</button>
              <button onClick={() => handleAddWidget('line-chart')} className="bg-green-500 text-white px-4 py-2 rounded shadow hover:bg-green-600 transition">Add Line Chart</button>
              <button onClick={() => handleAddWidget('data-table')} className="bg-purple-500 text-white px-4 py-2 rounded shadow hover:bg-purple-600 transition">Add Data Table</button>
              <button onClick={handleSave} className="bg-gray-800 text-white px-6 py-2 rounded shadow hover:bg-black transition font-semibold">Save Layout</button>
            </>
          ) : (
            <button 
              onClick={() => setEditing(true)} 
              className="bg-gray-800 text-white px-6 py-2 rounded shadow hover:bg-black transition font-semibold"
            >
              Edit Layout
            </button>
          )}
        </div>
      </div>

      <div className="bg-gray-200 p-4 rounded-xl shadow-inner border border-gray-300 overflow-x-auto">
        <DashboardGrid />
      </div>
    </div>
  );
}
