import { db } from "@/db";
import { devicePairings } from "@/db/schema";
import { PAIRING_CODE_TTL_MS, generatePairingCode } from "@/lib/monitor";
import { lt } from "drizzle-orm";
import { NextResponse } from "next/server";

// The dashboard calls this to create a short-lived code a new device enters to pair.
export async function POST() {
  await db.delete(devicePairings).where(lt(devicePairings.expiresAt, new Date()));

  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  let code = generatePairingCode();

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.insert(devicePairings).values({ code, expiresAt });
      return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { status: 201 });
    } catch {
      code = generatePairingCode();
    }
  }

  return NextResponse.json({ error: "Could not create a pairing code, try again." }, { status: 500 });
}
