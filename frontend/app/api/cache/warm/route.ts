import { NextRequest, NextResponse } from "next/server";
import { withSingleFlight } from "@/lib/cache/single-flight";
import { warmPublicCaches } from "@/lib/server/public-cache";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CACHE_REVALIDATE_SECRET;
  if (!secret) return true;

  const bearer = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return bearer === `Bearer ${secret}` || querySecret === secret;
}

async function warm() {
  const [landing, accessibility, publicOverview] = await warmPublicCaches();

  return {
    warmedAt: new Date().toISOString(),
    resources: [landing.cacheKey, accessibility.cacheKey, publicOverview.cacheKey],
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await withSingleFlight("cache-warmup", warm);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  return GET(request);
}

