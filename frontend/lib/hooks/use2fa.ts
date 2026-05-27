'use client';

/**
 * 2FA API Hook
 * Handles all 2FA API calls
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  TwoFactorSetupData,
  TwoFactorStatus,
  TwoFactorLog,
  VerificationResponse,
  RecoveryInitiation,
} from '@/types/2fa';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

class TwoFactorAPIError extends Error {
  constructor(
    public statusCode: number,
    public details?: Record<string, any>
  ) {
    super(`2FA API Error: ${statusCode}`);
    this.name = 'TwoFactorAPIError';
  }
}

async function handleResponse(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new TwoFactorAPIError(response.status, data);
  }
  return response.json();
}

export function useSetup2FA() {
  return useMutation({
    mutationFn: async (userId: string): Promise<TwoFactorSetupData> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      return handleResponse(response);
    },
  });
}

export function useConfirm2FA() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      token: string;
      backupCodesConfirmed: boolean;
    }): Promise<{ success: boolean; message: string }> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useVerify2FA() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      token: string;
      rememberDevice?: boolean;
    }): Promise<VerificationResponse> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useDisable2FA() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      token: string;
      reason?: string;
    }): Promise<{ success: boolean; message: string }> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/${data.userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useGet2FAStatus(userId: string) {
  return useQuery({
    queryKey: ['2fa-status', userId],
    queryFn: async (): Promise<TwoFactorStatus> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/status/${userId}`);
      return handleResponse(response);
    },
    enabled: !!userId,
  });
}

export function useGetBackupCodes() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      token: string;
    }): Promise<{ backupCodes: string[] }> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/backup-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useRegenerateBackupCodes() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      token: string;
    }): Promise<{ backupCodes: string[]; message: string }> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/regenerate-backup-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useGet2FALogs(userId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['2fa-logs', userId, limit, offset],
    queryFn: async (): Promise<{ logs: TwoFactorLog[]; total: number }> => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/logs/${userId}?${params}`);
      return handleResponse(response);
    },
    enabled: !!userId,
  });
}

export function useRequestRecovery() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      method: 'email' | 'support_ticket';
    }): Promise<RecoveryInitiation> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useCompleteRecovery() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      recoveryToken: string;
      newSecret?: string;
    }): Promise<{ success: boolean; message: string; requiresVerification: boolean }> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/complete-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}

export function useCheckDevice() {
  return useMutation({
    mutationFn: async (data: {
      userId: string;
      deviceHash: string;
    }): Promise<{ isRemembered: boolean }> => {
      const response = await fetch(`${BASE_URL}/api/v1/auth/2fa/check-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return handleResponse(response);
    },
  });
}
