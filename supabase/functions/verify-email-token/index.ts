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

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[verify-email-token] Verification attempt", { 
      tokenPrefix: sanitizeForLog(token, 8) 
    });

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the submission with this token
    const { data: submission, error: findError } = await supabase
      .from("form_submissions")
      .select("id, email, verification_sent_at")
      .eq("verification_token", token)
      .single();

    if (findError || !submission) {
      console.log("[verify-email-token] Token not found or invalid");
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Invalid or expired verification token" 
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if token already used (verification_token will be null)
    const { data: currentSubmission } = await supabase
      .from("form_submissions")
      .select("verification_token")
      .eq("id", submission.id)
      .single();

    if (!currentSubmission?.verification_token) {
      console.log("[verify-email-token] Already verified");
      return new Response(
        JSON.stringify({ 
          success: true,
          alreadyVerified: true,
          message: "Email already verified"
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200
        }
      );
    }

    // Check if token is expired (24 hours)
    const sentAt = new Date(submission.verification_sent_at);
    const now = new Date();
    const hoursSinceSent = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceSent > 24) {
      console.log("[verify-email-token] Token expired");
      return new Response(
        JSON.stringify({ 
          success: false,
          expired: true,
          error: "Verification token has expired. Please request a new one." 
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update the submission to mark as verified by clearing the token
    const { error: updateError } = await supabase
      .from("form_submissions")
      .update({
        verification_token: null, // Clear the token to mark as verified
      })
      .eq("id", submission.id);

    if (updateError) {
      console.error("[verify-email-token] Update failed");
      return new Response(
        JSON.stringify({ success: false, error: "Verification failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[verify-email-token] Success", { 
      email: sanitizeForLog(submission.email) 
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Email verified successfully" 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("[verify-email-token] Unexpected error");
    return new Response(
      JSON.stringify({ 
        success: false,
        error: "Verification failed"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
