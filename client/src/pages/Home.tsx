/**
 * Home Page — Royal Review Add Contacts
 *
 * Design: Clean SaaS Utility — Functional Clarity
 * Layout: Two-panel split — single contact form (left) | CSV upload (right)
 * Separated by a subtle divider with "OR" indicator
 *
 * This page is designed to be embedded in GoHighLevel via iframe.
 * The locationId is passed as a URL query parameter: ?locationId=xxx
 *
 * Connection flow:
 * 1. If no locationId → show setup instructions
 * 2. If locationId but not connected → show install prompt
 * 3. If connected → show the Add Contacts interface
 */

import { useState, useMemo } from "react";
import { AlertCircle, CheckCircle2, Loader2, Settings2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SingleContactForm from "@/components/SingleContactForm";
import CSVUploadFlow from "@/components/CSVUploadFlow";
import { trpc } from "@/lib/trpc";

export default function Home() {
  // Get locationId from URL query parameters
  // When embedded in GHL iframe, the URL will be: https://your-app.com/?locationId=xxx
  const locationId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);

  // Check connection status
  const connectionQuery = trpc.ghl.connectionStatus.useQuery(
    { locationId },
    { enabled: !!locationId, refetchInterval: 60000 }
  );

  const isConnected = connectionQuery.data?.connected ?? false;
  const isLoading = connectionQuery.isLoading;

  // Workflow ID management
  const [showWorkflowInput, setShowWorkflowInput] = useState(false);
  const [workflowIdInput, setWorkflowIdInput] = useState("");
  const updateWorkflowMutation = trpc.ghl.updateWorkflowId.useMutation({
    onSuccess: () => {
      setShowWorkflowInput(false);
      connectionQuery.refetch();
    },
  });

  // ─── No Location ID ───────────────────────────────────────────────
  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            Royal Review — Add Contacts
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This application is designed to be embedded inside GoHighLevel.
            To use it, add it as a Custom Menu Link in your GHL sub-account with
            the <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">?locationId=YOUR_LOCATION_ID</code> parameter.
          </p>
          <div className="bg-muted/50 border rounded-lg p-4 text-left">
            <p className="text-xs font-medium text-foreground mb-2">Example URL:</p>
            <code className="text-xs text-muted-foreground break-all">
              {window.location.origin}/?locationId=abc123xyz
            </code>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Checking connection...</p>
        </div>
      </div>
    );
  }

  // ─── Not Connected ────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            App Not Connected
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This GoHighLevel sub-account (<code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{locationId}</code>)
            has not installed the Royal Review Add Contacts app yet.
          </p>
          <p className="text-sm text-muted-foreground">
            Please install the app from the GHL Marketplace to connect this account.
          </p>
          <Button
            variant="outline"
            onClick={() => connectionQuery.refetch()}
            className="mt-2"
          >
            Check Again
          </Button>
        </div>
      </div>
    );
  }

  // ─── Connected — Main Interface ───────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar — minimal, connection status */}
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-sm font-medium text-foreground">
              Add Contacts
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs text-muted-foreground">Connected</span>
            </div>
            {connectionQuery.data?.workflowId ? (
              <span className="text-xs text-muted-foreground">
                Workflow: <span className="font-mono text-foreground">{connectionQuery.data.workflowId.slice(0, 8)}...</span>
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWorkflowInput(true)}
                className="h-7 text-xs gap-1"
              >
                <Settings2 className="h-3 w-3" />
                Set Workflow
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Workflow ID Input Banner */}
      {showWorkflowInput && (
        <div className="border-b bg-primary/5 px-4 sm:px-6 lg:px-8 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <span className="text-sm text-foreground whitespace-nowrap">Workflow ID:</span>
            <input
              type="text"
              value={workflowIdInput}
              onChange={(e) => setWorkflowIdInput(e.target.value)}
              placeholder="Enter the Review Reactivation workflow ID"
              className="flex-1 px-3 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Button
              size="sm"
              onClick={() => {
                if (workflowIdInput.trim()) {
                  updateWorkflowMutation.mutate({
                    locationId,
                    workflowId: workflowIdInput.trim(),
                  });
                }
              }}
              disabled={!workflowIdInput.trim() || updateWorkflowMutation.isPending}
              className="h-8"
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWorkflowInput(false)}
              className="h-8"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 relative">
          {/* Left Panel — Single Contact Form */}
          <div className="lg:pr-8 lg:border-r border-border">
            <div className="max-w-md">
              <SingleContactForm locationId={locationId} />
            </div>
          </div>

          {/* Divider with OR (mobile) */}
          <div className="flex items-center gap-4 py-6 lg:hidden">
            <div className="flex-1 h-px bg-border" />
            <span className="text-sm font-medium text-muted-foreground">
              OR
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* OR badge on desktop */}
          <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background border border-border items-center justify-center z-10">
            <span className="text-xs font-medium text-muted-foreground">
              OR
            </span>
          </div>

          {/* Right Panel — CSV Upload */}
          <div className="lg:pl-8">
            <CSVUploadFlow locationId={locationId} />
          </div>
        </div>
      </main>
    </div>
  );
}
