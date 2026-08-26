'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiCall } from '@/lib/api/client';

interface Milestone {
  id: string;
  title: string;
  status: string;
  dueDate: string;
}

interface Dependency {
  id: string;
  milestoneId: string;
  dependsOnMilestoneId: string;
  status: string;
}

interface DependencyGraph {
  projectId: string;
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: string;
    blockedBy: string[];
  }>;
  edges: Array<{ from: string; to: string }>;
  criticalPath: string[];
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  submitted: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  released: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-700',
};

export default function MilestoneDependenciesPage() {
  const [projectId, setProjectId] = useState('');
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ milestoneId: '', dependsOnMilestoneId: '' });

  const fetchProject = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [graphRes, depsRes, msRes] = await Promise.all([
        apiCall<{ data: DependencyGraph }>(`/milestones/${projectId}/graph`),
        apiCall<{ data: Dependency[] }>(`/milestones/${projectId}/dependencies`),
        apiCall(`/api/v1/projects/${projectId}`),
      ]);
      setGraph(graphRes.data);
      setDependencies(depsRes.data);
      setMilestones(msRes.milestones || []);
    } catch (err) {
      console.error('Failed to fetch project data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) fetchProject();
  }, [projectId]);

  const handleAddDependency = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiCall(`/milestones/${projectId}/dependencies`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowAdd(false);
      setForm({ milestoneId: '', dependsOnMilestoneId: '' });
      fetchProject();
    } catch (err) {
      console.error('Failed to add dependency:', err);
    }
  };

  const handleRemoveDependency = async (depId: string) => {
    try {
      await apiCall(`/milestones/dependencies/${depId}`, { method: 'DELETE' });
      fetchProject();
    } catch (err) {
      console.error('Failed to remove dependency:', err);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Milestone Dependencies</h1>
        <p className="text-sm text-muted-foreground mt-1">Track milestone blocking relationships and dependency chains.</p>
      </div>

      <div className="flex gap-3 items-end">
        <div className="space-y-1 flex-1">
          <Label>Project ID</Label>
          <Input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Enter project ID"
          />
        </div>
        <Button onClick={fetchProject} disabled={!projectId || loading}>
          {loading ? 'Loading...' : 'Load'}
        </Button>
        <Button variant="outline" onClick={() => setShowAdd(true)} disabled={!projectId}>
          Add Dependency
        </Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Dependency</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddDependency} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Milestone (blocked)</Label>
                  <select
                    value={form.milestoneId}
                    onChange={(e) => setForm({ ...form, milestoneId: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    required
                  >
                    <option value="">Select milestone</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Depends On (must complete first)</Label>
                  <select
                    value={form.dependsOnMilestoneId}
                    onChange={(e) => setForm({ ...form, dependsOnMilestoneId: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    required
                  >
                    <option value="">Select dependency</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit">Add</Button>
                <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {graph && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dependency Graph</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {graph.nodes.map((node) => (
                  <div key={node.id} className="flex items-center gap-4 p-3 border rounded">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{node.title}</span>
                        <Badge className={statusColors[node.status] || 'bg-gray-100'}>{node.status}</Badge>
                        {graph.criticalPath.includes(node.id) && (
                          <Badge className="bg-orange-100 text-orange-700">Critical Path</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Due: {new Date(node.dueDate).toLocaleDateString()}
                        {node.blockedBy.length > 0 && (
                          <> | Blocked by: {node.blockedBy.length} milestone{node.blockedBy.length > 1 ? 's' : ''}</>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {graph.edges.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm font-medium mb-2">Dependencies ({graph.edges.length})</p>
                  <div className="space-y-2">
                    {graph.edges.map((edge, i) => {
                      const fromNode = graph.nodes.find((n) => n.id === edge.from);
                      const toNode = graph.nodes.find((n) => n.id === edge.to);
                      return (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{fromNode?.title || edge.from}</span>
                          <span className="text-muted-foreground">→</span>
                          <span>{toNode?.title || edge.to}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Dependencies ({dependencies.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {dependencies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No dependencies configured.</p>
              ) : (
                <div className="space-y-2">
                  {dependencies.map((dep) => {
                    const fromMs = milestones.find((m) => m.id === dep.dependsOnMilestoneId);
                    const toMs = milestones.find((m) => m.id === dep.milestoneId);
                    return (
                      <div key={dep.id} className="flex items-center justify-between p-3 border rounded">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{fromMs?.title || dep.dependsOnMilestoneId}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">{toMs?.title || dep.milestoneId}</span>
                          <Badge className={dep.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                            {dep.status}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveDependency(dep.id)}>
                          Remove
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
