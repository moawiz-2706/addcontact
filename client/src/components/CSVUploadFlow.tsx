/**
 * CSVUploadFlow Component
 *
 * Manages the multi-step CSV upload wizard:
 * Step 1: Upload CSV file
 * Step 2: Map columns
 * Step 3: Review & Confirm
 *
 * Uses a modal/overlay approach for steps 2 and 3
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CSVUpload from "./CSVUpload";
import ColumnMapping from "./ColumnMapping";
import ReviewConfirm from "./ReviewConfirm";
import {
  type ParsedCSV,
  type ColumnMapping as ColumnMappingType,
} from "@/lib/csv-parser";

type FlowStep = "upload" | "mapping" | "review";

interface CSVUploadFlowProps {
  locationId: string;
}

export default function CSVUploadFlow({ locationId }: CSVUploadFlowProps) {
  const [step, setStep] = useState<FlowStep>("upload");
  const [parsedCSV, setParsedCSV] = useState<ParsedCSV | null>(null);
  const [mapping, setMapping] = useState<ColumnMappingType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleFileUploaded = (data: ParsedCSV) => {
    setParsedCSV(data);
    setStep("mapping");
    setDialogOpen(true);
  };

  const handleMappingComplete = (newMapping: ColumnMappingType) => {
    setMapping(newMapping);
    setStep("review");
  };

  const handleBack = () => {
    if (step === "review") {
      setStep("mapping");
    } else if (step === "mapping") {
      setStep("upload");
      setDialogOpen(false);
    }
  };

  const handleComplete = () => {
    // Reset the entire flow
    setStep("upload");
    setParsedCSV(null);
    setMapping(null);
    setDialogOpen(false);
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      // Reset to upload step when dialog is closed
      setStep("upload");
      setParsedCSV(null);
      setMapping(null);
    }
    setDialogOpen(open);
  };

  // Step indicator for the dialog
  const stepTitle = "Add Contacts to Review Harvest via CSV upload";

  return (
    <>
      {/* Step 1: Upload area (always visible in the right panel) */}
      <CSVUpload onFileUploaded={handleFileUploaded} />

      {/* Steps 2 & 3: Modal dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-base font-medium text-muted-foreground">
              {stepTitle}
            </DialogTitle>
            {/* Step Indicator */}
            <div className="flex items-center justify-center gap-2 pt-2">
              <StepDot
                active={step === "upload"}
                completed={step !== "upload"}
                label="1"
              />
              <div className="w-8 h-px bg-border" />
              <StepDot
                active={step === "mapping"}
                completed={step === "review"}
                label="2"
              />
              <div className="w-8 h-px bg-border" />
              <StepDot active={step === "review"} completed={false} label="3" />
            </div>
          </DialogHeader>

          <div className="mt-4">
            {step === "mapping" && parsedCSV && (
              <ColumnMapping
                parsedCSV={parsedCSV}
                onBack={handleBack}
                onNext={handleMappingComplete}
              />
            )}
            {step === "review" && parsedCSV && mapping && (
              <ReviewConfirm
                parsedCSV={parsedCSV}
                mapping={mapping}
                locationId={locationId}
                onBack={handleBack}
                onComplete={handleComplete}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Step indicator dot
function StepDot({
  active,
  completed,
  label,
}: {
  active: boolean;
  completed: boolean;
  label: string;
}) {
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : completed
          ? "bg-primary/20 text-primary"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </div>
  );
}
