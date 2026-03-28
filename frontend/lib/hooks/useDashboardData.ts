import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { useAccount } from 'wagmi';

// Define return types for the dashboard data
export interface DashboardStats {
    totalEarnings: string;
    pendingPayments: string;
    activeProjects: number;
    completedProjects: number;
}

export interface DashboardInvoice {
    id: string;
    projectId: string; // Add projectId for linking
    projectTitle: string;
    milestoneTitle: string;
    amount: string;
    currency: string;
    status: 'paid' | 'pending' | 'overdue';
    generatedAt: string;
    date: string; // for compatibility with verify
}

export interface DashboardPayment {
    id: string;
    projectTitle: string;
    amount: string;
    currency: string;
    status: 'completed' | 'pending' | 'failed';
    timestamp: string;
    transactionHash?: string;
    type: 'milestone_payment' | 'full_payment';
}

export function useDashboardData() {
    const { address, isConnected, isConnecting, isReconnecting } = useAccount();
    const { useUserProjects } = useAgenticPay();
    const { projects, loading } = useUserProjects();
    const isLoading = isConnecting || isReconnecting || (isConnected && loading);

    if (isLoading || !projects) {
        return {
            stats: { totalEarnings: '0', pendingPayments: '0', activeProjects: 0, completedProjects: 0 },
            invoices: [],
            payments: [],
            recentActivity: [],
            loading: true,
        };
    }

    // Calculate Stats
    let activeProjects = 0;
    let completedProjects = 0;

    const invoices: DashboardInvoice[] = [];
    const payments: DashboardPayment[] = [];
    const recentActivity: { type: string; title: string; description: string; time: string; amount: string }[] = []; // Unified activity feed

    projects.forEach((project) => {
        const isFreelancer = address && project.freelancer.address.toLowerCase() === address.toLowerCase();

        // Stats Logic
        if (project.status === 'completed') {
            completedProjects++;
        } else if (project.status === 'cancelled') {
            // do nothing
        } else {
            // Active
            activeProjects++;
            if (isFreelancer) {
                // pending
            }
        }

        // Invoices Logic
        // If project has invoiceUri, treat as invoice generated.
        if (project.invoiceUri || project.status === 'completed') {
            invoices.push({
                id: `INV-${project.id}`,
                projectId: project.id,
                projectTitle: project.title,
                milestoneTitle: 'Full Project', // 1 milestone logic
                amount: project.totalAmount, // formatted string
                currency: project.currency,
                status: project.status === 'completed' ? 'paid' : 'pending',
                generatedAt: project.createdAt, // approximation
                date: project.createdAt
            });
        }

        // Payments Logic
        if (project.status === 'completed') {
            payments.push({
                id: `PAY-${project.id}`,
                projectTitle: project.title,
                amount: project.totalAmount,
                currency: project.currency,
                status: 'completed',
                timestamp: new Date().toISOString(), // we don't have completedAt in hook yet?
                type: 'full_payment'
            });

            // Add to activity
            recentActivity.push({
                type: 'payment',
                title: 'Payment received',
                description: `${project.totalAmount} ${project.currency} from ${isFreelancer ? 'Client' : 'Freelancer'}`, // text slightly off strictly speaking
                time: 'Recently', // needs real timestamp
                amount: project.totalAmount
            });
        }
    });

    return {
        stats: {
            totalEarnings: '0', // Placeholder until we fix rawAmount
            pendingPayments: '0',
            activeProjects,
            completedProjects
        },
        invoices,
        payments,
        recentActivity,
        loading: false
    };
}
