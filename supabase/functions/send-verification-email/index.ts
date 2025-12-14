import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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

interface VerificationEmailRequest {
  email: string;
  name: string;
  token: string;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name, token }: VerificationEmailRequest = await req.json();

    if (!email || !name || !token) {
      throw new Error("Missing required fields: email, name, or token");
    }

    const verificationUrl = `${origin || "https://menorah.jewishtc.org"}/verify-email?token=${token}`;

    // Log with sanitized data - no sensitive tokens or full emails
    console.log("[send-verification-email] Request received", {
      email: sanitizeForLog(email),
      name: name.split(" ")[0], // Only first name
      hasToken: !!token,
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Verification email processed",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-verification-email] Error:", sanitizeForLog(errorMessage, 20));
    return new Response(
      JSON.stringify({ 
        success: false,
        error: "Request processing failed"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
