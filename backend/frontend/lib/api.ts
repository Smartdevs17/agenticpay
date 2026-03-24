export const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://agentpay-backend-mu.vercel.app';

export interface VerificationRequest {
    repositoryUrl: string;
    milestoneDescription: string;
    projectId: string;
}

export interface InvoiceRequest {
    projectId: string;
    workDescription: string;
    hoursWorked: number;
    hourlyRate: number;
}

export const api = {
    /**
     * AI Work Verification
     */
    verifyWork: async (data: VerificationRequest) => {
        const response = await fetch(`${BASE_URL}/api/v1/verification/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Verification failed');
        }
        return response.json();
    },

    /**
     * AI Invoice Generation
     */
    generateInvoice: async (data: InvoiceRequest) => {
        const response = await fetch(`${BASE_URL}/api/v1/invoice/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Invoice generation failed');
        }
        return response.json();
    },

    /**
     * Get Verification Result
     */
    getVerification: async (id: string) => {
        const response = await fetch(`${BASE_URL}/api/v1/verification/${id}`, {
            method: 'GET',
        });

        if (!response.ok) {
            throw new Error('Failed to fetch verification result');
        }
        return response.json();
    }
};
