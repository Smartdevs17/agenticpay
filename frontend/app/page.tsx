import { HomePageClient } from "@/components/landing/HomePageClient";
import { observeCacheEnvelope } from "@/lib/cache/headers";
import { getLandingSnapshot } from "@/lib/server/public-cache";

export const revalidate = 900;

export default async function Home() {
  const snapshot = await getLandingSnapshot();
  observeCacheEnvelope(snapshot);
  return <HomePageClient snapshot={snapshot.data} />;
}
