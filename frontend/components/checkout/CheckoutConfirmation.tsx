'use client';

import React from 'react';
import { api } from '@/frontend/lib/api';

interface CheckoutConfirmationProps {
  sessionId: string;
  amount: number;
  currency: string;
  method?: string;
  transactionId?: string;
  merchantName: string;
  redirectUrl?: string;
}

export const CheckoutConfirmation: React.FC<CheckoutConfirmationProps> = ({
  sessionId,
  amount,
  currency,
  method,
  transactionId,
  merchantName,
  redirectUrl,
}) => {
  const handleDownloadReceipt = async () => {
    try {
      const receiptUrl = api.checkout.getReceiptUrl(sessionId);
      
      // Fetch HTML blob from backend receipt route
      const response = await fetch(receiptUrl);
      if (!response.ok) throw new Error('Receipt download failed');
      const blob = await response.blob();
      
      // Trigger local download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${sessionId}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download receipt:', err);
    }
  };

  const handleReturnToMerchant = () => {
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  };

  return (
    <div className="checkout-content" style={{ textAlign: 'center' }}>
      <div className="checkmark-container">
        <div className="checkmark-circle">
          <svg className="checkmark-icon" viewBox="0 0 52 52">
            <polyline points="14,27 22,35 38,19" />
          </svg>
        </div>
      </div>

      <h1 className="checkout-title" style={{ color: 'var(--text-success)' }}>Payment Confirmed!</h1>
      <p className="checkout-subtitle">
        Your payment to <strong>{merchantName}</strong> has been successfully processed. An official receipt has been generated.
      </p>

      <div style={{ background: 'rgba(15, 23, 42, 0.4)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '20px', margin: '24px 0', textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyBetween: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Amount Paid</span>
          <strong style={{ marginLeft: 'auto', color: 'white' }}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)}
          </strong>
        </div>

        <div style={{ display: 'flex', justifyBetween: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Payment Method</span>
          <span style={{ marginLeft: 'auto', textTransform: 'capitalize', color: 'white' }}>{method || 'N/A'}</span>
        </div>

        <div style={{ display: 'flex', justifyBetween: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Transaction ID</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '11px', color: 'white' }}>
            {transactionId || 'N/A'}
          </span>
        </div>

        <div style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Timestamp</span>
          <span style={{ marginLeft: 'auto', color: 'white' }}>{new Date().toLocaleString()}</span>
        </div>
      </div>

      <button
        onClick={handleDownloadReceipt}
        className="checkout-btn"
        style={{ background: 'rgba(74, 222, 128, 0.1)', color: 'var(--text-success)', border: '1px solid rgba(74, 222, 128, 0.3)', boxShadow: 'none' }}
      >
        📥 Download Receipt
      </button>

      {redirectUrl ? (
        <button
          onClick={handleReturnToMerchant}
          className="checkout-btn"
          style={{ marginTop: '12px' }}
        >
          Return to Merchant
        </button>
      ) : (
        <a
          href="/"
          className="checkout-btn-secondary"
          style={{ width: '100%', marginTop: '12px', boxSizing: 'border-box' }}
        >
          Return to Dashboard
        </a>
      )}
    </div>
  );
};
