import { NextResponse } from "next/server";
import { getCacheAnalyticsSnapshot } from "@/lib/cache/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getCacheAnalyticsSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

