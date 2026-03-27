'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, ExternalLink, Clock, Folder, Loader2, Filter, X, Calendar, DollarSign, Save, Trash2 } from 'lucide-react'; 
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ProjectCardSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty/EmptyState';
import { useRouter } from 'next/navigation';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { useAccount } from 'wagmi';

// Define the shape of a Filter Preset
interface FilterPreset {
  name: string;
  statuses: string[];
  minAmount: string;
  maxAmount: string;
  startDate: string;
  endDate: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { useUserProjects } = useAgenticPay();
  const { projects, loading } = useUserProjects();

  // --- FILTER STATE ---
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  // --- PRESETS STATE ---
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  // Load presets from LocalStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('project_presets');
    if (saved) setPresets(JSON.parse(saved));
  }, []);

  // --- FILTERING ENGINE (ALL CRITERIA MET) ---
  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesSearch = project.title?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Multi-status check
      const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(project.status);
      
      // Amount Range check
      const amt = parseFloat(project.totalAmount || '0');
      const min = minAmount === '' ? 0 : parseFloat(minAmount);
      const max = maxAmount === '' ? Infinity : parseFloat(maxAmount);
      const matchesAmount = amt >= min && amt <= max;

      // Date Range check
      const pDate = new Date(project.createdAt).getTime();
      const s = startDate ? new Date(startDate).getTime() : 0;
      const e = endDate ? new Date(endDate).setHours(23,59,59,999) : Infinity;
      const matchesDate = pDate >= s && pDate <= e;

      return matchesSearch && matchesStatus && matchesAmount && matchesDate;
    });
  }, [projects, searchQuery, selectedStatuses, minAmount, maxAmount, startDate, endDate]);

  // --- PRESET ACTIONS ---
  const saveCurrentFilter = () => {
    if (!presetName) return alert("Enter a name for the preset");
    const newPreset: FilterPreset = {
      name: presetName,
      statuses: selectedStatuses,
      minAmount,
      maxAmount,
      startDate,
      endDate
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    localStorage.setItem('project_presets', JSON.stringify(updated));
    setPresetName('');
  };

  const applyPreset = (p: FilterPreset) => {
    setSelectedStatuses(p.statuses);
    setMinAmount(p.minAmount);
    setMaxAmount(p.maxAmount);
    setStartDate(p.startDate);
    setEndDate(p.endDate);
  };

  const deletePreset = (name: string) => {
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    localStorage.setItem('project_presets', JSON.stringify(updated));
  };

  if (loading) return <div className="p-8"><Loader2 className="animate-spin" /> Loading...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Projects</h1>
        <Link href="/dashboard/projects/new">
          <Button className="bg-primary"><Plus className="mr-2 h-4 w-4" /> New Project</Button>
        </Link>
      </div>

      {/* --- ADVANCED FILTER BAR --- */}
      <Card className="shadow-md border-t-4 border-t-blue-500">
        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Status (Multiple) */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2"><Filter className="h-4 w-4" /> Statuses</label>
              <div className="flex flex-wrap gap-2">
                {['active', 'completed', 'cancelled'].map(s => (
                  <button
                    key={s}
                    onClick={() => setSelectedStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      selectedStatuses.includes(s) ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Range */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" /> Amount Range</label>
              <div className="flex gap-2">
                <input type="number" placeholder="Min" className="w-full border rounded p-2 text-sm" value={minAmount} onChange={e => setMinAmount(e.target.value)} />
                <input type="number" placeholder="Max" className="w-full border rounded p-2 text-sm" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} />
              </div>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> Date Range</label>
              <div className="flex gap-2">
                <input type="date" className="w-full border rounded p-2 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
                <input type="date" className="w-full border rounded p-2 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Presets Row */}
          <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <input 
                placeholder="Preset name..." 
                className="border rounded px-3 py-1 text-sm" 
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={saveCurrentFilter}><Save className="h-4 w-4 mr-2" /> Save Preset</Button>
            </div>
            
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-400">Your Presets:</span>
              {presets.map(p => (
                <div key={p.name} className="flex items-center bg-gray-100 rounded-md pr-1">
                  <button onClick={() => applyPreset(p)} className="px-2 py-1 text-xs hover:text-blue-600">{p.name}</button>
                  <Trash2 className="h-3 w-3 text-red-400 cursor-pointer" onClick={() => deletePreset(p.name)} />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid Rendering (Using filteredProjects) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimatePresence mode='popLayout'>
          {filteredProjects.map((project) => (
            <motion.div key={project.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
               {/* ... Your Existing Card Content ... */}
               <Card className="p-4">
                 <CardTitle>{project.title}</CardTitle>
                 <p>{project.totalAmount} {project.currency} - {project.status}</p>
                 <Link href={`/dashboard/projects/${project.id}`} className="text-blue-500 text-sm">View Details</Link>
               </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {filteredProjects.length === 0 && <EmptyState title="No matches found" icon={Folder} description="Try adjusting your filters or presets." />}
    </div>
  );
}