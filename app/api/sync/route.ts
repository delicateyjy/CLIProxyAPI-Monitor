import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { config, assertEnv } from "@/lib/config";
import { db } from "@/lib/db/client";
import { usageRecords } from "@/lib/db/schema";
import { parseUsagePayload, toUsageRecords } from "@/lib/usage";

export const runtime = "nodejs";

const PASSWORD = process.env.PASSWORD || process.env.CLIPROXY_SECRET_KEY || "";
const COOKIE_NAME = "dashboard_auth";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function missingPassword() {
  return NextResponse.json({ error: "PASSWORD is missing" }, { status: 501 });
}

async function hashPassword(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAuthorized(request: Request) {
  // 检查 Bearer token（用于 cron job 等外部调用）
  const allowed = [config.password, config.cronSecret].filter(Boolean).map((v) => `Bearer ${v}`);
  if (allowed.length > 0) {
    const auth = request.headers.get("authorization") || "";
    if (allowed.includes(auth)) return true;
  }
  
  // 检查用户的 dashboard cookie（用于前端调用）
  if (PASSWORD) {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(COOKIE_NAME);
    if (authCookie) {
      const expectedToken = await hashPassword(PASSWORD);
      if (authCookie.value === expectedToken) return true;
    }
  }
  
  return false;
}

async function performSync(request: Request) {
  if (!config.password && !config.cronSecret && !PASSWORD) return missingPassword();
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    assertEnv();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 501 });
  }

  const usageUrl = `${config.cliproxy.baseUrl.replace(/\/$/, "")}/usage`;
  const pulledAt = new Date();

  const response = await fetch(usageUrl, {
    headers: {
      Authorization: `Bearer ${config.cliproxy.apiKey}`,
      "Content-Type": "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Failed to fetch usage", statusText: response.statusText },
      { status: response.status }
    );
  }

  let payload;
  try {
    const json = await response.json();
    payload = parseUsagePayload(json);
  } catch (parseError) {
    return NextResponse.json(
      { error: "Failed to parse usage response", detail: (parseError as Error).message },
      { status: 502 }
    );
  }

  const rows = toUsageRecords(payload, pulledAt);

  if (rows.length === 0) {
    return NextResponse.json({ status: "ok", inserted: 0, message: "No usage data" });
  }

  let result;
  try {
    result = await db
      .insert(usageRecords)
      .values(rows)
      .onConflictDoNothing({ target: [usageRecords.occurredAt, usageRecords.route, usageRecords.model] });
  } catch (dbError) {
    return NextResponse.json(
      { error: "Database insert failed", detail: (dbError as Error).message },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: "ok", inserted: rows.length, db: result });
}

export async function POST(request: Request) {
  return performSync(request);
}

export async function GET(request: Request) {
  return performSync(request);
}
