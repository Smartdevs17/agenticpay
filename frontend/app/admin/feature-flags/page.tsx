"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface FeatureFlag {
    name: string;
    enabled: boolean;
    rolloutPercentage: number;
    targetedUsers: string[];
    metrics: {
        servedTrue: number;
        servedFalse: number;
    };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export default function FeatureFlagsPage() {
    const [flags, setFlags] = useState<FeatureFlag[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingFlag, setEditingFlag] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<FeatureFlag>>({});
    const [newFlagName, setNewFlagName] = useState("");

    useEffect(() => {
        fetchFlags();
    }, []);

    const fetchFlags = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_BASE}/feature-flags`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Failed to fetch flags");
            const data = await res.json();
            setFlags(data.flags);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to load flags");
        } finally {
            setLoading(false);
        }
    };

    const handleCreateFlag = async () => {
        if (!newFlagName.trim()) return;
        try {
            const res = await fetch(`${API_BASE}/feature-flags/${newFlagName.trim()}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify({ enabled: false, rolloutPercentage: 0, targetedUsers: [] }),
            });
            if (!res.ok) throw new Error("Failed to create flag");
            toast.success(`Flag "${newFlagName}" created`);
            setNewFlagName("");
            fetchFlags();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create flag");
        }
    };

    const handleUpdateFlag = async (name: string) => {
        try {
            const res = await fetch(`${API_BASE}/feature-flags/${name}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify(editForm),
            });
            if (!res.ok) throw new Error("Failed to update flag");
            toast.success(`Flag "${name}" updated`);
            setEditingFlag(null);
            fetchFlags();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update flag");
        }
    };

    const handleDeleteFlag = async (name: string) => {
        if (!confirm(`Delete flag "${name}"?`)) return;
        try {
            const res = await fetch(`${API_BASE}/feature-flags/${name}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Failed to delete flag");
            toast.success(`Flag "${name}" deleted`);
            fetchFlags();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete flag");
        }
    };

    const toggleKillSwitch = async (name: string, currentEnabled: boolean) => {
        setEditForm({ enabled: !currentEnabled, rolloutPercentage: currentEnabled ? 0 : 100, targetedUsers: [] });
        try {
            const res = await fetch(`${API_BASE}/feature-flags/${name}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify({ enabled: !currentEnabled, rolloutPercentage: currentEnabled ? 0 : 100, targetedUsers: [] }),
            });
            if (!res.ok) throw new Error("Failed to toggle kill switch");
            toast.success(currentEnabled ? `"${name}" disabled via kill switch` : `"${name}" enabled`);
            fetchFlags();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to toggle kill switch");
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
                    <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
                    <p className="text-sm text-gray-600">Manage feature rollouts, A/B tests, and kill switches</p>
                </div>
            </div>

            {/* Create new flag */}
            <Card className="p-4">
                <div className="flex gap-3">
                    <Input
                        placeholder="New flag name (e.g., new-checkout-flow)"
                        value={newFlagName}
                        onChange={(e) => setNewFlagName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreateFlag()}
                        className="flex-1"
                    />
                    <Button onClick={handleCreateFlag} disabled={!newFlagName.trim()}>
                        Create Flag
                    </Button>
                </div>
            </Card>

            {/* Flags list */}
            <div className="space-y-3">
                {flags.length === 0 && (
                    <Card className="p-8 text-center">
                        <p className="text-gray-500">No feature flags created yet</p>
                    </Card>
                )}

                {flags.map((flag) => (
                    <Card key={flag.name} className="p-4">
                        {editingFlag === flag.name ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Badge variant={flag.enabled ? "default" : "secondary"}>
                                        {flag.enabled ? "Enabled" : "Disabled"}
                                    </Badge>
                                    <span className="font-medium text-gray-900">{flag.name}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Enabled</label>
                                        <input
                                            type="checkbox"
                                            checked={editForm.enabled ?? flag.enabled}
                                            onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                                            className="mt-1 h-4 w-4"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Rollout %</label>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={editForm.rolloutPercentage ?? flag.rolloutPercentage}
                                            onChange={(e) => setEditForm({ ...editForm, rolloutPercentage: parseInt(e.target.value) || 0 })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Targeted Users (comma-separated)</label>
                                        <Input
                                            value={(editForm.targetedUsers ?? flag.targetedUsers).join(", ")}
                                            onChange={(e) => setEditForm({ ...editForm, targetedUsers: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setEditingFlag(null)}>Cancel</Button>
                                    <Button onClick={() => handleUpdateFlag(flag.name)}>Save</Button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <Badge variant={flag.enabled ? "default" : "secondary"}>
                                            {flag.enabled ? "ON" : "OFF"}
                                        </Badge>
                                        <div>
                                            <h3 className="font-medium text-gray-900">{flag.name}</h3>
                                            {flag.rolloutPercentage > 0 && flag.rolloutPercentage < 100 && (
                                                <p className="text-sm text-gray-500">Rolled out to {flag.rolloutPercentage}% of users</p>
                                            )}
                                            {flag.targetedUsers.length > 0 && (
                                                <p className="text-sm text-gray-500">{flag.targetedUsers.length} targeted user(s)</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500">
                                            {flag.metrics.servedTrue + flag.metrics.servedFalse > 0
                                                ? `${((flag.metrics.servedTrue / (flag.metrics.servedTrue + flag.metrics.servedFalse)) * 100).toFixed(1)}% true`
                                                : "No evaluations"}
                                        </span>
                                        <Button
                                            variant={flag.enabled ? "destructive" : "default"}
                                            size="sm"
                                            onClick={() => toggleKillSwitch(flag.name, flag.enabled)}
                                        >
                                            {flag.enabled ? "Kill Switch" : "Enable"}
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => {
                                            setEditingFlag(flag.name);
                                            setEditForm({ enabled: flag.enabled, rolloutPercentage: flag.rolloutPercentage, targetedUsers: flag.targetedUsers });
                                        }}>
                                            Edit
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => handleDeleteFlag(flag.name)}>
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </Card>
                ))}
            </div>
        </div>
    );
}