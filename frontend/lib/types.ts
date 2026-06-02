export interface User {
  name: string;
  address: string;
  email?: string;
  profileImage?: string;
  timezone?: string;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  amount: string;
  status: 'pending' | 'in_progress' | 'completed';
  completionPercentage: number;
  dueDate?: string;
}

export interface Project {
  id: string;
  title: string;
  client: User;
  freelancer: User;
  status: 'active' | 'completed' | 'cancelled' | 'verified';
  totalAmount: string; // Formatted
  rawAmount?: bigint; // Raw BigInt value
  currency: string;
  depositedAmount?: string; // Formatted
  rawDepositedAmount?: bigint; // Raw BigInt value
  rawStatus?: number; // Enum index
  milestones: Milestone[];
  createdAt: string;
  githubRepo?: string;
  invoiceUri?: string; // Added invoiceUri
}

export interface Invoice {
  id: string;
  projectId: string;
  projectTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  amount: string;
  currency: string;
  status: 'pending' | 'paid' | 'overdue';
  generatedAt: string;
  paidAt?: string;
  transactionHash?: string;
  client: User;
  freelancer: User;
}

export interface Payment {
  id: string;
  invoiceId: string;
  projectTitle: string;
  amount: string;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  type: 'milestone_payment' | 'full_payment';
  from: string;
  to: string;
  transactionHash?: string;
  timestamp: string;
  escrowId?: string;
}

