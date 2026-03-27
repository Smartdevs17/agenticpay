'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, ExternalLink, CheckCircle2, Clock, Circle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ProjectDetailSkeleton } from '@/components/ui/loading-skeletons';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { OfflineActionQueuedError } from '@/lib/offline';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { address } = useAccount();
  const timezone = useAuthStore((state) => state.timezone);

  const { useProjectDetail, fundProject, submitWork, approveWork, isPending, isConfirming, isConfirmed, error, arbitrator } = useAgenticPay();
  const { project, loading, refetch } = useProjectDetail(projectId);

  const [repoLink, setRepoLink] = useState('');
  const [showSubmitInput, setShowSubmitInput] = useState(false);

  useEffect(() => {
    if (isConfirmed) {
      toast.success('Transaction confirmed!');
      setShowSubmitInput(false);
      // Refresh data without reloading page to prevent auth loss
      refetch();
    }
  }, [isConfirmed, refetch]);

  useEffect(() => {
    if (error) {
      toast.error('Transaction failed: ' + (error as { shortMessage?: string }).shortMessage || error.message);
    }
  }, [error]);

  if (loading) {
    return <ProjectDetailSkeleton />;
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-600 mb-4">Project not found or error loading.</p>
        <Link href="/dashboard/projects">
          <Button>Back to Projects</Button>
        </Link>
      </div>
    );
  }

  const isClient = address?.toLowerCase() === project.client.address.toLowerCase();
  const isFreelancer = address?.toLowerCase() === project.freelancer.address.toLowerCase();

  const handleFund = async () => {
    try {
      const paymentType = project.currency === 'ETH' ? 0 : 1;
      await fundProject(project.id, project.totalAmount, paymentType);
      toast.info('Funding transaction submitted...');
    } catch (e) {
      console.error(e);
    }
  };

  const handleApprove = async () => {
    try {
      await approveWork(project.id);
      toast.info('Approval transaction submitted...');
    } catch (e) {
      console.error(e);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-600" />;
      default:
        return <Circle className="h-5 w-5 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Projects', href: '/dashboard/projects' },
        ]}
        currentPage={project.title}
      />

      <Link href="/dashboard/projects">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Projects
        </Button>
      </Link>

      {/* Project Overview */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl mb-2">{project.title}</CardTitle>
              <p className="text-gray-600">Client: {project.client.address.slice(0, 6)}...{project.client.address.slice(-4)}</p>
              <p className="text-gray-600">Freelancer: {project.freelancer.address.slice(0, 6)}...{project.freelancer.address.slice(-4)}</p>
            </div>
            <span
              className={`px-4 py-2 rounded-full text-sm font-medium ${project.status === 'active'
                ? 'bg-blue-100 text-blue-700'
                : project.status === 'completed'
                  ? 'bg-green-100 text-green-700'
                  : project.status === 'verified'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
            >
              {project.status.toUpperCase()}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Total Amount</p>
              <p className="text-xl font-bold">
                {project.totalAmount} {project.currency}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Created</p>
              <p className="text-lg font-medium">
                {formatDateInTimeZone(project.createdAt, timezone)}
              </p>
            </div>
          </div>
          {project.githubRepo && (
            <div>
              <p className="text-sm text-gray-600 mb-2">GitHub Repository</p>
              <a
                href={project.githubRepo}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:underline"
              >
                {project.githubRepo}
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-4 border-t mt-4 flex gap-4 flex-wrap">
            {/* Client Actions */}
            {isClient && (
              <>
                {project.milestones[0]?.status === 'pending' && (
                  <Button onClick={handleFund} disabled={isPending || isConfirming}>
                    {(isPending || isConfirming) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Fund Project
                  </Button>
                )}
                {project.githubRepo && project.status !== 'completed' && (
                  <Button onClick={handleApprove} variant="default" className="bg-green-600 hover:bg-green-700" disabled={isPending || isConfirming}>
                    {(isPending || isConfirming) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Approve & Release Payment
                  </Button>
                )}
              </>
            )}

            {/* Freelancer Actions */}
            {isFreelancer && (
              <>
                {/* Funded/Started -> Submit */}
                {project.milestones[0]?.status !== 'pending' && project.status !== 'completed' && !showSubmitInput && !project.githubRepo && (
                  <Button onClick={() => setShowSubmitInput(true)}>
                    Submit Work
                  </Button>
                )}

                {/* Submitted -> Request Verification */}
                {project.githubRepo && project.status !== 'completed' && (
                  <Button onClick={async () => {
                    try {
                      toast.info('Requesting AI Verification...');
                      const verification = await api.verifyWork({
                        repositoryUrl: project.githubRepo!,
                        milestoneDescription: project.milestones[0]?.description || project.title,
                        projectId: project.id
                      });
                      if (verification.status === 'passed') {
                        toast.success("Work Verified by AI!");
                        try {
                          // Trigger invoice gen
                          await api.generateInvoice({
                            projectId: project.id,
                            workDescription: "Verified work",
                            hoursWorked: 0,
                            hourlyRate: 0
                          });
                          toast.success("Invoice Generated");
                          refetch();
                        } catch (invError) {
                          if (invError instanceof OfflineActionQueuedError) {
                            toast.info(invError.message);
                          } else {
                            toast.error("Invoice error: " + (invError as Error).message);
                          }
                        }
                      } else {
                        toast.error("Verification failed: " + verification.summary);
                      }
                    } catch (e) {
                      if (e instanceof OfflineActionQueuedError) {
                        toast.info(e.message);
                      } else {
                        toast.error((e as Error).message);
                      }
                    }
                  }}>
                    Request AI Verification
                  </Button>
                )}
              </>
            )}
          </div>

          {showSubmitInput && (
            <div className="p-4 bg-gray-50 rounded-lg space-y-3 border">
              <Label>GitHub Repository URL</Label>
              <Input
                placeholder="https://github.com/..."
                value={repoLink}
                onChange={(e) => setRepoLink(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={async () => {
                  try {
                    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                      throw new Error('You are offline. Reconnect before submitting an on-chain transaction.');
                    }
                    if (!repoLink) throw new Error("No repo link");
                    toast.info('Submitting work to blockchain...');
                    await submitWork(project.id, repoLink);
                    toast.info('Transaction submitted. Once confirmed, request verification.');
                    setShowSubmitInput(false);
                  } catch (e) {
                    toast.error('Submission failed: ' + (e as Error).message);
                  }
                }}>
                  Submit Work
                </Button>
                <Button variant="ghost" onClick={() => setShowSubmitInput(false)}>Cancel</Button>
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Contract Milestone View (Single) */}
      <Card>
        <CardHeader>
          <CardTitle>Milestones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {project.milestones.map((milestone, index) => (
              <motion.div
                key={milestone.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="p-4 border border-gray-200 rounded-lg"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3 flex-1">
                    {getStatusIcon(milestone.status)}
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{milestone.title}</h4>
                      {milestone.description && (
                        <p className="text-sm text-gray-600 mt-1">{milestone.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {milestone.amount} {project.currency}
                    </p>
                    {milestone.dueDate && (
                      <p className="text-xs text-gray-500">
                        Due: {formatDateInTimeZone(milestone.dueDate, timezone)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Progress</span>
                    <span>{milestone.completionPercentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${milestone.status === 'completed'
                        ? 'bg-green-600'
                        : milestone.status === 'in_progress'
                          ? 'bg-blue-600'
                          : 'bg-gray-300'
                        }`}
                      style={{ width: `${milestone.completionPercentage}%` }}
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-8 border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="text-sm text-yellow-800">Debug Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <p className="text-gray-500">Contract Status Index</p>
              <p>{project.rawStatus ?? 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Deposited Amount</p>
              <p>{project.depositedAmount ?? '0'} {project.currency}</p>
            </div>
            <div>
              <p className="text-gray-500">Raw Deposited</p>
              <p>{project.rawDepositedAmount?.toString() ?? '0'}</p>
            </div>
            <div>
              <p className="text-gray-500">Milestone Status</p>
              <p>{project.milestones[0]?.status}</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-yellow-200">
            <p className="text-xs text-yellow-800 font-semibold mb-1">Warning</p>
            <p className="text-xs text-yellow-700">
              Status 7 (Verified) may be blocked by the &apos;approveWork&apos; function in the deployed contract.
              If you are the arbitrator/owner, you may need to resolve this via dispute or admin action.
            </p>
            <div className="mt-2 text-xs font-mono">
              <span className="text-gray-500">Arbitrator: </span>
              <span>{arbitrator ?? 'Loading...'}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
