import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Allowed origins for CORS
const allowedOrigins = [
  "https://menorah.jewishtc.org",
  "https://light-the-way-glow.lovable.app"
];

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

// Sanitize sensitive data for logging
function sanitizeForLog(value: string | null | undefined, showChars: number = 4): string {
  if (!value) return "[empty]";
  if (value.length <= showChars * 2) return "[redacted]";
  return `${value.substring(0, showChars)}...${value.substring(value.length - showChars)}`;
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

async function checkRateLimit(supabaseUrl: string, serviceKey: string, identifier: string, endpoint: string): Promise<boolean> {
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
    
    // Count recent requests using raw query approach
    const { data: recentRequests, error: countError } = await supabase
      .from("rate_limits")
      .select("request_count")
      .eq("identifier", identifier)
      .eq("endpoint", endpoint)
      .gte("window_start", windowStart);
    
    if (countError) {
      console.error("[rate-limit] Error checking rate limit");
      return true; // Allow on error to not block legitimate users
    }
    
    // Cast to any to handle dynamic table type
    const requests = recentRequests as Array<{ request_count: number }> | null;
    const totalRequests = requests?.reduce((sum, r) => sum + (r.request_count || 1), 0) || 0;
    
    if (totalRequests >= RATE_LIMIT_MAX_REQUESTS) {
      console.log("[rate-limit] Rate limit exceeded", { identifier: sanitizeForLog(identifier), endpoint });
      return false;
    }
    
    // Record this request
    await supabase.from("rate_limits").insert({
      identifier,
      endpoint,
      request_count: 1,
      window_start: new Date().toISOString(),
    } as Record<string, unknown>);
    
    return true;
  } catch (err) {
    console.error("[rate-limit] Unexpected error");
    return true; // Allow on error
  }
}

interface SubmitEntryBody {
  full_name: string;
  email: string;
  area_code?: string | null;
  phone_number?: string | null;
  full_phone?: string | null;
  number_of_adults: number;
  number_of_children?: number;
  reason: string;
  reason_other?: string | null;
  sponsorships: string[];
  cans_quantity: number;
  comments?: string | null;
  email_updates_opt_in?: boolean;
  wants_to_donate?: boolean;
  verification_token: string;
  verification_sent_at: string;
}

async function sendRegistrationEmail(fullName: string, email: string): Promise<void> {
  try {
    const apiKey = Deno.env.get("BREVO_API_KEY");
    if (!apiKey) {
      throw new Error("Missing BREVO_API_KEY");
    }

    const htmlContent = `Hi ${fullName},<br/><br/>
      Thank you so much for signing up for Menorah in the Square—we can't wait to celebrate with you!<br/><br/>
      📍 <strong>Location:</strong> Rotary Square<br/>
      203 S Union St, Traverse City, MI 49684<br/>
      🕔 <strong>Event Start Time:</strong> 5:00 PM<br/>
      📅 <strong>Date:</strong> December 21st<br/><br/>
      Your participation helps bring warmth and light to our whole community.<br/><br/>
      To help spread the light even further, would you consider forwarding the event sign-up to five friends?<br/><br/>
      Here's the link: <a href="https://menorah.jewishtc.org/">https://menorah.jewishtc.org/</a><br/><br/>
      If you have any questions at all, feel free to reach out anytime.<br/>
      Looking forward to celebrating together!<br/><br/>
      Warmly,<br/>
      Rabbi Laibel & Chaya Shemtov<br/>
      Chabad Jewish Center of Traverse City<br/>
      <a href="https://JewishTC.org">JewishTC.org</a><br/><br/>
      <strong>P.S.</strong> Congratulations on being among the first 100 sign-ups!<br/>
      Please show this email when you arrive to receive your free beanie.<br/>
      Be sure to show it before 5:05 PM—after that time, we'll begin giving them out to everyone.<br/><br/>
      <strong>P.S.s</strong><br/>
      View the lamplighter wall:<br/>
      <a href="https://www.jewishtc.org/templates/articlecco_cdo/aid/7109138/jewish/Untitled.htm">https://www.jewishtc.org/templates/articlecco_cdo/aid/7109138/jewish/Untitled.htm</a>`;

    const payload = {
      sender: { name: "Rabbi Laibel Shemtov", email: "rabbi@jewishtc.org" },
      to: [{ email, name: fullName }],
      bcc: [{ email: "laibelswb@gmail.com", name: "Rabbi Laibel" }],
      subject: "You're Registered for Menorah in the Square!",
      htmlContent,
    };

    console.log("[email] Sending registration email", { email: sanitizeForLog(email) });

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Email API error: ${response.status}`);
    }
    
    console.log("[email] Sent successfully");
  } catch (error) {
    console.error("[email] Send failed");
    // Don't throw - we don't want email failures to block form submission
  }
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = (await req.json()) as Partial<SubmitEntryBody>;

    // Rate limiting by email
    if (body.email) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const withinLimit = await checkRateLimit(supabaseUrl, serviceKey, body.email.toLowerCase(), "submit-form-entry");
      if (!withinLimit) {
        return new Response(
          JSON.stringify({ error: "Too many requests. Please try again later." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
        );
      }
    }

    // Minimal validation of required fields
    if (!body.full_name || !body.email || !body.reason || !body.verification_token || !body.verification_sent_at || body.number_of_adults === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log("[submit-form-entry] Processing submission", {
      email: sanitizeForLog(body.email),
      wantsToDonate: body.wants_to_donate,
    });

    // Compute full_phone if not provided but parts are
    let full_phone = body.full_phone ?? null;
    if (!full_phone && body.area_code && body.phone_number) {
      full_phone = `${body.area_code}${body.phone_number}`;
    }

    // Prepare insert payload
    const insertPayload = {
      full_name: body.full_name.trim(),
      email: body.email.trim().toLowerCase(),
      area_code: body.area_code?.trim() ?? null,
      phone_number: body.phone_number?.trim() ?? null,
      full_phone,
      number_of_adults: body.number_of_adults,
      number_of_children: body.number_of_children ?? 0,
      reason: body.reason,
      reason_other: body.reason_other?.trim() ?? null,
      sponsorships: body.sponsorships ?? [],
      cans_quantity: body.cans_quantity ?? 0,
      comments: body.comments?.trim() ?? null,
      email_updates_opt_in: body.email_updates_opt_in ?? false,
      wants_to_donate: body.wants_to_donate ?? false,
      verification_token: body.verification_token,
      verification_sent_at: body.verification_sent_at,
      payment_status: body.wants_to_donate ? "pending" : "none",
    };

    const { data, error } = await supabaseAdmin
      .from("form_submissions")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("[submit-form-entry] Insert failed");
      return new Response(
        JSON.stringify({ error: "Submission failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log("[submit-form-entry] Success", { id: sanitizeForLog(data.id) });

    // Send registration confirmation email only for NON-donors
    // Donors will receive their combined email after payment success
    if (!body.wants_to_donate) {
      sendRegistrationEmail(body.full_name, body.email).catch(() => {
        console.error("[submit-form-entry] Email send failed but continuing");
      });
    }

    return new Response(JSON.stringify({ id: data.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[submit-form-entry] Unexpected error");
    return new Response(
      JSON.stringify({ error: "Submission failed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
