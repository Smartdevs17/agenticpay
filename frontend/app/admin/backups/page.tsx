"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface BackupRecord {
    id: string;
    type: "full" | "incremental";
    status: "running" | "completed" | "failed";
    sizeBytes: number;
    checksum: string;
    path: string;
    startedAt: string;
    completedAt?: string;
    error?: string;
}

interface RestorePoint {
    id: string;
    timestamp: string;
    fullBackupId: string;
    incrementalBackupIds: string[];
    status: "available" | "restoring" | "restored" | "failed";
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export default function BackupsPage() {
    const [backups, setBackups] = useState<BackupRecord[]>([]);
    const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [creatingBackup, setCreatingBackup] = useState(false);
    const [verifyingId, setVerifyingId] = useState<string | null>(null);
    const [restoringId, setRestoringId] = useState<string | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [backupsRes, restoreRes] = await Promise.all([
                fetch(`${API_BASE}/backups`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
                }),
                fetch(`${API_BASE}/backups/restore-points`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
                }),
            ]);

            if (backupsRes.ok) {
                const data = await backupsRes.json();
                setBackups(data.backups);
            }
            if (restoreRes.ok) {
                const data = await restoreRes.json();
                setRestorePoints(data.restorePoints);
            }
        } catch (err) {
            toast.error("Failed to load backup data");
        } finally {
            setLoading(false);
        }
    };

    const createFullBackup = async () => {
        try {
            setCreatingBackup(true);
            const res = await fetch(`${API_BASE}/backups/full`, {
                method: "POST",
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Failed to create backup");
            toast.success("Full backup started");
            fetchData();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create backup");
        } finally {
            setCreatingBackup(false);
        }
    };

    const verifyBackup = async (id: string) => {
        try {
            setVerifyingId(id);
            const res = await fetch(`${API_BASE}/backups/${id}/verify`, {
                method: "POST",
                headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
            });
            if (!res.ok) throw new Error("Verification failed");
            const data = await res.json();
            toast.success(data.valid ? "Backup integrity verified" : "Backup integrity check failed");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Verification failed");
        } finally {
            setVerifyingId(null);
        }
    };

    const restoreFromPoint = async (restorePointId: string) => {
        if (!confirm("Are you sure you want to restore from this point? This will overwrite the current database.")) return;
        try {
            setRestoringId(restorePointId);
            const res = await fetch(`${API_BASE}/backups/restore/${restorePointId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error("Restore failed");
            toast.success("Restore completed successfully");
            fetchData();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Restore failed");
        } finally {
            setRestoringId(null);
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes === 0) return "0 B";
        const units = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
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
                    <h1 className="text-2xl font-bold text-gray-900">Backup & Disaster Recovery</h1>
                    <p className="text-sm text-gray-600">
                        RTO: <4 hours | RPO: <1 hour | Retention: 30 days
                    </p>
                </div>
                <Button onClick={createFullBackup} disabled={creatingBackup}>
                    {creatingBackup ? "Creating..." : "Create Full Backup"}
                </Button>
            </div>

            {/* Restore Points */}
            <div>
                <h2 className="mb-3 text-lg font-semibold text-gray-900">Restore Points</h2>
                {restorePoints.length === 0 ? (
                    <Card className="p-6 text-center text-gray-500">
                        No restore points available. Create a full backup first.
                    </Card>
                ) : (
                    <div className="space-y-2">
                        {restorePoints.map((rp) => (
                            <Card key={rp.id} className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-3">
                                    <Badge variant={rp.status === "available" ? "default" : rp.status === "restored" ? "secondary" : "destructive"}>
                                        {rp.status}
                                    </Badge>
                                    <div>
                                        <p className="font-medium text-gray-900">
                                            {new Date(rp.timestamp).toLocaleString()}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            Full: {rp.fullBackupId.slice(0, 20)}...
                                            {rp.incrementalBackupIds.length > 0 && ` | +${rp.incrementalBackupIds.length} incremental`}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => restoreFromPoint(rp.id)}
                                    disabled={rp.status !== "available" || restoringId === rp.id}
                                >
                                    {restoringId === rp.id ? "Restoring..." : "Restore"}
                                </Button>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Backup History */}
            <div>
                <h2 className="mb-3 text-lg font-semibold text-gray-900">Backup History</h2>
                {backups.length === 0 ? (
                    <Card className="p-6 text-center text-gray-500">
                        No backups yet
                    </Card>
                ) : (
                    <div className="space-y-2">
                        {backups.map((backup) => (
                            <Card key={backup.id} className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-3">
                                    <Badge variant={backup.type === "full" ? "default" : "secondary"}>
                                        {backup.type}
                                    </Badge>
                                    <Badge
                                        variant={backup.status === "completed" ? "default" : backup.status === "running" ? "secondary" : "destructive"}
                                    >
                                        {backup.status}
                                    </Badge>
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">
                                            {new Date(backup.startedAt).toLocaleString()}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {formatSize(backup.sizeBytes)}
                                            {backup.completedAt && ` | Completed: ${new Date(backup.completedAt).toLocaleString()}`}
                                        </p>
                                        {backup.error && (
                                            <p className="text-xs text-red-600">{backup.error}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => verifyBackup(backup.id)}
                                        disabled={backup.status !== "completed" || verifyingId === backup.id}
                                    >
                                        {verifyingId === backup.id ? "Verifying..." : "Verify"}
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}