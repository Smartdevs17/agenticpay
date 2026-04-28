'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, ExternalLink, Clock, Folder } from 'lucide-react';
import { Plus, ExternalLink, Clock, Folder, Loader2, Filter } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ProjectCardSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty/EmptyState';
import { useRouter } from 'next/navigation';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { useAccount } from 'wagmi';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

const FILTER_PRESETS_KEY = 'agenticpay-project-filter-presets';
const STATUS_OPTIONS = ['active', 'completed', 'cancelled'] as const;

type StatusOption = (typeof STATUS_OPTIONS)[number];

type FilterPreset = {
  name: string;
  status: StatusOption[];
  startDate: string;
  endDate: string;
  minAmount: string;
  maxAmount: string;
};

export default function ProjectsPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { useUserProjects } = useAgenticPay();
  const { projects, loading } = useUserProjects();
  const timezone = useAuthStore((state) => state.timezone);

  const [statusFilter, setStatusFilter] = useState<StatusOption[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<Record<string, FilterPreset>>({});

  useEffect(() => {
    const stored = window.localStorage.getItem(FILTER_PRESETS_KEY);
    if (stored) {
      try {
        setPresets(JSON.parse(stored));
      } catch {
        setPresets({});
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(presets));
  }, [presets]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const projectAmount = Number(project.totalAmount) || 0;
      const createdAt = new Date(project.createdAt).getTime();
      const targetStart = startDate ? new Date(startDate).getTime() : -Infinity;
      const targetEnd = endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;

      if (statusFilter.length > 0 && !statusFilter.includes(project.status as StatusOption)) {
        return false;
      }

      if (startDate && createdAt < targetStart) {
        return false;
      }

      if (endDate && createdAt > targetEnd) {
        return false;
      }

      if (minAmount && projectAmount < Number(minAmount)) {
        return false;
      }

      if (maxAmount && projectAmount > Number(maxAmount)) {
        return false;
      }

      return true;
    });
  }, [projects, statusFilter, startDate, endDate, minAmount, maxAmount]);

  const savePreset = () => {
    if (!presetName.trim()) {
      return;
    }

    setPresets((current) => ({
      ...current,
      [presetName.trim()]: {
        name: presetName.trim(),
        status: statusFilter,
        startDate,
        endDate,
        minAmount,
        maxAmount,
      },
    }));
    setPresetName('');
  };

  const clearFilters = () => {
    setStatusFilter([]);
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
  };

  const applyPreset = (preset: FilterPreset) => {
    setStatusFilter(preset.status);
    setStartDate(preset.startDate);
    setEndDate(preset.endDate);
    setMinAmount(preset.minAmount);
    setMaxAmount(preset.maxAmount);
  };

  const removePreset = (name: string) => {
    setPresets((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-gray-600 mt-1 dark:text-gray-400">Manage your projects and milestones</p>
            <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
              Loading projects...
            </div>
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-6">
          {[1, 2, 3, 4].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <h2 className="text-2xl font-bold">Please connect your wallet</h2>
        <p className="text-gray-500">Connect your wallet to view your projects.</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'completed': return 'bg-green-100 text-green-700 border-green-200';
      case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-gray-600 mt-1 dark:text-gray-400">Manage your projects and milestones</p>
        </div>
        <Link href="/dashboard/projects/new">
          <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
        {projects.map((project, index) => {
          const completedMilestones = project.milestones.filter((m) => m.status === 'completed').length;
          const totalMilestones = project.milestones.length;
          const progressPercentage = totalMilestones > 0 ? (completedMilestones / totalMilestones) * 100 : 0;

          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="hover:shadow-lg transition-all duration-200 border border-gray-200">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-2">{project.title}</CardTitle>
                      <p className="text-sm text-gray-600">Client: {project.client.address.slice(0, 6)}...{project.client.address.slice(-4)}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(project.status)}`}>
                      {project.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total Value</span>
                      <span className="font-semibold text-gray-900">{project.totalAmount} {project.currency}</span>
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,360px)_1fr]">
        <Card className="border border-gray-200">
          <CardHeader>
            <CardTitle>Advanced filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Filter className="h-4 w-4" />
              Use date, status, and amount filters to refine your projects.
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Status</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => (
                    <Button
                      key={option}
                      variant={statusFilter.includes(option) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setStatusFilter((current) =>
                          current.includes(option)
                            ? current.filter((value) => value !== option)
                            : [...current, option]
                        );
                      }}
                      className="capitalize"
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-2 text-sm text-gray-600">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="space-y-2 text-sm text-gray-600">
                  <span>End date</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-2 text-sm text-gray-600">
                  <span>Min amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={minAmount}
                    onChange={(event) => setMinAmount(event.target.value)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="space-y-2 text-sm text-gray-600">
                  <span>Max amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={maxAmount}
                    onChange={(event) => setMaxAmount(event.target.value)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>

              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" onClick={savePreset} className="w-full" size="sm">
                    Save preset
                  </Button>
                  <Button type="button" onClick={clearFilters} className="w-full" variant="outline" size="sm">
                    Clear filters
                  </Button>
                </div>
                <input
                  type="text"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name"
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {Object.keys(presets).length > 0 && (
                <div className="space-y-2 pt-4 border-t border-gray-200">
                  <p className="text-sm font-medium text-gray-700">Saved presets</p>
                  <div className="grid gap-2">
                    {Object.values(presets).map((preset) => (
                      <div key={preset.name} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{preset.name}</p>
                          <p className="text-xs text-gray-500">
                            {preset.status.length > 0 ? preset.status.join(', ') : 'Any status'} • {preset.startDate || 'Any start'} – {preset.endDate || 'Any end'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="xs" onClick={() => applyPreset(preset)}>
                            Apply
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => removePreset(preset.name)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {filteredProjects.map((project, index) => {
            const completedMilestones = project.milestones.filter((m) => m.status === 'completed').length;
            const totalMilestones = project.milestones.length;
            const progressPercentage = totalMilestones > 0 ? (completedMilestones / totalMilestones) * 100 : 0;

            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="hover:shadow-lg transition-all duration-200 border border-gray-200">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <CardTitle className="text-xl mb-2">{project.title}</CardTitle>
                        <p className="text-sm text-gray-600">
                          Client: {project.client.address.slice(0, 6)}...{project.client.address.slice(-4)}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total Value</span>
                        <span className="font-semibold text-gray-900">
                          {project.totalAmount} {project.currency}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full transition-all" style={{ width: `${progressPercentage}%` }} />

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>Status</span>
                          <span>{project.milestones[0]?.status.replace('_', ' ')}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full transition-all"
                            style={{ width: `${progressPercentage}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock className="h-3 w-3" />
                      <span>Created {formatDateInTimeZone(project.createdAt, timezone)}</span>
                    </div>

                    <Link href={`/dashboard/projects/${project.id}`}>
                      <Button variant="outline" className="w-full">
                        View Details
                        <ExternalLink className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}

      {projects.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={Folder}
              title="No projects found"
              description="Create your first project or wait to be hired."
              action={{ label: 'Create Project', onClick: () => router.push('/dashboard/projects/new') }}
            />
          </CardContent>
        </Card>
      )}
          {filteredProjects.length === 0 && (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Folder}
                  title="No projects match your filters"
                  description="Adjust the filters or clear them to see more projects."
                  action={{
                    label: 'Clear filters',
                    onClick: clearFilters,
                  }}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}