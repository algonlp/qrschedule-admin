import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/http";
import twilio from "twilio";

// E.164-ish: leading +, 8-15 digits.
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const MAX_MESSAGE_LENGTH = 1600;

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const message = typeof body?.message === "string" ? body.message : "";

    if (!PHONE_RE.test(to)) {
      return NextResponse.json({ error: "Enter a valid phone number in +<country><number> format." }, { status: 400 });
    }
    if (!message.trim()) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return NextResponse.json({ error: "SMS sending is not configured." }, { status: 503 });
    }

    const client = twilio(accountSid, authToken);
    const result = await client.messages.create({ body: message, from: fromNumber, to });

    await writeAuditLog({
      actor: auth.email,
      action: "sms.sent",
      entityType: "sms",
      entityId: result.sid,
      summary: `Sent SMS to ${to} (${message.length} chars)`,
      after: { to, sid: result.sid, length: message.length },
    });

    return NextResponse.json({ success: true, sid: result.sid });
  } catch (error) {
    return safeErrorResponse("sms", error);
  }
}
