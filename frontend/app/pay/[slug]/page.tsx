'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

export default function PayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;

  const [linkData, setLinkData] = useState<any>(null);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [shareLinks, setShareLinks] = useState<any>(null);

  const [password, setPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [paying, setPaying] = useState<boolean>(false);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const fetchPaymentLink = async (pwd?: string) => {
    setLoading(true);
    setError(null);
    setPasswordError('');
    try {
      const variantParam = searchParams.get('variant') || undefined;
      const sourceParam = searchParams.get('source') || 'direct';

      const response = await api.paymentLinks.getLinkBySlug(slug, {
        variant: variantParam,
        password: pwd || password || undefined,
      });

      if (response && response.data) {
        setLinkData(response.data);
        setSelectedVariant(response.selectedVariant);
        setQrCodeUrl(response.qrCodeUrl || '');
        setShareLinks(response.share || null);
      }
    } catch (err: any) {
      if (err.status === 401 || err.code === 'PAYMENT_LINK_PASSWORD_REQUIRED') {
        setError('PASSWORD_REQUIRED');
        if (pwd) {
          setPasswordError('Invalid password. Please try again.');
        }
      } else if (err.status === 410 || err.code === 'PAYMENT_LINK_EXPIRED') {
        setError('EXPIRED');
      } else {
        setError(err.message || 'Payment link not found or inactive');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (slug) {
      fetchPaymentLink();
    }
  }, [slug, searchParams]);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    fetchPaymentLink(password);
  };

  const handlePay = async () => {
    setPaying(true);
    setPaymentError(null);
    try {
      const sourceParam = searchParams.get('source') || 'direct';
      const variantParam = selectedVariant?.id || undefined;

      await api.paymentLinks.completePayment(slug, {
        source: sourceParam,
        variant: variantParam,
        password: password || undefined,
        amountPaid: selectedVariant ? selectedVariant.amount : linkData.amount,
      });

      setPaymentSuccess(true);
    } catch (err: any) {
      setPaymentError(err.message || 'Failed to complete payment. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-zinc-400 text-sm font-medium animate-pulse">Loading secure checkout...</p>
        </div>
      </main>
    );
  }

  if (error === 'PASSWORD_REQUIRED') {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-6 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 bg-indigo-500/10 text-indigo-400 rounded-xl flex items-center justify-center mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold tracking-tight">Protected Payment Link</h2>
            <p className="text-zinc-400 text-xs mt-1">This checkout session requires a password to unlock.</p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label htmlFor="pass" className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">Password</label>
              <input
                id="pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-3 text-sm transition-all outline-none"
                placeholder="Enter checkout password"
                required
              />
              {passwordError && <p className="text-rose-400 text-xs mt-2">{passwordError}</p>}
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 rounded-xl transition-all hover:shadow-lg hover:shadow-indigo-600/20 active:scale-[0.98]"
            >
              Unlock Checkout
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (error === 'EXPIRED') {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-6 text-center shadow-2xl">
          <div className="w-12 h-12 bg-rose-500/10 text-rose-400 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold tracking-tight">Checkout Expired</h2>
          <p className="text-zinc-400 text-xs mt-2 leading-relaxed">This payment request has expired, has been completed, or is no longer accepting payments.</p>
        </div>
      </main>
    );
  }

  if (error || !linkData) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-6 text-center shadow-2xl">
          <div className="w-12 h-12 bg-rose-500/10 text-rose-400 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold tracking-tight">Checkout Unavailable</h2>
          <p className="text-zinc-400 text-xs mt-2 leading-relaxed">{error || 'This checkout page could not be loaded.'}</p>
        </div>
      </main>
    );
  }

  const brandName = linkData.brand?.brandName || 'AgenticPay';
  const accentColor = selectedVariant?.accentColor || linkData.brand?.accentColor || '#6366F1';
  const description = selectedVariant?.description || linkData.description || 'Secure checkout request';
  const amountToPay = selectedVariant ? selectedVariant.amount : linkData.amount;
  const ctaText = selectedVariant?.ctaText || 'Complete Payment';

  return (
    <main
      className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4 relative overflow-hidden"
      style={{ '--accent-color': accentColor } as React.CSSProperties}
    >
      {/* Background decoration */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-[var(--accent-color)]/5 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-indigo-500/5 blur-[120px] pointer-events-none"></div>

      {paymentSuccess ? (
        <div className="w-full max-w-md bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-8 text-center shadow-2xl animate-fade-in">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Payment Complete!</h2>
          <p className="text-zinc-400 text-sm mt-2 leading-relaxed">
            Your payment of <strong className="text-white">{amountToPay.toFixed(2)} {linkData.currency}</strong> was processed successfully.
          </p>

          <div className="mt-8 space-y-3">
            {linkData.brand?.redirectUrl && (
              <a
                href={linkData.brand.redirectUrl}
                className="block w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 rounded-xl transition-all"
              >
                Return to Merchant
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full max-w-lg bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row">
          {/* Main payment card */}
          <div className="flex-1 p-6 flex flex-col justify-between">
            <div>
              {/* Branding header */}
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800/50">
                {linkData.brand?.logoUrl ? (
                  <img
                    src={linkData.brand.logoUrl}
                    alt=""
                    className="w-10 h-10 rounded-xl object-contain border border-zinc-800 bg-zinc-900"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)] text-white flex items-center justify-center font-extrabold text-lg shadow-md shadow-indigo-600/10">
                    {brandName.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-sm tracking-tight">{brandName}</h3>
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] uppercase font-bold tracking-wider mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                    Verified Checkout
                  </div>
                </div>
              </div>

              {/* Amount display */}
              <div className="my-6">
                <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">Total Amount</span>
                <div className="flex items-baseline gap-2">
                  <h1 className="text-4xl font-black tracking-tight">{amountToPay.toFixed(2)}</h1>
                  <span className="text-xl font-bold text-zinc-300">{linkData.currency}</span>
                </div>
                {selectedVariant && (
                  <div className="inline-flex items-center gap-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg px-2.5 py-1 text-xs font-semibold mt-3">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                    Applied: {selectedVariant.name}
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1 mb-6">
                <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block">Description</span>
                <p className="text-zinc-200 text-sm leading-relaxed">{description}</p>
              </div>

              {/* Recurrence & Expiry */}
              <div className="grid grid-cols-2 gap-4 py-4 border-t border-zinc-800/40">
                <div>
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-1">Recurrence</span>
                  <span className="bg-zinc-800 text-zinc-300 text-xs font-semibold px-2.5 py-1 rounded-md capitalize">
                    {linkData.recurrence.replace('_', ' ')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-1">Expires</span>
                  <span className="text-zinc-300 text-xs font-semibold block mt-1">
                    {new Date(linkData.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              {paymentError && <p className="text-rose-400 text-xs text-center">{paymentError}</p>}
              
              <button
                onClick={handlePay}
                disabled={paying}
                className="w-full bg-[var(--accent-color)] hover:opacity-90 disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg hover:shadow-indigo-600/10 active:scale-[0.99] flex items-center justify-center gap-2"
                style={{ backgroundColor: accentColor }}
              >
                {paying ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Processing Payment...
                  </>
                ) : (
                  ctaText
                )}
              </button>

              {linkData.brand?.redirectUrl && (
                <a
                  href={linkData.brand.redirectUrl}
                  className="block text-center text-xs text-zinc-400 hover:text-white transition-colors py-1.5"
                >
                  Cancel and return to merchant
                </a>
              )}
            </div>
          </div>

          {/* QR code and social sidebar (only shown on larger screens or sidebar toggle) */}
          {qrCodeUrl && (
            <div className="w-full md:w-[180px] bg-zinc-950/40 border-t md:border-t-0 md:border-l border-zinc-800/40 p-6 flex flex-col justify-center items-center text-center gap-4">
              <div>
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-2">Scan to Pay</span>
                <div className="bg-white p-2.5 rounded-xl inline-block shadow-md">
                  <img src={qrCodeUrl} alt="Payment QR Code" className="w-28 h-28" />
                </div>
              </div>
              
              {shareLinks && (
                <div className="w-full pt-4 border-t border-zinc-900/60">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-2.5">Share Link</span>
                  <div className="flex justify-center gap-2.5">
                    <a
                      href={shareLinks.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-white transition-colors p-1"
                      title="Share on X/Twitter"
                    >
                      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </a>
                    <a
                      href={shareLinks.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-white transition-colors p-1"
                      title="Share on WhatsApp"
                    >
                      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.024-.014-.508-.25-5.887-.29c-.08-.003-.153.025-.21.08-.29.28-.593.578-.857.855c-.754-.378-1.508-.756-2.072-1.32c-.564-.564-.942-1.318-1.32-2.072c.277-.264.575-.567.855-.857a.3.3 0 0 0 .08-.21c-.04-5.379-.276-5.863-.29-5.887a.3.3 0 0 0-.256-.178C7.306 4.472 3.125 4.6 3.013 4.607c-.43.033-.762.396-.762.831c0 5.485 2.122 10.638 5.975 14.492c3.854 3.853 9.007 5.975 14.492 5.975c.435 0 .798-.332.831-.762c.007-.112.135-4.293-.021-4.398a.3.3 0 0 0-.178-.256z" />
                      </svg>
                    </a>
                    <a
                      href={shareLinks.telegram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-white transition-colors p-1"
                      title="Share on Telegram"
                    >
                      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .24z" />
                      </svg>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
