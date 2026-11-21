'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Settings, Users, Mail, Shield, Trash2, Copy, Check } from 'lucide-react';

type Workspace = {
    id: string;
    name: string;
    slug: string;
    description?: string;
    logoUrl?: string;
    ownerId: string;
    isActive: boolean;
    settings: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

type WorkspaceMember = {
    id: string;
    workspaceId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    joinedAt: string;
};

type WorkspaceInvitation = {
    id: string;
    workspaceId: string;
    email: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    token: string;
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    expiresAt: string;
    createdAt: string;
};

const ROLE_HIERARCHY: Record<string, number> = {
    viewer: 0,
    member: 1,
    admin: 2,
    owner: 3,
};

const ROLE_COLORS: Record<string, string> = {
    owner: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    member: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

export default function WorkspacesPage() {
    const t = useTranslations('workspaces');
    const { toast } = useToast();
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
    const [loading, setLoading] = useState(true);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<string>('member');
    const [copiedToken, setCopiedToken] = useState<string | null>(null);

    const userId = 'current-user-id'; // Replace with actual auth context

    useEffect(() => {
        loadWorkspaces();
    }, []);

    useEffect(() => {
        if (selectedWorkspace) {
            loadMembers(selectedWorkspace.id);
            loadInvitations(selectedWorkspace.id);
        }
    }, [selectedWorkspace]);

    async function loadWorkspaces() {
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/workspaces?userId=${userId}`);
            const data = await res.json();
            setWorkspaces(data.data || []);
            if (data.data?.length > 0 && !selectedWorkspace) {
                setSelectedWorkspace(data.data[0]);
            }
        } catch (err) {
            console.error('Failed to load workspaces:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadMembers(workspaceId: string) {
        try {
            const res = await fetch(`/api/v1/workspaces/${workspaceId}/members?userId=${userId}`);
            const data = await res.json();
            setMembers(data.data || []);
        } catch (err) {
            console.error('Failed to load members:', err);
        }
    }

    async function loadInvitations(workspaceId: string) {
        try {
            const res = await fetch(`/api/v1/workspaces/${workspaceId}/invitations?userId=${userId}`);
            const data = await res.json();
            setInvitations(data.data || []);
        } catch (err) {
            console.error('Failed to load invitations:', err);
        }
    }

    async function handleCreateWorkspace() {
        if (!newWorkspaceName.trim()) return;
        try {
            const res = await fetch('/api/v1/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newWorkspaceName,
                    description: newWorkspaceDesc,
                    userId,
                }),
            });
            const data = await res.json();
            if (data.data) {
                setWorkspaces([...workspaces, data.data]);
                setSelectedWorkspace(data.data);
                setCreateDialogOpen(false);
                setNewWorkspaceName('');
                setNewWorkspaceDesc('');
                toast({ title: 'Workspace created', description: `"${data.data.name}" is ready.` });
            }
        } catch (err) {
            toast({ title: 'Error', description: 'Failed to create workspace', variant: 'destructive' });
        }
    }

    async function handleInvite() {
        if (!inviteEmail.trim() || !selectedWorkspace) return;
        try {
            const res = await fetch(`/api/v1/workspaces/${selectedWorkspace.id}/invitations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole, invitedBy: userId }),
            });
            const data = await res.json();
            if (data.data) {
                setInvitations([...invitations, data.data]);
                setInviteDialogOpen(false);
                setInviteEmail('');
                toast({ title: 'Invitation sent', description: `Invited ${inviteEmail} as ${inviteRole}` });
            }
        } catch (err) {
            toast({ title: 'Error', description: 'Failed to send invitation', variant: 'destructive' });
        }
    }

    async function handleRemoveMember(memberUserId: string) {
        if (!selectedWorkspace) return;
        try {
            await fetch(`/api/v1/workspaces/${selectedWorkspace.id}/members/${memberUserId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
            setMembers(members.filter((m) => m.userId !== memberUserId));
            toast({ title: 'Member removed' });
        } catch (err) {
            toast({ title: 'Error', description: 'Failed to remove member', variant: 'destructive' });
        }
    }

    async function handleUpdateRole(memberUserId: string, newRole: string) {
        if (!selectedWorkspace) return;
        try {
            const res = await fetch(`/api/v1/workspaces/${selectedWorkspace.id}/members/${memberUserId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole, userId }),
            });
            const data = await res.json();
            if (data.data) {
                setMembers(members.map((m) => (m.userId === memberUserId ? { ...m, role: newRole as any } : m)));
                toast({ title: 'Role updated' });
            }
        } catch (err) {
            toast({ title: 'Error', description: 'Failed to update role', variant: 'destructive' });
        }
    }

    function copyInviteLink(token: string) {
        const link = `${window.location.origin}/invite?token=${token}`;
        navigator.clipboard.writeText(link);
        setCopiedToken(token);
        setTimeout(() => setCopiedToken(null), 2000);
        toast({ title: 'Link copied!' });
    }

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="h-8 w-48 bg-gray-200 rounded dark:bg-gray-700" />
                <div className="h-64 bg-gray-200 rounded dark:bg-gray-700" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Workspaces</h1>
                    <p className="text-gray-500 mt-1">Manage your multi-tenant workspaces and team access</p>
                </div>
                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            New Workspace
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Workspace</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>Name</Label>
                                <Input
                                    value={newWorkspaceName}
                                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                                    placeholder="My Organization"
                                />
                            </div>
                            <div>
                                <Label>Description (optional)</Label>
                                <Input
                                    value={newWorkspaceDesc}
                                    onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                                    placeholder="Team workspace for..."
                                />
                            </div>
                            <Button onClick={handleCreateWorkspace} className="w-full">
                                Create Workspace
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {workspaces.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Shield className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">No workspaces yet</h3>
                        <p className="text-gray-500 mt-2">Create your first workspace to get started with team collaboration.</p>
                        <Button className="mt-4" onClick={() => setCreateDialogOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Create Workspace
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Workspace List */}
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">All Workspaces</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {workspaces.map((ws) => (
                                <button
                                    key={ws.id}
                                    onClick={() => setSelectedWorkspace(ws)}
                                    className={`w-full text-left p-3 rounded-lg transition-colors ${selectedWorkspace?.id === ws.id
                                            ? 'bg-primary/10 text-primary'
                                            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                                        }`}
                                >
                                    <div className="font-medium">{ws.name}</div>
                                    <div className="text-xs text-gray-500 mt-1">{ws.slug}</div>
                                </button>
                            ))}
                        </CardContent>
                    </Card>

                    {/* Workspace Details */}
                    {selectedWorkspace && (
                        <div className="lg:col-span-3 space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>{selectedWorkspace.name}</CardTitle>
                                    <CardDescription>{selectedWorkspace.description || 'No description'}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                        <div>
                                            <Label className="text-xs text-gray-500">Slug</Label>
                                            <p className="font-mono text-sm">{selectedWorkspace.slug}</p>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-gray-500">Members</Label>
                                            <p className="text-sm font-medium">{members.length}</p>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-gray-500">Created</Label>
                                            <p className="text-sm">{new Date(selectedWorkspace.createdAt).toLocaleDateString()}</p>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-gray-500">Status</Label>
                                            <Badge variant={selectedWorkspace.isActive ? 'default' : 'secondary'}>
                                                {selectedWorkspace.isActive ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Tabs defaultValue="members">
                                <TabsList>
                                    <TabsTrigger value="members">
                                        <Users className="h-4 w-4 mr-2" />
                                        Members ({members.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="invitations">
                                        <Mail className="h-4 w-4 mr-2" />
                                        Invitations ({invitations.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="settings">
                                        <Settings className="h-4 w-4 mr-2" />
                                        Settings
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="members" className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-lg font-medium">Team Members</h3>
                                        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                                            <DialogTrigger asChild>
                                                <Button size="sm">
                                                    <Plus className="h-4 w-4 mr-2" />
                                                    Invite Member
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Invite Member</DialogTitle>
                                                </DialogHeader>
                                                <div className="space-y-4">
                                                    <div>
                                                        <Label>Email</Label>
                                                        <Input
                                                            value={inviteEmail}
                                                            onChange={(e) => setInviteEmail(e.target.value)}
                                                            placeholder="colleague@company.com"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label>Role</Label>
                                                        <Select value={inviteRole} onValueChange={setInviteRole}>
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="admin">Admin</SelectItem>
                                                                <SelectItem value="member">Member</SelectItem>
                                                                <SelectItem value="viewer">Viewer</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <Button onClick={handleInvite} className="w-full">
                                                        Send Invitation
                                                    </Button>
                                                </div>
                                            </DialogContent>
                                        </Dialog>
                                    </div>

                                    <div className="space-y-2">
                                        {members.map((member) => (
                                            <div
                                                key={member.id}
                                                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium">
                                                        {member.userId.slice(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm">{member.userId}</p>
                                                        <p className="text-xs text-gray-500">
                                                            Joined {new Date(member.joinedAt).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge className={ROLE_COLORS[member.role]}>
                                                        {member.role}
                                                    </Badge>
                                                    {member.role !== 'owner' && (
                                                        <>
                                                            <Select
                                                                value={member.role}
                                                                onValueChange={(val) => handleUpdateRole(member.userId, val)}
                                                            >
                                                                <SelectTrigger className="w-24 h-8">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="admin">Admin</SelectItem>
                                                                    <SelectItem value="member">Member</SelectItem>
                                                                    <SelectItem value="viewer">Viewer</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleRemoveMember(member.userId)}
                                                            >
                                                                <Trash2 className="h-4 w-4 text-red-500" />
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </TabsContent>

                                <TabsContent value="invitations" className="space-y-4">
                                    <h3 className="text-lg font-medium">Pending Invitations</h3>
                                    {invitations.length === 0 ? (
                                        <p className="text-gray-500 text-sm">No pending invitations.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {invitations.map((inv) => (
                                                <div
                                                    key={inv.id}
                                                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                                                >
                                                    <div>
                                                        <p className="font-medium text-sm">{inv.email}</p>
                                                        <div className="flex gap-2 mt-1">
                                                            <Badge className={ROLE_COLORS[inv.role]}>
                                                                {inv.role}
                                                            </Badge>
                                                            <Badge variant="outline">{inv.status}</Badge>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-gray-500">
                                                            Expires {new Date(inv.expiresAt).toLocaleDateString()}
                                                        </span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => copyInviteLink(inv.token)}
                                                        >
                                                            {copiedToken === inv.token ? (
                                                                <Check className="h-4 w-4 text-green-500" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="settings" className="space-y-4">
                                    <h3 className="text-lg font-medium">Workspace Settings</h3>
                                    <div className="space-y-4 max-w-md">
                                        <div>
                                            <Label>Workspace Name</Label>
                                            <Input defaultValue={selectedWorkspace.name} />
                                        </div>
                                        <div>
                                            <Label>Description</Label>
                                            <Input defaultValue={selectedWorkspace.description || ''} />
                                        </div>
                                        <Button>Save Changes</Button>
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}