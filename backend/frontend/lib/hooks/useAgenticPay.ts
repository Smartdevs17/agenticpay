import { useState, useEffect, useCallback } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useReadContracts, useAccount } from 'wagmi';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contracts';
import { parseEther, formatEther } from 'viem';
import { Project, Milestone } from '../types';

interface FailedTransaction {
  functionName: string;
  args: any[];
  value?: bigint;
}

export const useAgenticPay = () => {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { address } = useAccount();

  const [failedTx, setFailedTx] = useState<FailedTransaction | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const { isLoading: isConfirming, isSuccess: isConfirmed, isError: isReceiptError } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (error) setTxError(error.message || 'Transaction failed');
  }, [error]);

  useEffect(() => {
    if (isReceiptError) setTxError('Transaction was rejected on-chain. You can retry.');
  }, [isReceiptError]);

  useEffect(() => {
    if (isConfirmed) clearFailure();
  }, [isConfirmed]);

  const clearFailure = useCallback(() => {
    setFailedTx(null);
    setTxError(null);
    setIsRetrying(false);
  }, []);

  const retryTransaction = useCallback(async () => {
    if (!failedTx) return;
    setIsRetrying(true);
    setTxError(null);
    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: failedTx.functionName as any,
        args: failedTx.args,
        ...(failedTx.value !== undefined && { value: failedTx.value }),
      });
    } catch (err: any) {
      setTxError(err.message || 'Retry failed');
    } finally {
      setIsRetrying(false);
    }
  }, [failedTx, writeContract]);

  const safeWriteContract = useCallback((params: {
    functionName: string;
    args: any[];
    value?: bigint;
  }) => {
    setFailedTx({ functionName: params.functionName, args: params.args, value: params.value });
    setTxError(null);
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: params.functionName as any,
      args: params.args,
      ...(params.value !== undefined && { value: params.value }),
    });
  }, [writeContract]);

  const { data: arbitratorData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'disputeArbitrator',
  });

  const createProject = async (
    freelancer: string,
    amount: string,
    paymentType: number,
    tokenAddress: string,
    workDescription: string,
    deadline: number
  ) => {
    safeWriteContract({
      functionName: 'createProject',
      args: [freelancer, parseEther(amount), paymentType, tokenAddress, workDescription, BigInt(deadline)],
    });
  };

  const fundProject = async (projectId: string, amount: string, paymentType: number) => {
    safeWriteContract({
      functionName: 'fundProject',
      args: [BigInt(projectId)],
      value: paymentType === 0 ? parseEther(amount) : 0n,
    });
  };

  const submitWork = async (projectId: string, githubRepo: string) => {
    safeWriteContract({
      functionName: 'submitWork',
      args: [BigInt(projectId), githubRepo],
    });
  };

  const approveWork = async (projectId: string) => {
    safeWriteContract({
      functionName: 'approveWork',
      args: [BigInt(projectId)],
    });
  };

  const releasePayment = async (projectId: string) => {
    safeWriteContract({
      functionName: 'approveWork',
      args: [BigInt(projectId)],
    });
  };

  const useUserProjects = () => {
    const { data: clientProjects, isLoading: loadingClient } = useReadContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getClientProjects',
      args: [address],
      query: { enabled: !!address }
    });

    const { data: freelancerProjects, isLoading: loadingFreelancer } = useReadContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getFreelancerProjects',
      args: [address],
      query: { enabled: !!address }
    });

    const allIds = [
      ...(clientProjects ? (clientProjects as bigint[]) : []),
      ...(freelancerProjects ? (freelancerProjects as bigint[]) : [])
    ];

    const uniqueIds = Array.from(new Set(allIds.map(id => id.toString()))).map(id => BigInt(id));

    const { data: projectsData, isLoading: loadingDetails } = useReadContracts({
      contracts: uniqueIds.map(id => ({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'getProject',
        args: [id]
      }))
    });

    const formattedProjects: Project[] = projectsData
      ? projectsData.map((result: any) => {
          if (result.status === 'success' && result.result) {
            return formatProjectData(result.result);
          }
          return null;
        }).filter((p: any) => p !== null) as Project[]
      : [];

    return { projects: formattedProjects, loading: loadingClient || loadingFreelancer || loadingDetails };
  };

  const useProjectDetail = (projectId: string) => {
    const { data, isLoading, refetch } = useReadContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getProject',
      args: [projectId ? BigInt(projectId) : 0n],
      query: { enabled: !!projectId }
    });

    return { project: data ? formatProjectData(data) : null, loading: isLoading, refetch };
  };

  return {
    createProject,
    fundProject,
    submitWork,
    approveWork,
    releasePayment,
    useUserProjects,
    useProjectDetail,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error,
    arbitrator: arbitratorData as string | undefined,
    txError,
    failedTx,
    isRetrying,
    retryTransaction,
    clearFailure,
  };
};

const formatProjectData = (data: any): Project => {
  let title = "Project #" + data.projectId.toString();
  let description = data.workDescription;
  try {
    const parsed = JSON.parse(data.workDescription);
    if (parsed.title) title = parsed.title;
    if (parsed.description) description = parsed.description;
  } catch (e) {}

  const mapStatus = (statusIdx: number) => {
    if (statusIdx === 7) return 'verified';
    if (statusIdx === 6) return 'cancelled';
    if (statusIdx === 4) return 'completed';
    return 'active';
  };

  const milestones: Milestone[] = [];
  const isCompleted = Number(data.status) === 4;
  const isFunded = Number(data.status) >= 1;

  milestones.push({
    id: '1',
    title: 'Project Deliverable',
    description: description,
    amount: formatEther(data.amount),
    status: isCompleted ? 'completed' : isFunded ? 'in_progress' : 'pending',
    completionPercentage: isCompleted ? 100 : isFunded ? 50 : 0,
    dueDate: new Date(Number(data.deadline) * 1000).toISOString()
  });

  return {
    id: data.projectId.toString(),
    title: title,
    client: { name: 'Client', address: data.client },
    freelancer: { name: 'Freelancer', address: data.freelancer },
    status: mapStatus(Number(data.status)) as any,
    totalAmount: formatEther(data.amount),
    rawAmount: data.amount,
    currency: Number(data.paymentType) === 0 ? 'ETH' : 'ERC20',
    depositedAmount: formatEther(data.depositedAmount),
    rawDepositedAmount: data.depositedAmount,
    rawStatus: Number(data.status),
    createdAt: new Date(Number(data.createdAt) * 1000).toISOString(),
    githubRepo: data.githubRepo,
    invoiceUri: data.invoiceUri,
    milestones: milestones,
  };
};