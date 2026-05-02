"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  Dispute,
  CreateDisputeForm,
  ResolutionOutcome,
} from "@/types/disputes";
import { mockDisputes } from "@/lib/mock-data/disputes";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1/disputes${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token") ?? ""
          : ""
      }`,
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  const data = await res.json();
  return data.data ?? data;
}

export function useDisputes() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // In development, fall back to mock data when API is unavailable
      if (process.env.NODE_ENV === "development") {
        await new Promise((r) => setTimeout(r, 300));
        setDisputes(mockDisputes);
        return;
      }
      const data = await apiFetch<Dispute[]>("?role=all");
      setDisputes(data);
    } catch (e) {
      setError((e as Error).message);
      setDisputes(mockDisputes); // graceful fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const createDispute = useCallback(async (form: CreateDisputeForm): Promise<Dispute> => {
    try {
      const dispute = await apiFetch<Dispute>("", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setDisputes((prev) => [dispute, ...prev]);
      return dispute;
    } catch (e) {
      // Dev mock: create locally
      if (process.env.NODE_ENV === "development") {
        const mock: Dispute = {
          id: `dsp_${Date.now()}`,
          ...form,
          filedBy: "user_001",
          status: "awaiting_response",
          evidence: [],
          messages: [
            {
              id: `msg_${Date.now()}`,
              disputeId: `dsp_${Date.now()}`,
              senderId: "system",
              senderRole: "system",
              content: "Dispute filed. Respondent has 3 days to respond.",
              timestamp: new Date().toISOString(),
            },
          ],
          resolution: "pending",
          responseDeadline: new Date(
            Date.now() + 72 * 60 * 60 * 1000
          ).toISOString(),
          escalationDeadline: new Date(
            Date.now() + 168 * 60 * 60 * 1000
          ).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setDisputes((prev) => [mock, ...prev]);
        return mock;
      }
      throw e;
    }
  }, []);

  const respondToDispute = useCallback(
    async (disputeId: string, response: string): Promise<Dispute> => {
      const updated = await apiFetch<Dispute>(`/${disputeId}/respond`, {
        method: "POST",
        body: JSON.stringify({ response }),
      });
      setDisputes((prev) => prev.map((d) => (d.id === disputeId ? updated : d)));
      return updated;
    },
    []
  );

  const addEvidence = useCallback(
    async (
      disputeId: string,
      file: {
        url: string;
        name: string;
        type: string;
        size: number;
        description: string;
      }
    ) => {
      await apiFetch(`/${disputeId}/evidence`, {
        method: "POST",
        body: JSON.stringify(file),
      });
      await fetchDisputes();
    },
    [fetchDisputes]
  );

  const resolveDispute = useCallback(
    async (
      disputeId: string,
      outcome: ResolutionOutcome,
      resolutionNote: string,
      refundAmount?: number
    ): Promise<Dispute> => {
      const updated = await apiFetch<Dispute>(`/${disputeId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ outcome, resolutionNote, refundAmount }),
      });
      setDisputes((prev) => prev.map((d) => (d.id === disputeId ? updated : d)));
      return updated;
    },
    []
  );

  return {
    disputes,
    loading,
    error,
    refetch: fetchDisputes,
    createDispute,
    respondToDispute,
    addEvidence,
    resolveDispute,
  };
}

export function useDisputeById(id: string) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (process.env.NODE_ENV === "development") {
          await new Promise((r) => setTimeout(r, 200));
          const found = mockDisputes.find((d) => d.id === id) ?? null;
          setDispute(found);
          return;
        }
        const data = await apiFetch<Dispute>(`/${id}`);
        setDispute(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  return { dispute, loading, error, setDispute };
}
