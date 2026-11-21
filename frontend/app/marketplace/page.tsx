'use client';

import { useEffect, useState } from 'react';

type Manifest = { agentId: string; version: string; capabilities: string[]; endpoint: string; publishedAt: string; digest: string };

/** Capability marketplace: manifests are verified by the API before installation. */
export default function MarketplacePage() {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/v1/marketplace/manifests')
      .then(async (response) => { if (!response.ok) throw new Error('Unable to load capability manifests'); return response.json(); })
      .then((body) => setManifests(body.data ?? []))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load capability manifests'));
  }, []);
  return <main className="mx-auto max-w-5xl space-y-6 p-8"><div><h1 className="text-3xl font-semibold">Agent capability marketplace</h1><p className="text-muted-foreground">Browse signed, versioned capabilities before installing them.</p></div>{error && <p role="alert">{error}</p>}<div className="grid gap-4 md:grid-cols-2">{manifests.map((entry) => <article key={entry.digest} className="rounded-lg border p-5"><div className="flex justify-between"><h2 className="font-medium">{entry.agentId}</h2><span>v{entry.version}</span></div><p className="mt-2 text-sm">{entry.endpoint}</p><div className="mt-3 flex flex-wrap gap-2">{entry.capabilities.map((capability) => <span className="rounded bg-muted px-2 py-1 text-xs" key={capability}>{capability}</span>)}</div></article>)}</div></main>;
}
