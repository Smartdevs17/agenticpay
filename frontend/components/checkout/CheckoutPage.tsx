'use client';

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/frontend/lib/api';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { CheckoutConfirmation } from './CheckoutConfirmation';
import { CheckoutPaymentMethod, CheckoutSessionStatus } from '@/backend/src/services/checkout';

interface CheckoutPageProps {
  id: string;
}

export const CheckoutPage: React.FC<CheckoutPageProps> = ({ id }) => {
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const [step, setStep] = useState<'summary' | 'details' | 'processing' | 'confirmation' | 'expired'>('summary');
  const [selectedMethod, setSelectedMethod] = useState<CheckoutPaymentMethod | undefined>(undefined);
  const [paymentDetails, setPaymentDetails] = useState<any>({});
  const [processing, setProcessing] = useState<boolean>(false);
  
  // Rate lock state
  const [lockedRate, setLockedRate] = useState<{ rate: number; expiresAt: string } | undefined>(undefined);

  // Time remaining count
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch session details on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await api.checkout.getSession(id);
        const s = response.data;
        setSession(s);
        setSelectedMethod(s.selectedMethod);
        if (s.lockedRate) {
          setLockedRate({ rate: s.lockedRate.rate, expiresAt: s.lockedRate.expiresAt });
        }
        
        // Map status to UI step
        if (s.status === 'completed') {
          setStep('confirmation');
        } else if (s.status === 'expired') {
          setStep('expired');
        } else if (s.status === 'payment_pending') {
          setStep('details');
        }

        // Initialize countdown
        const diff = new Date(s.expiresAt).getTime() - Date.now();
        setTimeRemaining(Math.max(0, Math.floor(diff / 1000)));

        setLoading(false);
      } catch (err: any) {
        setError(err.message || 'Failed to load checkout session');
        setLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  // Session expiry countdown interval
  useEffect(() => {
    if (!session || step === 'confirmation' || step === 'expired') return;

    timerRef.current = setInterval(() => {
      const diff = new Date(session.expiresAt).getTime() - Date.now();
      const seconds = Math.max(0, Math.floor(diff / 1000));
      setTimeRemaining(seconds);

      if (seconds <= 0) {
        setStep('expired');
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session, step]);

  // Prevent leaving/back buttons during active payment processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (processing) {
        e.preventDefault();
        e.returnValue = 'Payment is in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [processing]);

  const handleSelectMethod = async (method: CheckoutPaymentMethod) => {
    setSelectedMethod(method);
    try {
      const response = await api.checkout.selectPaymentMethod(id, method);
      setSession(response.data);
      setStep('details');
    } catch (err) {
      console.error('Failed to select payment method:', err);
    }
  };

  const handleRateLocked = (rate: number, expiresAt: string) => {
    setLockedRate({ rate, expiresAt });
  };

  const handleExecutePayment = async () => {
    if (!selectedMethod || processing) return;
    setProcessing(true);
    setStep('processing');

    try {
      const response = await api.checkout.processPayment(id, paymentDetails);
      const updatedSession = response.data;
      setSession(updatedSession);
      
      if (updatedSession.status === 'completed') {
        setStep('confirmation');
      } else {
        // Returned to pending (e.g. simulation failure)
        setStep('details');
        alert('Payment processing failed. Please try again.');
      }
    } catch (err: any) {
      setStep('details');
      alert(err.message || 'Payment execution failed.');
    } finally {
      setProcessing(false);
    }
  };

  const formatCountdown = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="checkout-wrapper">
        <div className="checkout-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <div className="checkout-card" style={{ padding: '40px', width: '100%', maxWidth: '480px', textAlign: 'center' }}>
            <div className="skeleton" style={{ height: '40px', width: '120px', margin: '0 auto 20px' }} />
            <div className="skeleton" style={{ height: '24px', width: '200px', margin: '0 auto 24px' }} />
            <div className="skeleton" style={{ height: '160px', width: '100%', marginBottom: '20px' }} />
            <div className="skeleton" style={{ height: '48px', width: '100%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="checkout-wrapper">
        <div className="checkout-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <div className="checkout-card" style={{ padding: '40px', width: '100%', maxWidth: '480px', textAlign: 'center', borderColor: 'var(--text-error)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h2 className="checkout-title" style={{ color: 'var(--text-error)' }}>Checkout Session Error</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
              {error || 'This checkout session was not found or is invalid.'}
            </p>
            <a href="/" className="checkout-btn">Return to Dashboard</a>
          </div>
        </div>
      </div>
    );
  }

  const brandName = session.brand?.brandName || 'AgenticPay Merchant';
  const logoUrl = session.brand?.logoUrl;
  const accentColor = session.brand?.accentColor || '#0052FF';

  // Total session progress duration (default to 30 min = 1800 sec)
  const percentRemaining = Math.min(100, (timeRemaining / 1800) * 100);

  return (
    <div className="checkout-wrapper" style={{ '--brand-accent': accentColor } as React.CSSProperties}>
      <main className="checkout-container">
        
        {/* Step Flow Card */}
        <section className="checkout-card">
          <header className="checkout-brand-header">
            <div className="checkout-brand-logo">
              {logoUrl ? (
                <img src={logoUrl} alt={brandName} className="checkout-logo-img" />
              ) : (
                <div className="checkout-logo-placeholder">{brandName.charAt(0)}</div>
              )}
              <div>
                <h2 className="checkout-brand-name">{brandName}</h2>
                <p className="checkout-brand-subtitle">Secure Payment Gate</p>
              </div>
            </div>

            {step !== 'confirmation' && step !== 'expired' && (
              <div style={{ fontSize: '13px', fontWeight: 700, color: timeRemaining < 300 ? 'var(--text-error)' : 'var(--text-secondary)' }}>
                ⏱️ {formatCountdown(timeRemaining)}
              </div>
            )}
          </header>

          <div className="checkout-progress-bar">
            <div className={`checkout-step ${step === 'summary' ? 'active' : step !== 'expired' ? 'completed' : ''}`}>
              <div className="checkout-step-num">1</div>
              <span>Summary</span>
            </div>
            <div className={`checkout-step ${step === 'details' ? 'active' : step === 'processing' || step === 'confirmation' ? 'completed' : ''}`}>
              <div className="checkout-step-num">2</div>
              <span>Method</span>
            </div>
            <div className={`checkout-step ${step === 'processing' ? 'active' : step === 'confirmation' ? 'completed' : ''}`}>
              <div className="checkout-step-num">3</div>
              <span>Payment</span>
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            {step !== 'confirmation' && step !== 'expired' && (
              <div className="timeout-bar">
                <div className="timeout-progress" style={{ width: `${percentRemaining}%` }} />
              </div>
            )}
          </div>

          {step === 'summary' && (
            <div className="checkout-content">
              <h1 className="checkout-title">Review Order Summary</h1>
              <p className="checkout-subtitle">
                Please verify the payment details and select your preferred collection method to proceed.
              </p>

              <div style={{ display: 'grid', gap: '16px', margin: '24px 0', border: '1px solid var(--glass-border)', padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Description</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{session.description || 'Secure merchant invoice payment'}</span>
                </div>
                <div style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Invoice currency</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{session.currency}</span>
                </div>
                <div style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Merchant Account ID</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '12px' }}>{session.merchantId}</span>
                </div>
              </div>

              <button
                onClick={() => setStep('details')}
                className="checkout-btn"
              >
                Proceed to Payment Methods
              </button>
            </div>
          )}

          {step === 'details' && (
            <div className="checkout-content">
              <h1 className="checkout-title">Choose Payment Method</h1>
              <p className="checkout-subtitle">
                Collection is fully automated. Choose crypto for near-instant low-fee blockchain clearance.
              </p>

              <PaymentMethodSelector
                sessionId={id}
                currency={session.currency}
                amount={session.amount}
                allowedMethods={session.allowedMethods}
                selectedMethod={selectedMethod}
                onMethodSelected={handleSelectMethod}
                lockedRate={lockedRate}
                onRateLocked={handleRateLocked}
                paymentDetails={paymentDetails}
                onDetailsChange={setPaymentDetails}
              />

              {selectedMethod && (
                <button
                  onClick={handleExecutePayment}
                  className="checkout-btn"
                  style={{ marginTop: '24px' }}
                >
                  Pay Now {new Intl.NumberFormat('en-US', { style: 'currency', currency: session.currency }).format(session.amount)}
                </button>
              )}

              <button
                onClick={() => setStep('summary')}
                className="checkout-btn-secondary"
              >
                ← Back to Order Summary
              </button>
            </div>
          )}

          {step === 'processing' && (
            <div className="checkout-content" style={{ textAlign: 'center', padding: '60px 40px' }}>
              <div className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 24px', animation: 'pulse 1.5s infinite' }} />
              <h2 className="checkout-title">Securing Transaction...</h2>
              <p className="checkout-subtitle" style={{ maxWidth: '340px', margin: '0 auto' }}>
                Executing automated smart contracts on the Stellar / Payment mesh network. Do not close this tab or navigate away.
              </p>
            </div>
          )}

          {step === 'confirmation' && (
            <CheckoutConfirmation
              sessionId={id}
              amount={session.amount}
              currency={session.currency}
              method={session.selectedMethod}
              transactionId={session.transactionId}
              merchantName={brandName}
              redirectUrl={session.brand?.redirectUrl}
            />
          )}

          {step === 'expired' && (
            <div className="checkout-content" style={{ textAlign: 'center', padding: '60px 40px' }}>
              <div style={{ fontSize: '64px', marginBottom: '20px' }}>⏳</div>
              <h2 className="checkout-title" style={{ color: 'var(--text-error)' }}>Checkout Session Expired</h2>
              <p className="checkout-subtitle" style={{ maxWidth: '360px', margin: '0 auto 24px' }}>
                This checkout session has timed out. Merchant rates can only be locked temporarily to prevent price slippage.
              </p>
              <a href="/" className="checkout-btn">Return to Dashboard</a>
            </div>
          )}
        </section>

        {/* Side summary card */}
        {step !== 'confirmation' && step !== 'expired' && (
          <aside className="checkout-card checkout-order-summary">
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
                Your Invoice Order
              </h3>
              
              <div className="summary-price-box">
                <span className="summary-amount">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: session.currency }).format(session.amount)}
                </span>
                <span className="summary-currency">{session.currency} TOTAL</span>
              </div>

              <ul className="summary-details-list">
                <li className="summary-row">
                  <span className="label">Item description</span>
                  <span className="value">{session.description || 'Direct Invoice payment'}</span>
                </li>
                <li className="summary-row">
                  <span className="label">Merchant</span>
                  <span className="value">{brandName}</span>
                </li>
                {selectedMethod && (
                  <li className="summary-row">
                    <span className="label">Selected method</span>
                    <span className="value" style={{ textTransform: 'capitalize' }}>{selectedMethod}</span>
                  </li>
                )}
                {lockedRate && (
                  <li className="summary-row">
                    <span className="label">Exchange rate</span>
                    <span className="value" style={{ color: 'var(--text-success)' }}>1 XLM = {lockedRate.rate} {session.currency}</span>
                  </li>
                )}
              </ul>
            </div>

            <div className="checkout-footer" style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '20px', marginTop: '20px' }}>
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
              </svg>
              <span>Protected under secure SSL 256-bit encrypted checkout standards.</span>
            </div>
          </aside>
        )}

      </main>
    </div>
  );
};
