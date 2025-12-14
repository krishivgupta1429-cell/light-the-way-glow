import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
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

// Helper logging function with sanitization
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
  console.log(`[checkout] ${step}`, sanitized);
};

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting checkout session creation");

    // Verify Stripe key is available
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      logStep("Configuration error");
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { formSubmissionId, amount, email, fullName } = await req.json();

    logStep("Request received", { formSubmissionId, amount, hasEmail: !!email });

    if (!formSubmissionId || !amount || !email) {
      logStep("Missing parameters");
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validate amount is positive
    if (amount <= 0) {
      logStep("Invalid amount", { amount });
      return new Response(
        JSON.stringify({ error: "Invalid amount" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Initialize Stripe with live key
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Convert amount to cents
    const amountInCents = Math.round(amount * 100);

    logStep("Creating session", { amountInCents });

    // Create Stripe checkout session in LIVE mode
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountInCents,
            product_data: {
              name: "Light the Way Glow Sponsorship",
              description: "Sponsorship and donations for Light the Way Glow event",
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin || "https://menorah.jewishtc.org"}/payment-result?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin || "https://menorah.jewishtc.org"}/payment-result?session_id={CHECKOUT_SESSION_ID}&canceled=1`,
      customer_email: email,
      metadata: {
        form_submission_id: formSubmissionId,
        full_name: fullName,
      },
    });

    logStep("Session created", { hasUrl: !!session.url });

    // Immediately update form_submissions with the checkout session ID
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { error: updateError } = await supabaseAdmin
      .from("form_submissions")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_customer_id: session.customer as string || null,
        payment_status: "pending",
      })
      .eq("id", formSubmissionId);

    if (updateError) {
      logStep("Update failed");
      return new Response(
        JSON.stringify({ error: "Failed to process checkout" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Success");

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    logStep("Checkout failed");
    return new Response(
      JSON.stringify({ error: "Checkout session creation failed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
