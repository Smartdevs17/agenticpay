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
    description: string;
    amount: string;
    currency: string;
    status: 'completed' | 'pending' | 'failed';
    timestamp: string;
    transactionHash?: string;
    type: 'milestone_payment' | 'full_payment' | 'refund';
    category: string;
}

function categorizePayment(description: string, amount: number, type?: string): string {
    const normalizedDescription = description.toLowerCase();

    if (type === 'refund' || amount < 0 || normalizedDescription.includes('refund')) return 'refund';
    if (normalizedDescription.includes('subscription') || normalizedDescription.includes('monthly') || normalizedDescription.includes('yearly') || normalizedDescription.includes('saas')) return 'subscription';
    if (normalizedDescription.includes('invoice') || normalizedDescription.includes('inv-') || normalizedDescription.includes('billing')) return 'invoice';
    if (normalizedDescription.includes('donation') || normalizedDescription.includes('gift') || normalizedDescription.includes('support')) return 'donation';
    if (normalizedDescription.includes('payroll') || normalizedDescription.includes('salary') || normalizedDescription.includes('wage')) return 'payroll';
    if (normalizedDescription.includes('software') || normalizedDescription.includes('api') || normalizedDescription.includes('license')) return 'software';
    if (normalizedDescription.includes('infrastructure') || normalizedDescription.includes('cloud') || normalizedDescription.includes('aws') || normalizedDescription.includes('hosting')) return 'infrastructure';

    return 'uncategorized';
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
    let totalEarningsNum = 0;
    let pendingPaymentsNum = 0;

    const invoices: DashboardInvoice[] = [];
    const payments: DashboardPayment[] = [];
    const recentActivity: { type: string; title: string; description: string; time: string; amount: string }[] = [];

    projects.forEach((project) => {
        const isFreelancer = address && project.freelancer.address.toLowerCase() === address.toLowerCase();
        const amount = parseFloat(project.totalAmount);

        // Stats Logic
        if (project.status === 'completed' || project.status === 'verified') {
            completedProjects++;
            if (isFreelancer) {
                totalEarningsNum += amount;
            }
        } else if (project.status === 'cancelled') {
            // do nothing
        } else {
            // Active
            activeProjects++;
            if (isFreelancer) {
                pendingPaymentsNum += amount;
            }
        }

        // Invoices Logic
        if (project.invoiceUri || project.status === 'completed' || project.status === 'verified') {
            invoices.push({
                id: `INV-${project.id}`,
                projectId: project.id,
                projectTitle: project.title,
                milestoneTitle: 'Project Deliverable',
                amount: project.totalAmount,
                currency: project.currency,
                status: (project.status === 'completed' || project.status === 'verified') ? 'paid' : 'pending',
                generatedAt: project.createdAt,
                date: project.createdAt
            });
        }

        // Payments Logic
        if (project.status === 'completed' || project.status === 'verified') {
            const description = project.description || project.title || '';
            const category = categorizePayment(description, amount);
            payments.push({
                id: `PAY-${project.id}`,
                projectTitle: project.title,
                description: description,
                amount: project.totalAmount,
                currency: project.currency,
                status: 'completed',
                timestamp: project.createdAt,
                type: 'full_payment',
                category: category
            });

            // Add to activity
            recentActivity.push({
                type: 'payment',
                title: 'Payment processed',
                description: `${project.totalAmount} ${project.currency} for ${project.title} (${category})`,
                time: 'Recently',
                amount: project.totalAmount
            });
        }
    });

    return {
        stats: {
            totalEarnings: totalEarningsNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            pendingPayments: pendingPaymentsNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            activeProjects,
            completedProjects
        },
        invoices,
        payments,
        recentActivity: recentActivity.sort((a, b) => new Date(b.time === 'Recently' ? Date.now() : b.time).getTime() - new Date(a.time === 'Recently' ? Date.now() : a.time).getTime()).slice(0, 5),
        loading: false
    };
}
