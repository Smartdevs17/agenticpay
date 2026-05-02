import { NextResponse } from "next/server";
import { createCacheHeaders } from "@/lib/cache/headers";
import { getPublicOverviewSnapshot } from "@/lib/server/public-cache";

export const revalidate = 600;

export async function GET() {
  const snapshot = await getPublicOverviewSnapshot();

  return NextResponse.json(snapshot.data, {
    headers: createCacheHeaders(snapshot),
  });
}
