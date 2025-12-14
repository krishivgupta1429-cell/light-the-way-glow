import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { submitEntry } from "@/lib/submitEntry";
import { validateEmail } from "@/lib/emailValidation";
import { supabase } from "@/integrations/supabase/client";

const RaffleForm = () => {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    areaCode: "+1",
    phoneNumber: "",
    numberOfAdults: "",
    numberOfChildren: "",
    reason: "",
    otherReason: "",
    sponsorships: [] as string[],
    cansQuantity: "",
    comments: "",
    emailUpdatesOptIn: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string>("");
  const [areaCodeError, setAreaCodeError] = useState<string>("");
  const [phoneNumberError, setPhoneNumberError] = useState<string>("");

  // Phone format mapping for different countries
  const phoneFormats: Record<string, { placeholder: string; digits: number }> = {
    '+1': { placeholder: '(123) 456-7890', digits: 10 },    // US/Canada
    '+44': { placeholder: '7123 456789', digits: 10 },    // UK
    '+91': { placeholder: '98765 43210', digits: 10 },    // India
    '+61': { placeholder: '412 345 678', digits: 9 },     // Australia
  };

  // Get current format based on area code
  const currentFormat = phoneFormats[formData.areaCode] || { placeholder: 'Phone number', digits: 15 };

  // Can options with quantities and amounts
  const canOptions = [
    { quantity: 0, label: "0 CANS – $0", amount: 0 },
    { quantity: 1, label: "1 CAN – $4", amount: 4 },
    { quantity: 2, label: "2 CAN – $8", amount: 8 },
    { quantity: 4, label: "4 CANS – $16", amount: 16 },
    { quantity: 6, label: "6 CANS – $24", amount: 24 },
    { quantity: 8, label: "8 CANS – $32", amount: 32 },
    { quantity: 10, label: "10 CANS – $40", amount: 40 },
    { quantity: 15, label: "15 CANS – $60", amount: 60 },
    { quantity: 20, label: "20 CANS – $80", amount: 80 },
    { quantity: 30, label: "30 CANS – $120", amount: 120 },
    { quantity: 40, label: "40 CANS – $160", amount: 160 },
    { quantity: 50, label: "50 CANS – $200", amount: 200 },
    { quantity: 100, label: "100 CANS – $400", amount: 400 },
  ];

  // Get selected can option details
  const selectedCanOption = canOptions.find(
    (option) => option.label === formData.cansQuantity
  );
  const cansQuantity = selectedCanOption?.quantity || 0;
  const cansAmountUsd = selectedCanOption?.amount || 0;

  // Sponsorship options with amounts
  const sponsorshipOptions = [
    { id: "doughnut", label: "DOUGHNUT SPONSOR", amount: 36 },
    { id: "doughnut-gold", label: "DOUGHNUT GOLD SPONSOR", amount: 72 },
    { id: "doughnut-platinum", label: "DOUGHNUT PLATINUM SPONSOR", amount: 108 },
    { id: "menorah", label: "MENORAH SPONSOR", amount: 180 },
    { id: "menorah-gold", label: "MENORAH GOLD SPONSOR", amount: 360 },
    { id: "menorah-platinum", label: "MENORAH PLATINUM SPONSOR", amount: 540 },
  ];

  // Calculate total sponsorship amount
  const sponsorshipTotal = formData.sponsorships.reduce((total, sponsorshipId) => {
    const option = sponsorshipOptions.find((opt) => opt.id === sponsorshipId);
    return total + (option?.amount || 0);
  }, 0);

  // Handle sponsorship checkbox change
  const handleSponsorshipChange = (sponsorshipId: string, checked: boolean) => {
    if (checked) {
      setFormData({
        ...formData,
        sponsorships: [...formData.sponsorships, sponsorshipId],
      });
    } else {
      const newSponsorships = formData.sponsorships.filter((id) => id !== sponsorshipId);
      setFormData({
        ...formData,
        sponsorships: newSponsorships,
      });
    }
  };

  // Handle email validation
  const handleEmailChange = (email: string) => {
    setFormData({ ...formData, email });
    
    if (email.trim()) {
      const validation = validateEmail(email);
      if (!validation.valid) {
        setEmailError(validation.error || "");
      } else {
        setEmailError("");
      }
    } else {
      setEmailError("");
    }
  };

  // Handle area code validation
  const handleAreaCodeChange = (value: string) => {
    // Only allow + at the beginning and digits, max 4 characters
    const cleaned = value.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+') || cleaned === '') {
      const areaCode = cleaned.slice(0, 4);
      setFormData({ ...formData, areaCode });
      
      if (areaCode && areaCode.length < 2) {
        setAreaCodeError("Area code must be at least 2 characters");
      } else if (areaCode && !areaCode.startsWith('+')) {
        setAreaCodeError("Area code must start with +");
      } else {
        setAreaCodeError("");
      }
      
      // Clear phone number error when area code changes (format may have changed)
      if (phoneNumberError) {
        setPhoneNumberError("");
      }
    }
  };

  // Handle phone number validation with US formatting
  const handlePhoneNumberChange = (value: string) => {
    // Strip all non-digit characters
    const digitsOnly = value.replace(/\D/g, '');
    
    // For US/Canada (+1), limit to exactly 10 digits and format as (XXX) XXX-XXXX
    if (formData.areaCode === '+1') {
      // Limit to 10 digits max
      const limited = digitsOnly.slice(0, 10);
      
      let formatted = limited;
      const len = limited.length;
      
      if (len <= 2) {
        // 1-2 digits: show as-is (e.g., "4", "43")
        formatted = limited;
      } else if (len === 3) {
        // 3 digits: add parentheses (e.g., "(434)")
        formatted = `(${limited})`;
      } else if (len <= 6) {
        // 4-6 digits: (XXX) X... (e.g., "(434) 3", "(434) 334")
        formatted = `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
      } else {
        // 7-10 digits: (XXX) XXX-X... (e.g., "(434) 334-3", "(434) 334-3456")
        formatted = `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
      }
      
      setFormData({ ...formData, phoneNumber: formatted });
      setPhoneNumberError("");
    } else {
      // For other countries, enforce max length based on current format
      if (digitsOnly.length <= currentFormat.digits) {
        setFormData({ ...formData, phoneNumber: digitsOnly });
        setPhoneNumberError("");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!formData.fullName.trim()) {
      toast.error("Please enter your full name");
      return;
    }

    if (!formData.email.trim()) {
      toast.error("Please enter your email address");
      return;
    }

    // Email validation
    const emailValidation = validateEmail(formData.email);
    if (!emailValidation.valid) {
      setEmailError(emailValidation.error);
      toast.error("Invalid email", {
        description: emailValidation.error,
      });
      return;
    }

    // Phone validation with format-specific rules
    if (formData.phoneNumber) {
      const cleanedNumber = formData.phoneNumber.replace(/\D/g, "");
      
      // Special validation for US numbers
      if (formData.areaCode === '+1') {
        if (cleanedNumber.length !== 10) {
          setPhoneNumberError("Please enter a valid 10-digit US phone number.");
          toast.error("Invalid Phone Number", {
            description: "Please enter a valid 10-digit US phone number.",
          });
          return;
        }
      } else {
        // Validate based on current format for other countries
        if (cleanedNumber.length < 6) {
          setPhoneNumberError("Phone number must be at least 6 digits");
          toast.error("Invalid Phone Number", {
            description: "Phone number must be at least 6 digits",
          });
          return;
        }
        
        if (cleanedNumber.length > currentFormat.digits) {
          setPhoneNumberError(`Phone number must be at most ${currentFormat.digits} digits for ${formData.areaCode}`);
          toast.error("Invalid Phone Number", {
            description: `Phone number must be at most ${currentFormat.digits} digits for ${formData.areaCode}`,
          });
          return;
        }
      }
    }

    // Validate area code if provided
    if (formData.areaCode && !formData.areaCode.startsWith('+')) {
      setAreaCodeError("Area code must start with +");
      toast.error("Invalid Area Code", {
        description: "Area code must start with + (e.g., +1, +44, +91)",
      });
      return;
    }

    // If both area code and phone number are provided together or both empty, that's ok
    // But if only one is provided, show error
    if ((formData.areaCode && !formData.phoneNumber) || (!formData.areaCode && formData.phoneNumber)) {
      if (!formData.phoneNumber) {
        setPhoneNumberError("Please enter a phone number");
        toast.error("Incomplete Phone Number", {
          description: "Please enter both area code and phone number",
        });
      }
      if (!formData.areaCode) {
        setAreaCodeError("Please enter an area code");
        toast.error("Incomplete Phone Number", {
          description: "Please enter both area code and phone number",
        });
      }
      return;
    }

    // Validate number of adults
    if (!formData.numberOfAdults) {
      toast.error("Please select number of adults attending");
      return;
    }

    // Validate otherReason if "other" is selected
    if (formData.reason === "other" && !formData.otherReason.trim()) {
      toast.error("Please tell us why you enjoy this event", {
        description: "The 'Other' option requires a response.",
      });
      return;
    }

    // Set submitting state
    setIsSubmitting(true);

    try {
      // Check if user has sponsorships (wants to donate)
      const hasSponsorships = formData.sponsorships.length > 0 || formData.cansQuantity !== "";
      
      if (hasSponsorships) {
        // STRIPE PAYMENT FLOW
        // First, save form submission to get an ID
        const response = await submitEntry({
          fullName: formData.fullName,
          email: formData.email,
          areaCode: formData.areaCode,
          phoneNumber: formData.phoneNumber,
          numberOfAdults: formData.numberOfAdults,
          numberOfChildren: formData.numberOfChildren,
          enjoyReason: formData.reason,
          otherEnjoyReason: formData.otherReason,
          sponsorships: formData.sponsorships,
          cansQuantity: formData.cansQuantity,
          comments: formData.comments,
          emailUpdatesOptIn: formData.emailUpdatesOptIn,
        });

        if (!response.success || !response.entryId) {
          toast.error("Submission failed", {
            description: response.error || "Please try again.",
          });
          return;
        }

        // Calculate total amount
        const totalAmount = sponsorshipTotal + cansAmountUsd;

        // Create Stripe checkout session
        const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
          "create-checkout-session",
          {
            body: {
              formSubmissionId: response.entryId,
              amount: totalAmount,
              email: formData.email,
              fullName: formData.fullName,
            },
          }
        );

        if (checkoutError || !checkoutData?.url) {
          console.error("Checkout error:", checkoutError);
          toast.error("Payment setup failed", {
            description: "Unable to create payment session. Please try again.",
          });
          return;
        }

        // Redirect to Stripe checkout
        window.location.href = checkoutData.url;
      } else {
        // DIRECT SUBMISSION (NO PAYMENT)
        const response = await submitEntry({
          fullName: formData.fullName,
          email: formData.email,
          areaCode: formData.areaCode,
          phoneNumber: formData.phoneNumber,
          numberOfAdults: formData.numberOfAdults,
          numberOfChildren: formData.numberOfChildren,
          enjoyReason: formData.reason,
          otherEnjoyReason: formData.otherReason,
          sponsorships: formData.sponsorships,
          cansQuantity: formData.cansQuantity,
          comments: formData.comments,
          emailUpdatesOptIn: formData.emailUpdatesOptIn,
        });

        if (response.success) {
          toast.success("Success! ✨", {
            description: "Thank you for being part of our community celebration.",
          });

          // Reset form
          setFormData({
            fullName: "",
            email: "",
            areaCode: "+1",
            phoneNumber: "",
            numberOfAdults: "",
            numberOfChildren: "",
            reason: "",
            otherReason: "",
            sponsorships: [],
            cansQuantity: "",
            comments: "",
            emailUpdatesOptIn: false,
          });
          setEmailError("");
          setAreaCodeError("");
          setPhoneNumberError("");
        } else {
          toast.error("Submission failed", {
            description: response.error || "Please try again.",
          });
        }
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      toast.error("Submission failed", {
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 md:space-y-8 w-full form-mobile">
      <div className="space-y-4 md:space-y-6">
        {/* Full Name */}
        <div className="space-y-2">
          <Label htmlFor="fullName" className="text-foreground font-medium text-base">
            Full Name <span className="text-gold">*</span>
          </Label>
          <Input
            id="fullName"
            placeholder="Enter your full name"
            value={formData.fullName}
            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
            required
            className="bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)]"
          />
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-foreground font-medium text-base">
            Email Address <span className="text-gold">*</span>
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="your.email@example.com"
            value={formData.email}
            onChange={(e) => handleEmailChange(e.target.value)}
            required
            className={`bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)] ${
              emailError ? "border-red-500 focus:border-red-500 focus:ring-red-500/40" : ""
            }`}
          />
          {emailError && (
            <p className="text-sm text-red-500 mt-1">{emailError}</p>
          )}
        </div>

        {/* Phone - Area Code and Number */}
        <div className="space-y-2">
          <Label className="text-foreground font-medium text-base">
            Phone Number <span className="text-gold">*</span>
          </Label>
          <div className="flex flex-row gap-3">
            {/* Area Code */}
            <div className="w-24 flex-shrink-0">
              <Label htmlFor="areaCode" className="text-xs text-foreground/70 mb-1 block">
                Country Code
              </Label>
              <Input
                id="areaCode"
                type="text"
                placeholder="+1"
                value={formData.areaCode}
                onChange={(e) => handleAreaCodeChange(e.target.value)}
                required
                maxLength={4}
                className={`bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)] ${
                  areaCodeError ? "border-red-500 focus:border-red-500 focus:ring-red-500/40" : ""
                }`}
              />
              {areaCodeError && (
                <p className="text-xs text-red-500 mt-1">{areaCodeError}</p>
              )}
            </div>
            {/* Phone Number */}
            <div className="flex-1">
              <Label htmlFor="phoneNumber" className="text-xs text-foreground/70 mb-1 block">
                Number
              </Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder={currentFormat.placeholder}
                value={formData.phoneNumber}
                onChange={(e) => handlePhoneNumberChange(e.target.value)}
                required
                inputMode="numeric"
                className={`bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)] ${
                  phoneNumberError ? "border-red-500 focus:border-red-500 focus:ring-red-500/40" : ""
                }`}
              />
              {phoneNumberError && (
                <p className="text-xs text-red-500 mt-1">{phoneNumberError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Separator */}
        <div className="flex items-center justify-center py-4">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <div className="mx-4 text-2xl animate-candle-flicker">✨</div>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
        </div>

        {/* Attendance Section */}
        <div className="space-y-4">
          <Label className="text-foreground font-medium text-base">
            How many people will be attending?
          </Label>
          
          {/* Number of Adults */}
          <div className="space-y-2">
            <Label htmlFor="numberOfAdults" className="text-foreground font-medium text-sm">
              Number of Adults <span className="text-gold">*</span>
            </Label>
            <Select
              value={formData.numberOfAdults}
              onValueChange={(value) => setFormData({ ...formData, numberOfAdults: value })}
              required
            >
              <SelectTrigger
                id="numberOfAdults"
                className="bg-input/80 backdrop-blur-sm border-border/60 text-foreground focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)]"
              >
                <SelectValue placeholder="Select number of adults" />
              </SelectTrigger>
              <SelectContent className="bg-background/95 backdrop-blur-sm border-border/60 z-50">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Number of Children */}
          <div className="space-y-2">
            <Label htmlFor="numberOfChildren" className="text-foreground font-medium text-sm">
              Number of Children (Optional)
            </Label>
            <Select
              value={formData.numberOfChildren}
              onValueChange={(value) => setFormData({ ...formData, numberOfChildren: value })}
            >
              <SelectTrigger
                id="numberOfChildren"
                className="bg-input/80 backdrop-blur-sm border-border/60 text-foreground focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)]"
              >
                <SelectValue placeholder="Select number of children" />
              </SelectTrigger>
              <SelectContent className="bg-background/95 backdrop-blur-sm border-border/60 z-50">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Separator */}
        <div className="flex items-center justify-center py-4">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <div className="mx-4 text-2xl animate-candle-flicker">✨</div>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
        </div>

        {/* Reason */}
        <div className="space-y-3">
          <Label className="text-foreground font-medium text-base">
            I enjoy events like this because: <span className="text-gold">*</span>
          </Label>
          <RadioGroup
            value={formData.reason}
            onValueChange={(value) => {
              setFormData({ ...formData, reason: value, otherReason: value !== "other" ? "" : formData.otherReason });
            }}
            className="space-y-2"
          >
            <Label htmlFor="cultures" className="flex items-center gap-3 min-h-[44px] group px-2 py-2 rounded-lg hover:bg-gold/5 transition-colors duration-200 cursor-pointer">
              <RadioGroupItem value="cultures" id="cultures" className="border-gold/60 text-gold data-[state=checked]:border-gold focus-visible:ring-gold/40" />
              <span className="text-base font-normal text-foreground/90 group-hover:text-gold transition-colors duration-200 leading-relaxed">
                I enjoy learning about other cultures
              </span>
              </Label>
            <Label htmlFor="jewish" className="flex items-center gap-3 min-h-[44px] group px-2 py-2 rounded-lg hover:bg-gold/5 transition-colors duration-200 cursor-pointer">
              <RadioGroupItem value="jewish" id="jewish" className="border-gold/60 text-gold data-[state=checked]:border-gold focus-visible:ring-gold/40" />
              <span className="text-base font-normal text-foreground/90 group-hover:text-gold transition-colors duration-200 leading-relaxed">
                I'm Jewish
              </span>
              </Label>
            <Label htmlFor="support" className="flex items-center gap-3 min-h-[44px] group px-2 py-2 rounded-lg hover:bg-gold/5 transition-colors duration-200 cursor-pointer">
              <RadioGroupItem value="support" id="support" className="border-gold/60 text-gold data-[state=checked]:border-gold focus-visible:ring-gold/40" />
              <span className="text-base font-normal text-foreground/90 group-hover:text-gold transition-colors duration-200 leading-relaxed">
                I like to show my support for the Jewish Community
              </span>
              </Label>
            <Label htmlFor="other" className="flex items-center gap-3 min-h-[44px] group px-2 py-2 rounded-lg hover:bg-gold/5 transition-colors duration-200 cursor-pointer">
              <RadioGroupItem value="other" id="other" className="border-gold/60 text-gold data-[state=checked]:border-gold focus-visible:ring-gold/40" aria-controls="other-reason-textarea" />
              <span className="text-base font-normal text-foreground/90 group-hover:text-gold transition-colors duration-200 leading-relaxed">
                Other
              </span>
              </Label>
          </RadioGroup>
          {/* Conditional textarea for "Other" option */}
          {formData.reason === "other" && (
            <div className="space-y-2 mt-2 pl-8 animate-fade-in">
              <Textarea
                id="other-reason-textarea"
                placeholder="Tell us why you enjoy this event…"
                value={formData.otherReason}
                onChange={(e) => setFormData({ ...formData, otherReason: e.target.value })}
                required={formData.reason === "other"}
                className="bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)] min-h-[100px] resize-y"
                aria-label="Tell us why you enjoy this event"
              />
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="flex items-center justify-center py-4">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <div className="mx-4 text-2xl animate-candle-flicker">✨</div>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
        </div>

        {/* Support */}
        <div className="space-y-4">
          {/* Intro line */}
          <p className="text-foreground font-medium text-base text-left">
            This free community event is made possible by generous donors like you. Please consider supporting and being part of this beautiful celebration — your contribution will also make you a part of the Lamplighter Wall.
          </p>
          
          {/* Informational card - Help Build a Menorah */}
          <div className="space-y-4 bg-gradient-to-br from-purple-900/20 via-purple-800/15 to-gold/10 p-6 rounded-xl border border-purple-500/30 backdrop-blur-sm relative overflow-hidden mt-4 pt-4 border-t border-gold/20">
            {/* Subtle glow effect with purple accent */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-transparent to-gold/5 pointer-events-none" />
            {/* Header bar effect */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500/50 via-purple-400/40 to-gold/30" />
            <div className="relative z-10 space-y-3">
              {/* Heading */}
              <h3 className="text-base font-semibold text-gold leading-tight flex items-center gap-2">
                <span className="text-lg">🥫</span>
                <span>Help Build a Menorah Out of Cans and Support Those in Need!</span>
              </h3>
              
              {/* Body content */}
              <div className="space-y-2 text-sm text-foreground/80 leading-relaxed">
                <p>
                  This year, we're building a menorah entirely out of canned food, which will later be donated to local homeless shelters. You can participate in this meaningful project in two ways:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 ml-2">
                  <li>Drop off cans at the Chabad JCC.</li>
                  <li>Have us do the shopping for you! And simply select how many cans you'd like to contribute. Each can costs an average of $4.</li>
                </ol>
              </div>
              
              {/* Closing line - smaller, italic */}
              <p className="text-xs text-foreground/70 italic leading-relaxed">
                Each can become a building block of hope, turning our celebration into a beacon of giving.
              </p>
            </div>
          </div>
          
          {/* Can Quantity Selector */}
          <div className="space-y-3 mt-4 pt-4 border-t border-gold/20">
            <div className="relative">
              <Label 
                htmlFor="cansQuantity" 
                className="text-foreground font-bold text-lg md:text-xl block relative pb-2"
              >
                <span className="relative z-10 drop-shadow-[0_0_8px_rgba(255,215,0,0.3)]">How many cans would you like us to shop for you?</span>
                {/* Golden underline/highlight effect */}
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-gold/60 to-transparent opacity-70 animate-pulse" />
                <span className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_6px_rgba(255,215,0,0.4)]" />
              </Label>
            </div>
            <Select
              value={formData.cansQuantity}
              onValueChange={(value) => setFormData({ ...formData, cansQuantity: value })}
            >
              <SelectTrigger
                id="cansQuantity"
                aria-label="Select quantity of cans"
                className="bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)]"
              >
                <SelectValue placeholder="Select quantity" />
              </SelectTrigger>
              <SelectContent className="bg-card/95 backdrop-blur-md border-border/60 text-foreground shadow-lg mobile-select-content">
                {canOptions.map((option) => (
                  <SelectItem
                    key={option.quantity}
                    value={option.label}
                    className="text-foreground focus:bg-gold/10 focus:text-gold hover:bg-gold/5 cursor-pointer transition-colors"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Helper line */}
            <p className="text-xs text-foreground/60 mt-2">
              We'll purchase and deliver the cans on your behalf for the menorah construction.
            </p>
            
            {/* Hidden inputs for form submission */}
            <input
              type="hidden"
              name="cans_quantity"
              value={cansQuantity}
            />
            <input
              type="hidden"
              name="cans_amount_usd"
              value={cansAmountUsd.toFixed(2)}
            />
          </div>
          
          {/* Sponsorship Section */}
          <div 
            id="sponsorship-section" 
            className="space-y-4 mt-4 pt-4 border-t border-gold/20 content-offscreen" 
            role="region" 
            aria-labelledby="sponsorship-label"
          >
              {/* Label and Checkboxes Layout */}
              <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6 sponsorship-container">
                {/* Left Label */}
                <Label id="sponsorship-label" className="text-foreground font-semibold text-base md:text-base whitespace-nowrap pt-1 sponsorship-label">
                  I would like to be a
          </Label>
                
                {/* Right: Vertical List of Checkboxes */}
                <div className="flex-1 space-y-2 md:space-y-2.5 w-full sponsorship-list">
                  {sponsorshipOptions.map((option) => {
                    const isChecked = formData.sponsorships.includes(option.id);
                    return (
                      <div
                        key={option.id}
                        className={`flex items-center space-x-3 group sponsorship-card transition-opacity duration-200 ${
                          isChecked
                            ? "border-gold bg-gold/15"
                            : "border-gold/30 bg-gold/5"
                        }`}
                      >
                        <Checkbox
                          id={`sponsorship-${option.id}`}
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            handleSponsorshipChange(option.id, checked as boolean);
                          }}
                          className="border-gold/60 data-[state=checked]:bg-gold data-[state=checked]:border-gold ring-offset-background focus-visible:ring-2 focus-visible:ring-gold/40 transition-opacity duration-200 shrink-0 sponsorship-checkbox"
                          aria-label={`${option.label} - $${option.amount}`}
                        />
                        <Label
                          htmlFor={`sponsorship-${option.id}`}
                          className="font-normal cursor-pointer text-foreground/90 group-hover:text-gold transition-colors duration-200 flex-1 flex items-center justify-between sponsorship-label-text min-h-[44px]"
                        >
                          <span className={`${isChecked ? "text-gold font-medium" : ""} sponsorship-title`}>{option.label}</span>
                          <span className={`font-semibold ml-4 whitespace-nowrap ${isChecked ? "text-gold" : "text-gold/80"} sponsorship-price`}>
                            ${option.amount}
                          </span>
              </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Total Charge Row */}
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-gold/30">
                <span className="text-foreground font-semibold text-base md:text-lg">Total Charge</span>
                <span className="text-gold font-bold text-lg md:text-xl">
                  ${(sponsorshipTotal + cansAmountUsd).toFixed(2)} USD
                </span>
              </div>
              
              {/* Hidden inputs for form submission */}
              <input
                type="hidden"
                name="selected_sponsorships"
                value={formData.sponsorships
                  .map((id) => sponsorshipOptions.find((opt) => opt.id === id)?.label)
                  .filter(Boolean)
                  .join(", ")}
              />
              <input
                type="hidden"
                name="sponsorship_total_usd"
                value={sponsorshipTotal.toFixed(2)}
              />
            </div>
        </div>


        {/* Comments / Special Requests */}
        <div className="space-y-2">
          <Label htmlFor="comments" className="text-foreground font-medium text-base">
            Comments or Special Requests
          </Label>
          <Textarea
            id="comments"
            name="comments"
            placeholder="Share your thoughts or any special requests…"
            value={formData.comments}
            onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
            className="bg-input/80 backdrop-blur-sm border-border/60 text-foreground placeholder:text-foreground/50 focus:border-gold focus:ring-2 focus:ring-gold/40 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)] min-h-[100px] resize-y"
            aria-label="Comments or special requests"
          />
        </div>

        {/* Lamplighter Wall Button */}
        <div className="flex justify-center pt-4 mt-4 border-t border-gold/20">
          <button
            type="button"
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-gold/20 via-amber/15 to-gold/20 border border-gold/40 text-gold font-medium hover:opacity-90 hover:shadow-[0_0_15px_rgba(255,215,0,0.2)] transition-all duration-200 active:scale-95 relative overflow-hidden"
            onClick={() => {
              window.open('https://www.jewishtc.org/templates/articlecco_cdo/aid/7109138/jewish/Untitled.htm', '_blank');
            }}
          >
            <span className="relative z-10">View the Lamplighter Wall</span>
          </button>
        </div>

        {/* Email Updates Opt-in */}
        <div className="space-y-2">
          <div className="flex items-start space-x-3 group p-2 rounded-lg hover:bg-gold/5 transition-colors duration-200">
            <Checkbox
              id="emailUpdatesOptIn"
              name="email_updates_opt_in"
              checked={formData.emailUpdatesOptIn}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, emailUpdatesOptIn: checked as boolean })
              }
              className="mt-1 border-gold/60 data-[state=checked]:bg-gold data-[state=checked]:border-gold ring-offset-background focus-visible:ring-2 focus-visible:ring-gold/40 transition-all duration-200 email-updates-checkbox"
            />
              <Label
              htmlFor="emailUpdatesOptIn"
              className="font-normal cursor-pointer text-foreground/90 group-hover:text-gold transition-colors duration-200 text-sm leading-relaxed"
              >
              Yes, I would like to receive email updates about future Chabad Traverse City events and programs
              </Label>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="pt-4">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full relative overflow-hidden bg-gradient-to-r from-gold via-amber to-gold text-background font-semibold text-lg py-6 rounded-xl shadow-lg hover:shadow-[0_0_40px_rgba(255,215,0,0.6)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] border border-gold/30 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <span className="relative z-10">
            {isSubmitting 
              ? "Processing..." 
              : (formData.sponsorships.length > 0 || formData.cansQuantity !== "") 
                ? "Pay Now" 
                : "Submit Entry"
            }
          </span>
          {/* Ripple effect on hover */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
        </Button>
      </div>
    </form>
  );
};

export default RaffleForm;
