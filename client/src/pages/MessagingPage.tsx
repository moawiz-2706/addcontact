import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, Loader2, RefreshCw, Search, Send, Settings2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import DynamicImagePanel from "@/components/DynamicImagePanel";
import { toast } from "sonner";

type SelectedContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

const DEFAULT_PERSONALIZED_IMAGE_URL = "https://img1.niftyimages.com/3qvh/bu47/vg6f";

function buildPersonalizedImageUrl(baseUrl: string, contactName: string): string {
  const urlText = baseUrl.trim() || DEFAULT_PERSONALIZED_IMAGE_URL;

  try {
    const url = new URL(urlText);
    url.searchParams.set("name", contactName);
    return url.toString();
  } catch {
    const separator = urlText.includes("?") ? "&" : "?";
    return `${urlText}${separator}name=${encodeURIComponent(contactName)}`;
  }
}

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

export default function MessagingPage() {
  const locationId = useLocationId();
  const connectionQuery = trpc.ghl.connectionStatus.useQuery({ locationId }, { enabled: !!locationId, refetchInterval: 60000 });
  const messagingContextQuery = trpc.ghl.messagingContext.useQuery({ locationId }, { enabled: !!locationId && connectionQuery.data?.connected === true });

  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [personalizedImageBaseUrl, setPersonalizedImageBaseUrl] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [personalizedImageEnabled, setPersonalizedImageEnabled] = useState(true);

  const [contactSearch, setContactSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<SelectedContact | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  useEffect(() => {
    const ctx = messagingContextQuery.data;
    if (!ctx) return;
    setOwnerFirstName(ctx.ownerFirstName || "");
    setOwnerLastName(ctx.ownerLastName || "");
    setBusinessName(ctx.businessName || "");
    setPersonalizedImageBaseUrl(ctx.personalizedImageBaseUrl || "");
    setCustomMessage(ctx.customMessage || "");
    setPersonalizedImageEnabled(ctx.personalizedImageEnabled);
  }, [messagingContextQuery.data]);

  const contactQuery = trpc.ghl.listContacts.useQuery(
    { locationId, query: appliedSearch, pageLimit: 20, statusFilters: [] },
    { enabled: !!locationId && connectionQuery.data?.connected === true }
  );

  const saveMutation = trpc.ghl.updateMessagingSettings.useMutation();
  const sendMutation = trpc.ghl.sendTestMessage.useMutation();

  const isLoading = connectionQuery.isLoading || messagingContextQuery.isLoading;
  const isError = connectionQuery.isError || messagingContextQuery.isError;
  const errorMessage =
    (connectionQuery.error instanceof Error && connectionQuery.error.message) ||
    (messagingContextQuery.error instanceof Error && messagingContextQuery.error.message) ||
    undefined;

  const imageName = selectedContact?.firstName || ownerFirstName || "Jessica";
  const imageUrl = buildPersonalizedImageUrl(personalizedImageBaseUrl, imageName);

  const currentMessage = customMessage
    ? customMessage
        .replace(/\{\{contact\.first_name\}\}/g, selectedContact?.firstName || "Jessica")
        .replace(/\{\{business\.name\}\}/g, businessName || "Your Business")
        .replace(/\{\{owner\.first_name\}\}/g, ownerFirstName || "Owner")
        .replace(/\{\{review_link\}\}/g, "<Review Link>")
    : `Hey ${selectedContact?.firstName || "Jessica"}, we hope you enjoyed your experience with ${businessName || "Your Business"}! Would you mind taking a moment to leave a review? Here's the link: <Review Link>`;

  const searchResults = contactQuery.data?.contacts ?? [];

  const handleSave = async () => {
    await saveMutation.mutateAsync({
      locationId,
      ownerFirstName,
      ownerLastName,
      businessName,
      businessId: messagingContextQuery.data?.businessId || "",
      companyId: messagingContextQuery.data?.companyId || "",
      customMessage,
      personalizedImageEnabled,
      personalizedImageBaseUrl,
    });
    await messagingContextQuery.refetch();
  };

  const handleSendTest = async () => {
    if (!selectedContact) return;
    await sendMutation.mutateAsync({
      locationId,
      contactId: selectedContact.id,
      message: currentMessage,
      attachmentUrl: personalizedImageEnabled ? imageUrl : undefined,
    });
  };

  const handleImageSave = async (url: string) => {
    setPersonalizedImageBaseUrl(url);

    try {
      await saveMutation.mutateAsync({
        locationId,
        ownerFirstName,
        ownerLastName,
        businessName,
        businessId: messagingContextQuery.data?.businessId || "",
        companyId: messagingContextQuery.data?.companyId || "",
        customMessage,
        personalizedImageEnabled,
        personalizedImageBaseUrl: url,
      });
      await messagingContextQuery.refetch();
      toast.success("Personalized image saved to messaging settings");
    } catch (error) {
      console.error("Failed to auto-save image setting:", error);
      toast.error("Image saved, but messaging settings could not be updated");
    } finally {
      setShowImageModal(false);
    }
  };

  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Messaging</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">?locationId=YOUR_LOCATION_ID</code> parameter.
          </p>
        </div>
      </div>
    );
  }

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

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-rose-600" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">API Connection Error</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">We were unable to contact the backend for the messaging page.</p>
          {errorMessage ? <p className="text-xs text-muted-foreground">{errorMessage}</p> : null}
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={() => connectionQuery.refetch()}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!connectionQuery.data?.connected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">App Not Connected</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">This GoHighLevel sub-account has not installed the app yet.</p>
          <Button variant="outline" onClick={() => connectionQuery.refetch()} className="mt-2">Check Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-foreground leading-none">Messaging</h1>
              <p className="text-xs text-muted-foreground truncate">Location {locationId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span>Connected</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-semibold text-primary">{imageName.slice(0, 1).toUpperCase()}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Phone Preview</p>
              <p className="text-xs text-muted-foreground">Shows the current owner or selected contact</p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-900 bg-white p-4 shadow-lg max-w-[340px] mx-auto">
            <div className="h-2 w-20 rounded-full bg-slate-900 mx-auto mb-4" />
            <div className="space-y-3">
              <div className="rounded-2xl overflow-hidden border bg-slate-100 aspect-square flex items-center justify-center text-slate-500 text-sm px-6 text-center">
                {personalizedImageEnabled ? <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" /> : <span>Personalized image disabled</span>}
              </div>
              <div className="rounded-2xl rounded-bl-md bg-blue-500 text-white px-4 py-3 text-sm leading-6">
                {currentMessage}
              </div>
            </div>
          </div>

          <Button className="w-full gap-2" onClick={handleSendTest} disabled={!selectedContact || sendMutation.isPending}>
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Test Message
          </Button>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Smart Message Optimization</h2>
              <Button variant="ghost" size="icon" onClick={() => messagingContextQuery.refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Owner First Name</label>
                <Input value={ownerFirstName} onChange={(e) => setOwnerFirstName(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Owner Last Name</label>
                <Input value={ownerLastName} onChange={(e) => setOwnerLastName(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-foreground mb-1 block">Business Name</label>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-foreground mb-1 block">Personalized Image</label>
                <div className="flex flex-col gap-2">
                  {personalizedImageBaseUrl ? (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">✅ Image Configured</p>
                        <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{personalizedImageBaseUrl}</p>
                      </div>
                      <button
                        onClick={() => {
                          setPersonalizedImageBaseUrl("");
                          setShowImageModal(false);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 underline whitespace-nowrap"
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}
                  <Button
                    onClick={() => setShowImageModal(true)}
                    variant="outline"
                    className="gap-2 justify-start"
                    type="button"
                  >
                    <Upload className="h-4 w-4" />
                    {personalizedImageBaseUrl ? "Change Image" : "Upload & Configure Image"}
                  </Button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-foreground mb-1 block">Custom Message</label>
                <textarea
                  className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Hey {{contact.first_name}}, we hope you enjoyed your experience with {{business.name}}!"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={personalizedImageEnabled} onChange={(e) => setPersonalizedImageEnabled(e.target.checked)} />
                Personalized image
              </label>
              <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                Update
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Send Review Request To</h2>
            </div>
            <Input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setAppliedSearch(contactSearch.trim());
              }}
              placeholder="Search contacts by name, email, or phone..."
            />
            <div className="max-h-56 overflow-auto rounded-lg border">
              {contactQuery.isLoading ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Loading contacts...</div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No contacts found.</div>
              ) : (
                searchResults.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    className={`w-full text-left px-4 py-3 border-b last:border-b-0 flex items-center justify-between gap-3 ${selectedContact?.id === contact.id ? "bg-emerald-50" : "bg-background hover:bg-muted/50"}`}
                    onClick={() =>
                      setSelectedContact({
                        id: contact.id,
                        firstName: contact.name.split(" ")[0] || "",
                        lastName: contact.name.split(" ").slice(1).join(" ") || "",
                        email: contact.email || "",
                        phone: contact.phone || "",
                      })
                    }
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{contact.name}</div>
                      <div className="text-xs text-muted-foreground">{contact.email || contact.phone || "No details"}</div>
                    </div>
                    <span className="text-emerald-600 font-semibold">{selectedContact?.id === contact.id ? "✓" : ""}</span>
                  </button>
                ))
              )}
            </div>
            {selectedContact ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
                Selected: {selectedContact.firstName} {selectedContact.lastName}
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <Dialog open={showImageModal} onOpenChange={setShowImageModal}>
        <DialogContent className="max-w-2xl p-0 gap-0 rounded-xl">
          <div className="flex items-center justify-between p-5 border-b">
            <DialogTitle className="text-lg font-semibold">Upload & Configure Personalized Image</DialogTitle>
            <button
              onClick={() => setShowImageModal(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-5">
            <DynamicImagePanel 
              locationId={locationId} 
              contactId={selectedContact?.id || ""} 
              isModal={true}
              onSaveUrl={handleImageSave}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
