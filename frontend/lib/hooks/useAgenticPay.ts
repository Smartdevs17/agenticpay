import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useReadContracts, useAccount } from 'wagmi';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contracts';
import { parseEther, formatEther } from 'viem';
import { Project, Milestone } from '../types';

export const useAgenticPay = () => {
    const { writeContract, data: hash, isPending, error } = useWriteContract();
    const { address, isConnecting, isReconnecting } = useAccount();

    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    const { data: arbitratorData } = useReadContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'disputeArbitrator',
    });

    const createProject = async (
        freelancer: string,
        amount: string,
        paymentType: number, // 0 for ETH, 1 for Token
        tokenAddress: string,
        workDescription: string,
        deadline: number // timestamp
    ) => {
        writeContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'createProject',
            args: [freelancer, parseEther(amount), paymentType, tokenAddress, workDescription, BigInt(deadline)],
        });
    };

    const fundProject = async (projectId: string, amount: string, paymentType: number) => {
        // If paymentType is 0 (Native ETH), send value.
        writeContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'fundProject',
            args: [BigInt(projectId)],
            value: paymentType === 0 ? parseEther(amount) : 0n,
        });
    };

    const submitWork = async (projectId: string, githubRepo: string) => {
        writeContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'submitWork',
            args: [BigInt(projectId), githubRepo],
        });
    };

    const approveWork = async (projectId: string) => {
        writeContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'approveWork',
            args: [BigInt(projectId)],
        });
    };

    // -- Data Fetching Hooks --

    const useUserProjects = () => {
        const { data: clientProjects, isLoading: loadingClient, isFetching: fetchingClient } = useReadContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getClientProjects',
            args: [address],
            query: { enabled: !!address }
        });

        const { data: freelancerProjects, isLoading: loadingFreelancer, isFetching: fetchingFreelancer } = useReadContract({
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
        // Deduplicate
        const uniqueIds = Array.from(new Set(allIds.map(id => id.toString()))).map(id => BigInt(id));

        const { data: projectsData, isLoading: loadingDetails, isFetching: fetchingDetails } = useReadContracts({
            contracts: uniqueIds.map(id => ({
                address: CONTRACT_ADDRESS,
                abi: CONTRACT_ABI,
                functionName: 'getProject',
                args: [id]
            })),
            query: { enabled: !!address && uniqueIds.length > 0 }
        });

        const formattedProjects: Project[] = projectsData
            ? projectsData
                .map((result) => {
                    if (result.status === 'success' && result.result) {
                        return formatProjectData(result.result as RawProjectData);
                    }
                    return null;
                })
                .filter((project): project is Project => project !== null)
            : [];

        const isWalletHydrating = isConnecting || isReconnecting;
        const isProjectListsFetching = loadingClient || loadingFreelancer || fetchingClient || fetchingFreelancer;
        const isDetailFetching = uniqueIds.length > 0 && (loadingDetails || fetchingDetails);
        const loading = !!address && (isWalletHydrating || isProjectListsFetching || isDetailFetching);

        return { projects: formattedProjects, loading };
    };

    const useProjectDetail = (projectId: string) => {
        const { data, isLoading, refetch } = useReadContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getProject',
            args: [projectId ? BigInt(projectId) : 0n], // safe check
            query: { enabled: !!projectId }
        });

        return {
            project: data ? formatProjectData(data as RawProjectData) : null,
            loading: isLoading,
            refetch,
        };
    };


    return {
        createProject,
        fundProject,
        submitWork,
        approveWork,
        useUserProjects,
        useProjectDetail,
        hash,
        isPending,
        isConfirming,
        isConfirmed,
        error,
        arbitrator: arbitratorData as string | undefined
    };
};

interface RawProjectData {
    projectId: bigint;
    client: string;
    freelancer: string;
    amount: bigint;
    depositedAmount: bigint;
    paymentType: bigint;
    status: bigint;
    githubRepo: string;
    workDescription: string;
    deadline: bigint;
    createdAt: bigint;
    invoiceUri: string;
}

const formatProjectData = (data: RawProjectData): Project => {
    // data is the struct from contract
    // struct Project { projectId, client, freelancer, amount, depositedAmount, paymentType, tokenAddress, status, githubRepo, workDescription, ... }

    // Parse description for potential JSON metadata
    let title = "Project #" + data.projectId.toString();
    let description = data.workDescription;
    try {
        const parsed = JSON.parse(data.workDescription);
        if (parsed.title) title = parsed.title;
        if (parsed.description) description = parsed.description;
    } catch {
        // ignore, use raw
    }

    const mapStatus = (statusIdx: number): Project['status'] => {
        // Enum: 0: Created, 1: Funded, 2: Started, 3: Submitted, 4: Completed, 5: Disputed, 6: Cancelled
        // 'active' | 'completed' | 'cancelled'
        if (statusIdx === 7) return 'verified'; // Assumed Verified based on debug info
        if (statusIdx === 6) return 'cancelled';
        if (statusIdx === 4) return 'completed';
        return 'active';
    }

    // Convert milestones
    const milestones: Milestone[] = [];
    // Currently contract doesn't expose milestones array in getProject.
    // We create a dummy milestone representing the whole project status
    // Or if we want to show 100% progress if completed.

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
        status: mapStatus(Number(data.status)),
        totalAmount: formatEther(data.amount),
        rawAmount: data.amount, // Pass raw amount
        currency: Number(data.paymentType) === 0 ? 'ETH' : 'ERC20', // Simplified
        depositedAmount: formatEther(data.depositedAmount),
        rawDepositedAmount: data.depositedAmount,
        rawStatus: Number(data.status),
        createdAt: new Date(Number(data.createdAt) * 1000).toISOString(),
        githubRepo: data.githubRepo,
        invoiceUri: data.invoiceUri, // Pass invoiceUri
        milestones: milestones,
    };
}
