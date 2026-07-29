import { NextResponse } from "next/server";
import {
  inspectApplicationReadiness,
  isInfrastructureReady,
} from "@/src/server/readiness";
import { errorStatus, toPublicError } from "@/src/server/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const readiness = await inspectApplicationReadiness();
    return NextResponse.json(readiness, {
      status: isInfrastructureReady(readiness) ? 200 : 503,
    });
  } catch (error) {
    return NextResponse.json({ error: toPublicError(error) }, { status: errorStatus(error) });
  }
}
