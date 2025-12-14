import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
      if (typeof value === "string" && (key.includes("Id") || key.includes("email") || key.includes("session") || key.includes("intent"))) {
        sanitized[key] = sanitizeForLog(value, 8);
      } else {
        sanitized[key] = value;
      }
    }
  }
  console.log(`[stripe-webhook] ${step}`, sanitized);
};

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    logStep("No signature provided");
    return new Response(JSON.stringify({ error: "No signature" }), {
      status: 400,
    });
  }

  try {
    // Verify environment variables are set
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    
    if (!stripeKey || !webhookSecret) {
      logStep("Configuration error");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
      });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    const body = await req.text();
    
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      logStep("Signature verified", { eventType: event.type });
    } catch (err) {
      logStep("Signature verification failed");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
      });
    }

    logStep("Event received", { type: event.type, livemode: event.livemode });

    // Verify this is a live mode event
    if (!event.livemode) {
      logStep("Warning: test mode event received");
    }

    // Initialize Supabase client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      logStep("Checkout completed", { 
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
      });

      const formSubmissionId = session.metadata?.form_submission_id;
      
      if (!formSubmissionId) {
        logStep("No form_submission_id in metadata");
        return new Response(JSON.stringify({ error: "No form_submission_id" }), {
          status: 400,
        });
      }

      // Get payment intent to extract charge details
      let paymentIntentId = null;
      if (session.payment_intent) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            session.payment_intent as string
          );
          paymentIntentId = paymentIntent.id;
          logStep("Payment intent retrieved", { status: paymentIntent.status });
        } catch (err) {
          logStep("Payment intent retrieval failed");
        }
      }

      const amountInCents = session.amount_total || 0;

      // Determine payment status
      let paymentStatus = "pending";
      if (session.payment_status === "paid") {
        paymentStatus = "success";
      } else if (session.payment_status === "unpaid") {
        paymentStatus = "failed";
      }

      logStep("Updating submission", { paymentStatus, amountInCents });

      // Update form submission with payment success and Stripe details
      const { error: updateError } = await supabaseAdmin
        .from("form_submissions")
        .update({
          is_donor: true,
          payment_status: paymentStatus,
          stripe_customer_id: session.customer as string || null,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          payment_amount_cents: amountInCents,
        })
        .eq("id", formSubmissionId);

      if (updateError) {
        logStep("Update failed");
        throw updateError;
      }

      logStep("Submission updated", { status: paymentStatus });
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      
      logStep("Payment intent succeeded", { amount: paymentIntent.amount });

      // Find the form submission by payment intent ID
      const { data: submission, error: findError } = await supabaseAdmin
        .from("form_submissions")
        .select("id, payment_status")
        .eq("stripe_payment_intent_id", paymentIntent.id)
        .maybeSingle();

      if (findError) {
        logStep("Find submission failed");
      } else if (submission) {
        logStep("Found submission", { currentStatus: submission.payment_status });

        const { error: updateError } = await supabaseAdmin
          .from("form_submissions")
          .update({
            payment_status: "success",
            payment_amount_cents: paymentIntent.amount,
            is_donor: true,
          })
          .eq("id", submission.id);

        if (updateError) {
          logStep("Update failed");
        } else {
          logStep("Payment status updated to success");
        }
      } else {
        logStep("No submission found for payment intent");
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      
      logStep("Payment intent failed");

      // Find the form submission by payment intent ID
      const { data: submission, error: findError } = await supabaseAdmin
        .from("form_submissions")
        .select("id, payment_status")
        .eq("stripe_payment_intent_id", paymentIntent.id)
        .maybeSingle();

      if (findError) {
        logStep("Find submission failed");
      } else if (submission) {
        logStep("Found submission for failed payment");

        const { error: updateError } = await supabaseAdmin
          .from("form_submissions")
          .update({
            payment_status: "failed",
          })
          .eq("id", submission.id);

        if (updateError) {
          logStep("Update failed");
        } else {
          logStep("Payment status updated to failed");
        }
      } else {
        logStep("No submission found for failed payment intent");
      }
    }

    logStep("Webhook processed", { eventType: event.type });

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
    });
  } catch (error) {
    logStep("Webhook processing failed");
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      {
        status: 400,
      }
    );
  }
});
