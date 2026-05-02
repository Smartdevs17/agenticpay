import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { warmPublicCaches } from "@/lib/server/public-cache";

interface RevalidationPayload {
  paths?: string[];
  tags?: string[];
  warm?: boolean;
  source?: string;
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CACHE_REVALIDATE_SECRET;
  if (!secret) return true;

  const bearer = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return bearer === `Bearer ${secret}` || querySecret === secret;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as RevalidationPayload;
  const paths = payload.paths ?? [];
  const tags = payload.tags ?? [];

  for (const path of paths) {
    revalidatePath(path);
  }

  for (const tag of tags) {
    revalidateTag(tag, "max");
  }

  if (payload.warm) {
    await warmPublicCaches();
  }

  return NextResponse.json({
    revalidated: true,
    source: payload.source ?? "webhook",
    paths,
    tags,
    warmed: Boolean(payload.warm),
    revalidatedAt: new Date().toISOString(),
  });
}
