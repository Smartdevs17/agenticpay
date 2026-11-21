export type AuthLoginType = 'social' | 'wallet';

export interface SeededAuthUser {
  address: string;
  email?: string;
  name?: string;
  profileImage?: string;
  timezone?: string;
  loginType: AuthLoginType;
  isAuthenticated: boolean;
}

export const DEFAULT_TEST_USER: SeededAuthUser = {
  address: '0x000000000000000000000000000000000000beef',
  email: 'e2e-tester@agenticpay.test',
  name: 'E2E Tester',
  profileImage: '',
  timezone: 'UTC',
  loginType: 'social',
  isAuthenticated: true,
};

export const AUTH_STORAGE_KEY = 'agenticpay-auth';

export function buildAuthStorageValue(user: SeededAuthUser = DEFAULT_TEST_USER) {
  return JSON.stringify({
    state: {
      address: user.address,
      email: user.email,
      name: user.name,
      profileImage: user.profileImage,
      timezone: user.timezone,
      loginType: user.loginType,
      isAuthenticated: user.isAuthenticated,
    },
    version: 0,
  });
}

/** Merchant onboarding fixture for API mocks */
export const MOCK_ONBOARDING = {
  id: 'onb_e2e_001',
  merchantId: 'current-merchant-id',
  businessName: 'E2E Test Merchant',
  businessType: 'LLC',
  status: 'in_progress' as const,
  progress: 33,
  tasks: [
    {
      id: 'business_license',
      title: 'Business License',
      description: 'Upload your business license',
      type: 'document_upload' as const,
      required: true,
      order: 0,
      status: 'in_progress' as const,
    },
    {
      id: 'tax_id',
      title: 'Tax ID',
      description: 'Upload tax identification',
      type: 'document_upload' as const,
      required: true,
      order: 1,
      status: 'pending' as const,
    },
    {
      id: 'bank_verification',
      title: 'Bank Verification',
      description: 'Upload bank statement',
      type: 'document_upload' as const,
      required: true,
      order: 2,
      status: 'pending' as const,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Sandbox payment response for API-level payment flow tests */
export function buildMockPayment(transactionId = 'txn_e2e_001') {
  return {
    success: true,
    payment: {
      transactionId,
      projectId: 'proj_e2e',
      status: 'confirmed',
      amount: 100,
      currency: 'XLM',
      clientAddress: 'GCLIENT',
      freelancerAddress: 'GFREEL',
      createdAt: new Date().toISOString(),
    },
  };
}
