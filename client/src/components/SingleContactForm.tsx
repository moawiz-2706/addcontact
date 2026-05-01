/**
 * SingleContactForm Component
 *
 * Uses the backend tRPC proxy to create contacts via GHL OAuth tokens.
 * No manual API key configuration needed — the backend handles authentication.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserPlus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface SingleContactFormProps {
  locationId: string;
}

export default function SingleContactForm({ locationId }: SingleContactFormProps) {
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [dnd, setDnd] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const createContactMutation = trpc.ghl.createContact.useMutation({
    onSuccess: (result) => {
      toast.success("Contact added successfully!", {
        description: result.enrolledInWorkflow
          ? "Contact has been enrolled in the Review Reactivation workflow."
          : dnd
          ? "Contact marked as Do Not Disturb — not enrolled in workflow."
          : "Contact created.",
        icon: <CheckCircle2 className="h-4 w-4 text-primary" />,
      });

      // Reset form
      setFormData({ firstName: "", lastName: "", email: "", phone: "" });
      setDnd(false);
      setConsent(false);
      setErrors({});
    },
    onError: (error) => {
      toast.error("Failed to add contact", {
        description: error.message || "Unknown error occurred",
      });
    },
  });

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "First name is required";
    }

    if (!formData.email.trim() && !formData.phone.trim()) {
      newErrors.email = "Email or phone is required";
      newErrors.phone = "Email or phone is required";
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Invalid email format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    if (!consent) {
      toast.error("Please confirm you have consent to message this customer");
      return;
    }

    createContactMutation.mutate({
      locationId,
      contact: {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        dnd,
      },
    });
  };

  const handleChange =
    (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };

  const isFormValid =
    formData.firstName.trim() &&
    (formData.email.trim() || formData.phone.trim()) &&
    consent;

  const isSubmitting = createContactMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Header with DND toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Add Single Contact</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Add to DO NOT CONTACT list
          </span>
          <Switch
            checked={dnd}
            onCheckedChange={setDnd}
            className="data-[state=checked]:bg-destructive"
          />
        </div>
      </div>

      {/* First Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">First Name</label>
        <input
          type="text"
          value={formData.firstName}
          onChange={handleChange("firstName")}
          placeholder="Enter first name"
          className={`w-full px-3 py-2.5 rounded-md border bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.firstName ? "border-destructive" : "border-input"
          }`}
        />
        {errors.firstName && (
          <p className="text-xs text-destructive">{errors.firstName}</p>
        )}
      </div>

      {/* Last Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Last Name</label>
        <input
          type="text"
          value={formData.lastName}
          onChange={handleChange("lastName")}
          placeholder="Enter last name"
          className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          placeholder="Enter email"
          className={`w-full px-3 py-2.5 rounded-md border bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.email ? "border-destructive" : "border-input"
          }`}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email}</p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Phone</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={handleChange("phone")}
          placeholder="Enter phone number"
          className={`w-full px-3 py-2.5 rounded-md border bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.phone ? "border-destructive" : "border-input"
          }`}
        />
        {errors.phone && (
          <p className="text-xs text-destructive">{errors.phone}</p>
        )}
      </div>

      {/* Consent Checkbox */}
      <div className="flex items-start gap-2 pt-1">
        <Checkbox
          id="consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <label
          htmlFor="consent"
          className="text-sm text-muted-foreground leading-tight cursor-pointer"
        >
          I have the required consent to message this customer by email or SMS
        </label>
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={!isFormValid || isSubmitting}
        className="w-full h-11 text-sm font-medium"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Adding Contact...
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Contact
          </>
        )}
      </Button>
    </form>
  );
}
