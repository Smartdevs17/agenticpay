"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ApiKey {
    keyId: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    _count: { usage: number };
    quota: {
        hourlyLimit: number;
        currentUsage: number;
        resetAt: string;
    } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export default function ApiKeysPage() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newKeyDescription, setNewKeyDescription] = useState("");
    const [newKeyExpiry, setNewKeyExpiry] = useState("");
    const [usageSummary, setUsageSummary] = useState<{
        totalRequests: number;
        blockedRequests: number;
        quotaUsagePercent: number;
    } | null>(null);

    useEffect(() => {
        fetchKeys();
        fetchUsageSummary();
    }, []);

    const fetchKeys = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_BASE}/api-keys`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Failed to fetch API keys");
            const data = await res.json();
            setKeys(data.keys);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to load API keys");
        } finally {
            setLoading(false);
        }
    };

    const fetchUsageSummary = async () => {
        try {
            const res = await fetch(`${API_BASE}/api-keys/analytics/summary`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (res.ok) {
                const data = await res.json();
                setUsageSummary(data);
            }
        } catch {
            // Analytics may not be available
        }
    };

    const createKey = async () => {
        try {
            const res = await fetch(`${API_BASE}/api-keys`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify({
                    description: newKeyDescription,
                    expiresAt: newKeyExpiry || undefined,
                }),
            });
            if (!res.ok) throw new Error("Failed to create API key");
            const data = await res.json();
            toast.success("API key created", {
                description: `Key ID: ${data.keyId}`,
            });
            setShowCreateForm(false);
            setNewKeyDescription("");
            setNewKeyExpiry("");
            fetchKeys();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create API key");
        }
    };

    const revokeKey = async (keyId: string) => {
        if (!confirm("Revoke this API key? This action cannot be undone.")) return;
        try {
            const res = await fetch(`${API_BASE}/api-keys/${keyId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Failed to revoke key");
            toast.success("API key revoked");
            fetchKeys();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to revoke key");
        }
    };

    const rotateKey = async (keyId: string) => {
        if (!confirm("Rotate this API key? The old key will be revoked and a new one created.")) return;
        try {
            const res = await fetch(`${API_BASE}/api-keys/${keyId}/rotate`, {
                method: "POST",
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Failed to rotate key");
            const data = await res.json();
            toast.success("API key rotated", {
                description: `New key: ${data.keyId}`,
            });
            fetchKeys();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to rotate key");
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
                    <p className="text-sm text-gray-600">Manage your API keys and monitor usage</p>
                </div>
                <Button onClick={() => setShowCreateForm(!showCreateForm)}>
                    {showCreateForm ? "Cancel" : "Create API Key"}
                </Button>
            </div>

            {/* Usage Summary */}
            {usageSummary && (
                <Card className="p-4">
                    <h3 className="mb-2 font-medium text-gray-900">Usage Summary</h3>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{usageSummary.totalRequests.toLocaleString()}</p>
                            <p className="text-sm text-gray-500">Total Requests</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-red-600">{usageSummary.blockedRequests.toLocaleString()}</p>
                            <p className="text-sm text-gray-500">Blocked (Rate Limited)</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-blue-600">{usageSummary.quotaUsagePercent.toFixed(1)}%</p>
                            <p className="text-sm text-gray-500">Quota Used</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Create Key Form */}
            {showCreateForm && (
                <Card className="p-4">
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Description</label>
                            <Input
                                placeholder="e.g., Production API key"
                                value={newKeyDescription}
                                onChange={(e) => setNewKeyDescription(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Expiry (optional)</label>
                            <Input
                                type="date"
                                value={newKeyExpiry}
                                onChange={(e) => setNewKeyExpiry(e.target.value)}
                            />
                        </div>
                        <div className="flex justify-end">
                            <Button onClick={createKey} disabled={!newKeyDescription.trim()}>
                                Create Key
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Keys List */}
            <div className="space-y-3">
                {keys.length === 0 && (
                    <Card className="p-8 text-center">
                        <p className="text-gray-500">No API keys created yet</p>
                    </Card>
                )}

                {keys.map((key) => (
                    <Card key={key.keyId} className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <Badge variant={key.isActive ? "default" : "destructive"}>
                                    {key.isActive ? "Active" : "Revoked"}
                                </Badge>
                                <div>
                                    <p className="font-medium text-gray-900">
                                        {key.description || "Unnamed Key"}
                                    </p>
                                    <p className="text-sm font-mono text-gray-500">
                                        {key.keyId.slice(0, 12)}...
                                    </p>
                                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                                        <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                                        {key.expiresAt && (
                                            <span>Expires: {new Date(key.expiresAt).toLocaleDateString()}</span>
                                        )}
                                        <span>Usage: {key._count.usage} requests</span>
                                    </div>
                                    {key.quota && (
                                        <div className="mt-1">
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-gray-500">Hourly quota:</span>
                                                <div className="h-2 w-32 rounded-full bg-gray-200">
                                                    <div
                                                        className="h-2 rounded-full bg-blue-600"
                                                        style={{
                                                            width: `${Math.min(100, (key.quota.currentUsage / key.quota.hourlyLimit) * 100)}%`,
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-gray-700">
                                                    {key.quota.currentUsage}/{key.quota.hourlyLimit}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {key.isActive && (
                                    <>
                                        <Button variant="outline" size="sm" onClick={() => rotateKey(key.keyId)}>
                                            Rotate
                                        </Button>
                                        <Button variant="destructive" size="sm" onClick={() => revokeKey(key.keyId)}>
                                            Revoke
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}