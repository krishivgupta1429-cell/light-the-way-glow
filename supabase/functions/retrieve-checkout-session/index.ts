import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

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

// Helper logging function
const logStep = (step: string, details?: Record<string, unknown>) => {
  const sanitized: Record<string, unknown> = {};
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      if (typeof value === "string" && (key.includes("Id") || key.includes("email") || key.includes("session"))) {
        sanitized[key] = sanitizeForLog(value, 8);
      } else {
        sanitized[key] = value;
      }
    }
  }
  console.log(`[retrieve-session] ${step}`, sanitized);
};

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();

    logStep("Retrieving session", { sessionId: session_id });

    if (!session_id) {
      logStep("Missing session_id");
      return new Response(
        JSON.stringify({ error: "Missing session_id parameter" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      logStep("Configuration error");
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Initialize Stripe with live key
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id);

    logStep("Success", {
      payment_status: session.payment_status,
      status: session.status,
    });

    return new Response(
      JSON.stringify({
        payment_status: session.payment_status,
        status: session.status,
        amount_total: session.amount_total,
        currency: session.currency,
        customer_email: session.customer_email,
        livemode: session.livemode,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    logStep("Retrieval failed");
    return new Response(
      JSON.stringify({ error: "Failed to retrieve session" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
