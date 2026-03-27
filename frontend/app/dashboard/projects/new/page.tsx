'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { useAccount } from 'wagmi';

const walletAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address');

const tokenAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address');

const isFutureDate = (value: string) => {
  const selectedDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(selectedDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return selectedDate > today;
};

const getMinDeadlineDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return tomorrow.toISOString().split('T')[0];
};

const projectSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  clientAddress: walletAddressSchema.optional(), // Optional if user is client
  freelancerAddress: walletAddressSchema,
  totalAmount: z
    .string()
    .trim()
    .min(1, 'Amount is required')
    .refine((value) => {
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0;
    }, 'Amount must be a positive number'),
  currency: z.string().min(1, 'Currency is required'),
  tokenAddress: z.union([tokenAddressSchema, z.literal('')]).optional(),
  deadline: z
    .string()
    .min(1, 'Deadline is required')
    .refine(isFutureDate, 'Deadline must be a future date'),
  githubRepo: z.string().url('Invalid URL').optional().or(z.literal('')),
  description: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.currency === 'ERC20' && !data.tokenAddress?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tokenAddress'],
      message: 'Token address is required for ERC20 payments',
    });
  }
});

type ProjectFormData = z.infer<typeof projectSchema>;

export default function CreateProjectPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { createProject, isPending, isConfirming, isConfirmed, error } = useAgenticPay();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      currency: 'ETH',
      description: '',
    },
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const currency = watch('currency');

  useEffect(() => {
    if (isConfirmed) {
      toast.success('Project created successfully on-chain!');
      router.push('/dashboard/projects');
    }
  }, [isConfirmed, router]);

  useEffect(() => {
    if (error) {
      console.error(error);
      toast.error('Transaction failed: ' + (error as { shortMessage?: string }).shortMessage || error.message);
    }
  }, [error]);

  const onSubmit = async (data: ProjectFormData) => {
    if (!address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error('You are offline. Reconnect before creating an on-chain project.');
      return;
    }

    try {
      const paymentType = data.currency === 'ETH' ? 0 : 1;
      const tokenAddr = data.currency === 'ETH' ? '0x0000000000000000000000000000000000000000' : data.tokenAddress!;
      const deadlineTimestamp = Math.floor(new Date(data.deadline).getTime() / 1000);

      // We combine title and description for the contract's workDescription to verify against later if needed, 
      // or just use description. The contract takes `_workDescription`.
      // Let's use JSON format for better structure if we want to include milestones later, 
      // but for now just a string.
      const workDesc = JSON.stringify({
        title: data.title,
        description: data.description,
        repo: data.githubRepo
      });

      await createProject(
        data.freelancerAddress,
        data.totalAmount,
        paymentType,
        tokenAddr,
        workDesc,
        deadlineTimestamp
      );

      toast.info('Transaction submitted. Waiting for confirmation...');

    } catch (e) {
      console.error('Failed to prepare transaction:', e);
      toast.error('Failed to prepare transaction.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard/projects">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Projects
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Create New Project</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="title">Project Title</Label>
                <Input
                  id="title"
                  {...register('title')}
                  placeholder="E.g., Website Redesign"
                />
                {errors.title && (
                  <p className="text-sm text-red-600 mt-1">{errors.title.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  {...register('description')}
                  placeholder="Brief description of work"
                />
              </div>

              <div>
                <Label htmlFor="freelancerAddress">Freelancer Address (To Pay)</Label>
                <Input
                  id="freelancerAddress"
                  {...register('freelancerAddress')}
                  placeholder="0x..."
                />
                {errors.freelancerAddress && (
                  <p className="text-sm text-red-600 mt-1">{errors.freelancerAddress.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="totalAmount">Total Amount</Label>
                  <Input
                    id="totalAmount"
                    {...register('totalAmount')}
                    placeholder="1.0"
                    type="number"
                    step="0.000001"
                  />
                  {errors.totalAmount && (
                    <p className="text-sm text-red-600 mt-1">{errors.totalAmount.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="currency">Currency</Label>
                  <Select
                    onValueChange={(val) =>
                      setValue('currency', val, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    defaultValue="ETH"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Currency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="ERC20">ERC20 Token</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.currency && (
                    <p className="text-sm text-red-600 mt-1">{errors.currency.message}</p>
                  )}
                </div>
              </div>

              {currency === 'ERC20' && (
                <div>
                  <Label htmlFor="tokenAddress">Token Address</Label>
                  <Input
                    id="tokenAddress"
                    {...register('tokenAddress')}
                    placeholder="0x..."
                  />
                  {errors.tokenAddress && (
                    <p className="text-sm text-red-600 mt-1">{errors.tokenAddress.message}</p>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="deadline">Project Deadline</Label>
                <Input
                  id="deadline"
                  type="date"
                  min={getMinDeadlineDate()}
                  {...register('deadline')}
                />
                {errors.deadline && (
                  <p className="text-sm text-red-600 mt-1">{errors.deadline.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="githubRepo">GitHub Repository (Optional)</Label>
                <Input
                  id="githubRepo"
                  {...register('githubRepo')}
                  placeholder="https://github.com/..."
                />
                {errors.githubRepo && (
                  <p className="text-sm text-red-600 mt-1">{errors.githubRepo.message}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={isPending || isConfirming} className="flex-1">
                {(isPending || isConfirming) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isPending ? 'Confirm in Wallet...' : isConfirming ? 'Processing...' : 'Create Project'}
              </Button>
              <Link href="/dashboard/projects">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

