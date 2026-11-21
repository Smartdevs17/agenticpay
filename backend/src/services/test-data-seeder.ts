// Test Data Seeding Service for Sandbox
// Generates realistic test data for sandbox testing

import { randomUUID } from 'crypto';

export interface TestUser {
  id: string;
  address: string;
  email: string;
  name: string;
  role: 'client' | 'freelancer' | 'admin';
  walletBalance: number;
}

export interface TestProject {
  id: string;
  clientId: string;
  freelancerId: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: number;
}

export interface TestPayment {
  id: string;
  projectId: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  status: 'pending' | 'success' | 'failed';
  timestamp: number;
}

export interface TestInvoice {
  id: string;
  projectId: string;
  clientId: string;
  freelancerId: string;
  amount: number;
  status: 'draft' | 'sent' | 'paid';
  createdAt: number;
}

export class TestDataSeeder {
  private users: Map<string, TestUser> = new Map();
  private projects: Map<string, TestProject> = new Map();
  private payments: Map<string, TestPayment> = new Map();
  private invoices: Map<string, TestInvoice> = new Map();

  /**
   * Seed test users
   */
  seedUsers(count: number): TestUser[] {
    const createdUsers: TestUser[] = [];
    const roles: Array<'client' | 'freelancer' | 'admin'> = ['client', 'freelancer'];

    for (let i = 0; i < count; i++) {
      const role = roles[i % roles.length];
      const user: TestUser = {
        id: randomUUID(),
        address: `G${randomUUID().replace(/-/g, '').substring(0, 55)}`,
        email: `user${i}@sandbox.agenticpay.com`,
        name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)} ${i}`,
        role,
        walletBalance: Math.random() * 100000,
      };

      this.users.set(user.id, user);
      createdUsers.push(user);
    }

    return createdUsers;
  }

  /**
   * Seed test projects
   */
  seedProjects(count: number): TestProject[] {
    const createdProjects: TestProject[] = [];
    const userArray = Array.from(this.users.values());

    if (userArray.length < 2) {
      throw new Error('Need at least 2 users to create projects');
    }

    const projectTitles = [
      'Smart Contract Audit',
      'API Development',
      'Frontend Redesign',
      'Database Optimization',
      'Security Review',
      'Performance Tuning',
      'Documentation Update',
      'Testing Framework Setup',
    ];

    for (let i = 0; i < count; i++) {
      const clients = userArray.filter((u) => u.role === 'client');
      const freelancers = userArray.filter((u) => u.role === 'freelancer');

      const client = clients[i % clients.length] || userArray[0];
      const freelancer = freelancers[i % freelancers.length] || userArray[1];

      const project: TestProject = {
        id: randomUUID(),
        clientId: client.id,
        freelancerId: freelancer.id,
        title: projectTitles[i % projectTitles.length],
        description: `Test project #${i} for sandbox testing`,
        budget: Math.random() * 50000 + 1000,
        currency: 'XLM',
        status: Math.random() > 0.5 ? 'completed' : 'active',
        createdAt: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000, // Past 30 days
      };

      this.projects.set(project.id, project);
      createdProjects.push(project);
    }

    return createdProjects;
  }

  /**
   * Seed test payments
   */
  seedPayments(count: number): TestPayment[] {
    const createdPayments: TestPayment[] = [];
    const projectArray = Array.from(this.projects.values());

    if (projectArray.length === 0) {
      throw new Error('Need at least 1 project to create payments');
    }

    for (let i = 0; i < count; i++) {
      const project = projectArray[i % projectArray.length];
      const client = this.users.get(project.clientId);
      const freelancer = this.users.get(project.freelancerId);

      if (!client || !freelancer) continue;

      const payment: TestPayment = {
        id: randomUUID(),
        projectId: project.id,
        fromAddress: client.address,
        toAddress: freelancer.address,
        amount: project.budget,
        status: Math.random() > 0.2 ? 'success' : (Math.random() > 0.5 ? 'pending' : 'failed'),
        timestamp: Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000, // Past 7 days
      };

      this.payments.set(payment.id, payment);
      createdPayments.push(payment);
    }

    return createdPayments;
  }

  /**
   * Seed test invoices
   */
  seedInvoices(count: number): TestInvoice[] {
    const createdInvoices: TestInvoice[] = [];
    const projectArray = Array.from(this.projects.values());

    if (projectArray.length === 0) {
      throw new Error('Need at least 1 project to create invoices');
    }

    for (let i = 0; i < count; i++) {
      const project = projectArray[i % projectArray.length];

      const invoice: TestInvoice = {
        id: randomUUID(),
        projectId: project.id,
        clientId: project.clientId,
        freelancerId: project.freelancerId,
        amount: project.budget,
        status: Math.random() > 0.3 ? 'paid' : (Math.random() > 0.5 ? 'sent' : 'draft'),
        createdAt: Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000,
      };

      this.invoices.set(invoice.id, invoice);
      createdInvoices.push(invoice);
    }

    return createdInvoices;
  }

  /**
   * Seed all test data
   */
  async seedAll(options: {
    users: number;
    projects: number;
    payments: number;
    invoices: number;
  }): Promise<{
    users: TestUser[];
    projects: TestProject[];
    payments: TestPayment[];
    invoices: TestInvoice[];
  }> {
    const users = this.seedUsers(options.users);
    const projects = this.seedProjects(options.projects);
    const payments = this.seedPayments(options.payments);
    const invoices = this.seedInvoices(options.invoices);

    return { users, projects, payments, invoices };
  }

  /**
   * Get all users
   */
  getUsers(): TestUser[] {
    return Array.from(this.users.values());
  }

  /**
   * Get all projects
   */
  getProjects(): TestProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Get all payments
   */
  getPayments(): TestPayment[] {
    return Array.from(this.payments.values());
  }

  /**
   * Get all invoices
   */
  getInvoices(): TestInvoice[] {
    return Array.from(this.invoices.values());
  }

  /**
   * Clear all test data
   */
  clear(): void {
    this.users.clear();
    this.projects.clear();
    this.payments.clear();
    this.invoices.clear();
  }

  /**
   * Get seed statistics
   */
  getStatistics(): {
    userCount: number;
    projectCount: number;
    paymentCount: number;
    invoiceCount: number;
  } {
    return {
      userCount: this.users.size,
      projectCount: this.projects.size,
      paymentCount: this.payments.size,
      invoiceCount: this.invoices.size,
    };
  }
}

export default TestDataSeeder;
