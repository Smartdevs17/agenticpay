'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, ExternalLink, Clock, Folder, Loader2, ChevronUp, ChevronDown, ChevronUpDown } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ProjectCardSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty/EmptyState';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { useAccount } from 'wagmi';
import { useMemo, useState } from 'react';
import { sortList } from '@/lib/utils/sort';

type SortField = 'createdAt' | 'totalAmount' | 'status';
type SortOrder = 'asc' | 'desc';

export default function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isConnected } = useAccount();
  const { useUserProjects } = useAgenticPay();
  const { projects, loading } = useUserProjects();

  // Initialize sort state from URL params or defaults
  const [sortBy, setSortBy] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Sync URL with sort state
  const updateSort = (field: SortField) => {
    if (field === sortBy) {
      // Toggle order if same field
      const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      setSortOrder(newOrder);
      updateURL(field, newOrder);
    } else {
      // New field, default to desc
      setSortBy(field);
      setSortOrder('desc');
      updateURL(field, 'desc');
    }
  };

  const updateURL = (field: SortField, order: SortOrder) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortBy', field);
    params.set('sortOrder', order);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  };

  // Sort projects
  const sortedProjects = useMemo(
    () => sortList(projects, sortBy, sortOrder),
    [projects, sortBy, sortOrder]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
            <p className="text-gray-600 mt-1">Manage your projects and milestones</p>
            <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading projects...
            </div>
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
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
    )
  }

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600 mt-1">Manage your projects and milestones</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Sort Controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Sort by:</span>
            <button
              onClick={() => updateSort('createdAt')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors ${
                sortBy === 'createdAt'
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Date
              {sortBy === 'createdAt' ? (
                sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUpDown className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => updateSort('totalAmount')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors ${
                sortBy === 'totalAmount'
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Amount
              {sortBy === 'totalAmount' ? (
                sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUpDown className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => updateSort('status')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors ${
                sortBy === 'status'
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Status
              {sortBy === 'status' ? (
                sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUpDown className="h-4 w-4" />
              )}
            </button>
          </div>
          <Link href="/dashboard/projects/new">
            <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sortedProjects.map((project, index) => {
          // Since contract uses 1 dummy milestone for status in our helper, we use that.
          const completedMilestones = project.milestones.filter(
            (m) => m.status === 'completed'
          ).length;
          const totalMilestones = project.milestones.length;
          const progressPercentage =
            totalMilestones > 0
              ? (completedMilestones / totalMilestones) * 100
              : 0;

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
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                        project.status
                      )}`}
                    >
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
                    <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
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
      </div>

      {sortedProjects.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={Folder}
              title="No projects found"
              description="Create your first project or wait to be hired."
              action={{
                label: 'Create Project',
                onClick: () => router.push('/dashboard/projects/new'),
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

