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
  console.log(`[verify-payment] ${step}`, sanitized);
};

// Send combined confirmation + donation receipt email via Brevo API
async function sendDonorConfirmationEmail(
  fullName: string,
  email: string,
  donationData: {
    amountCents: number;
    cansQuantity: number;
    sponsorships: string[];
    donationDate: string;
    transactionId: string;
  }
): Promise<void> {
  try {
    const apiKey = Deno.env.get("BREVO_API_KEY");
    if (!apiKey) {
      throw new Error("Missing BREVO_API_KEY");
    }

    // Format amount from cents to dollars
    const amountDollars = donationData.amountCents / 100;
    const formattedAmount = Number.isInteger(amountDollars)
      ? `$${amountDollars}`
      : `$${amountDollars.toFixed(2)}`;

    // Format donation date
    const date = new Date(donationData.donationDate);
    const formattedDate = date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // Build conditional donation details bullets
    const bullets: string[] = [];
    
    // Total donation amount with optional sponsorships
    if (donationData.sponsorships && donationData.sponsorships.length > 0) {
      const sponsorshipText = donationData.sponsorships.join(", ");
      bullets.push(`• Total Donation amount: ${formattedAmount} — ${sponsorshipText}`);
    } else {
      bullets.push(`• Total Donation amount: ${formattedAmount}`);
    }
    
    // Cans line (only if cans > 0)
    if (donationData.cansQuantity > 0) {
      bullets.push(`• ${donationData.cansQuantity} cans sponsored`);
    }
    
    // Date and transaction reference
    bullets.push(`• ${formattedDate}`);
    bullets.push(`• Ref: ${sanitizeForLog(donationData.transactionId, 8)}`);

    const htmlContent = `Dear ${fullName},<br/><br/>
      Thank you for signing up for Menorah in the Square. We're delighted that you'll be joining us as our community gathers to celebrate the light and joy of Chanukah together.<br/><br/>
      <strong>Event Information</strong><br/><br/>
      📍 Rotary Square<br/>
      203 S Union St, Traverse City, MI 49684<br/><br/>
      🕔 Event Start: 5:00 PM<br/>
      📅 Date: December 21st<br/><br/>
      This annual celebration has become a cherished moment of unity in our city—filled with warmth, music, doughnuts, and the glow of the menorah. We look forward to sharing this uplifting evening with you.<br/><br/>
      To help spread the light even further, we warmly invite you to share the sign-up link with five friends:<br/>
      👉 <a href="https://menorah.jewishtc.org/">https://menorah.jewishtc.org/</a><br/><br/>
      If you prefer to remain anonymous on the Lamplighter Donor Wall, simply reply to this email and let us know—we're happy to list your gift anonymously.<br/><br/>
      ⸻<br/><br/>
      <strong>Donation Acknowledgment</strong><br/><br/>
      We are also truly grateful for your generous support of Menorah in the Square. Your contribution helps build our Menorah of Cans and brings light and compassion to those in need throughout Traverse City.<br/><br/>
      <strong>Donation Details</strong><br/>
      ${bullets.join("<br/>")}<br/><br/>
      Your partnership makes a heartfelt difference. Thank you for helping illuminate our community with kindness.<br/><br/>
      <strong>P.S.</strong><br/>
      View the Lamplighter Wall:<br/>
      <a href="https://www.jewishtc.org/templates/articlecco_cdo/aid/7109138/jewish/Untitled.htm">https://www.jewishtc.org/templates/articlecco_cdo/aid/7109138/jewish/Untitled.htm</a>`;

    const payload = {
      sender: { name: "Rabbi Laibel Shemtov", email: "rabbi@jewishtc.org" },
      to: [{ email, name: fullName }],
      bcc: [{ email: "laibelswb@gmail.com", name: "Rabbi Laibel" }],
      subject: "Welcome to Menorah in the Square ✨",
      htmlContent,
    };

    logStep("Sending donor email", { email: sanitizeForLog(email) });

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
    
    logStep("Donor email sent successfully");
  } catch (error) {
    logStep("Donor email failed");
    // Don't throw - we don't want email failures to block payment verification
  }
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();

    logStep("Starting verification", { sessionId: session_id });

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

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);
    logStep("Session retrieved", {
      payment_status: session.payment_status,
      status: session.status,
    });

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find the form submission by checkout session ID
    const { data: submission, error: findError } = await supabaseAdmin
      .from("form_submissions")
      .select("id, wants_to_donate, payment_status, full_name, email, cans_quantity, sponsorships, created_at")
      .eq("stripe_checkout_session_id", session_id)
      .maybeSingle();

    if (findError) {
      logStep("Find submission failed");
      return new Response(
        JSON.stringify({ error: "Verification failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!submission) {
      logStep("Submission not found");
      return new Response(
        JSON.stringify({ error: "Form submission not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    logStep("Found submission", { 
      wantsToDonate: submission.wants_to_donate,
      currentStatus: submission.payment_status
    });

    // Only update if wants_to_donate is true
    if (!submission.wants_to_donate) {
      logStep("No donation requested");
      return new Response(
        JSON.stringify({
          payment_status: "none",
          message: "No donation requested",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Get payment intent details if available
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

    // Determine payment status
    let paymentStatus = "pending";
    if (session.payment_status === "paid") {
      paymentStatus = "success";
    } else if (session.payment_status === "unpaid") {
      paymentStatus = "failed";
    }

    const amountInCents = session.amount_total || 0;

    logStep("Updating submission", { paymentStatus, amountInCents });

    // Update the form submission
    const { error: updateError } = await supabaseAdmin
      .from("form_submissions")
      .update({
        is_donor: paymentStatus === "success",
        stripe_customer_id: session.customer as string || null,
        stripe_payment_intent_id: paymentIntentId,
        payment_amount_cents: amountInCents,
        payment_status: paymentStatus,
      })
      .eq("id", submission.id);

    if (updateError) {
      logStep("Update failed");
      return new Response(
        JSON.stringify({ error: "Verification failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Success", { paymentStatus });

    // Send combined confirmation + donation receipt email if payment was successful
    if (paymentStatus === "success") {
      logStep("Sending donor confirmation email");
      
      sendDonorConfirmationEmail(
        submission.full_name,
        submission.email,
        {
          amountCents: amountInCents,
          cansQuantity: submission.cans_quantity || 0,
          sponsorships: submission.sponsorships || [],
          donationDate: submission.created_at,
          transactionId: paymentIntentId || session_id,
        }
      ).catch(() => {
        logStep("Donor email failed but continuing");
      });
    }

    return new Response(
      JSON.stringify({
        payment_status: paymentStatus,
        amount_total: session.amount_total,
        currency: session.currency,
        customer_email: session.customer_email,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    logStep("Verification failed");
    return new Response(
      JSON.stringify({ error: "Payment verification failed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
