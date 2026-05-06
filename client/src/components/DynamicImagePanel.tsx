import React, { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Copy, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// Inline draggable overlay component for instant positioning (client-side)
function DraggableTextOverlay({
  sampleName,
  overlayConfig,
  onUpdatePosition,
  onDragEnd,
  onResizeEnd,
  setDraggingOverlay,
}: {
  sampleName: string;
  overlayConfig: any;
  onUpdatePosition: (xPercent: number, yPercent: number) => void;
  onDragEnd?: () => void;
  onResizeEnd?: () => void;
  setDraggingOverlay: (v: boolean) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    let dragging = false;

    const onPointerDown = (e: PointerEvent) => {
      // Only start drag when pointer down on overlay itself (not resize handle)
      if ((e.target as Element) === resizeRef.current) return;
      dragging = true;
      setDraggingOverlay(true);
      try {
        (e.target as Element).setPointerCapture((e as any).pointerId);
      } catch {}
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const container = el.parentElement as HTMLElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      onUpdatePosition(Math.round(x * 100), Math.round(y * 100));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      setDraggingOverlay(false);
      try {
        (e.target as Element).releasePointerCapture((e as any).pointerId);
      } catch {}
      // Notify parent that drag ended so server preview can be refreshed
      onDragEnd?.();
    };

    el.addEventListener("pointerdown", onPointerDown as any);
    window.addEventListener("pointermove", onPointerMove as any);
    window.addEventListener("pointerup", onPointerUp as any);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown as any);
      window.removeEventListener("pointermove", onPointerMove as any);
      window.removeEventListener("pointerup", onPointerUp as any);
    };
  }, [onUpdatePosition, setDraggingOverlay]);

  const left = `${overlayConfig.xPercent}%`;
  const top = `${overlayConfig.yPercent}%`;

  return (
    <div ref={elRef} style={{ position: "absolute", left: left, top: top, transform: "translate(-50%, -50%)", pointerEvents: "auto" }}>
      <div
        className="select-none cursor-move relative"
        style={{
          fontSize: overlayConfig.fontSize,
          color: overlayConfig.fontColor,
          fontWeight: overlayConfig.fontWeight,
          padding: overlayConfig.padding,
          background: overlayConfig.bgOpacity ? overlayConfig.bgColor : "rgba(0,0,0,0.18)",
          opacity: overlayConfig.bgOpacity ? overlayConfig.bgOpacity : 1,
          whiteSpace: "nowrap",
          border: "1px dashed rgba(255,255,255,0.6)",
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        }}
      >
        {sampleName}

        {/* Resize handle */}
        <div
          ref={resizeRef}
          data-resize-handle
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            width: 12,
            height: 12,
            background: "white",
            border: "1px solid rgba(0,0,0,0.2)",
            borderRadius: 2,
            cursor: "nwse-resize",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const startY = (e as PointerEvent).clientY;
            const startX = (e as PointerEvent).clientX;
            const startSize = overlayConfig.fontSize;
            setDraggingOverlay(true);

            const onMove = (ev: PointerEvent) => {
              const dy = ev.clientY - startY;
              const dx = ev.clientX - startX;
              const delta = Math.round((dx + -dy) / 2);
              const newSize = Math.max(12, startSize + delta);
              onUpdatePosition(overlayConfig.xPercent, overlayConfig.yPercent); // keep position
              // update font size live by calling parent update (via custom event)
              const evt = new CustomEvent("overlay:resize", { detail: { size: newSize } });
              window.dispatchEvent(evt);
            };

            const onUp = () => {
              setDraggingOverlay(false);
              window.removeEventListener("pointermove", onMove as any);
              window.removeEventListener("pointerup", onUp as any);
              onResizeEnd?.();
            };

            window.addEventListener("pointermove", onMove as any);
            window.addEventListener("pointerup", onUp as any);
          }}
        />
      </div>
    </div>
  );
}

interface DynamicImagePanelProps {
  locationId: string;
  contactId?: string;
  onSaveUrl?: (url: string) => void; // Callback when URL is saved
  isModal?: boolean; // If true, includes close button and different styling
}

export default function DynamicImagePanel({ locationId, contactId, onSaveUrl, isModal = false }: DynamicImagePanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [sampleName, setSampleName] = useState("Alice");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    dynamicUrlTemplate: string;
    previewUrl: string;
    baseImageUrl: string;
  } | null>(null);
  const [showPreviewConfirm, setShowPreviewConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draggingOverlay, setDraggingOverlay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState<string | null>(null);

  const [overlayConfig, setOverlayConfig] = useState({
    fontSize: 72,
    fontColor: "#ffffff",
    fontWeight: "bold" as const,
    positionType: "center" as const,
    xPercent: 50,
    yPercent: 50,
    bgColor: "#000000",
    bgOpacity: 0,
    padding: 16,
  });

  const hasContactId = Boolean(contactId && contactId.trim().length > 0);

  // Listen for resize events from DraggableTextOverlay
  useEffect(() => {
    const onResize = (e: any) => {
      const size = e.detail?.size;
      if (typeof size === "number") {
        setOverlayConfig((prev) => ({ ...prev, fontSize: size }));
      }
    };
    window.addEventListener("overlay:resize", onResize as EventListener);
    return () => window.removeEventListener("overlay:resize", onResize as EventListener);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewMutationQuery = trpc.dynamicImage.previewComposite.useMutation();
  const saveAndUpdateMutation = trpc.dynamicImage.saveAndUpdateContact.useMutation();

  // File to base64
  const fileToBase64 = (f: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  };

  // Handle file selection
  const handleFile = async (f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Please select a valid image file (JPG or PNG).");
      return;
    }

    setError(null);
    setFile(f);
    setResult(null);

    // Cache file base64 to avoid re-reading on save
    try {
      const b64 = await fileToBase64(f);
      setFileBase64(b64);
      // Immediately show preview with sample name
      await refreshPreview(f, sampleName, b64);
    } catch (err) {
      console.error("File read error:", err);
      setError("Failed to read file");
    }
  };

  // Refresh preview when config changes
  const refreshPreview = useCallback(
    async (imageFile?: File, name?: string, cachedFileBase64?: string) => {
      const currentFile = imageFile || file;
      const currentName = name || sampleName;

      if (!currentFile) return;

      // Prefer cached base64 when available
      const base64 = cachedFileBase64 || fileBase64 || (await fileToBase64(currentFile));

      setLoading(true);
      try {
        const response = await previewMutationQuery.mutateAsync({
          imageBase64: base64,
          name: currentName,
          overlayConfig,
        });
        setPreviewBase64(response.imageBase64);
      } catch (err) {
        console.error("Preview error:", err);
        toast.error("Failed to generate preview");
      } finally {
        setLoading(false);
      }
    },
    [file, sampleName, overlayConfig, previewMutationQuery, fileBase64]
  );

  // Debounced preview update
  useEffect(() => {
    // Only schedule server preview when not actively dragging overlay
    if (draggingOverlay) return;

    const timer = setTimeout(() => {
      refreshPreview();
    }, 500);
    return () => clearTimeout(timer);
  }, [sampleName, overlayConfig, refreshPreview, draggingOverlay]);

  // Trigger server preview when drag/resize ends
  const handleDragEnd = useCallback(() => {
    refreshPreview(undefined, undefined);
  }, [refreshPreview]);

  const handleResizeEnd = useCallback(() => {
    refreshPreview(undefined, undefined);
  }, [refreshPreview]);

  // Handle save
  const handleSave = async () => {
    if (!file) {
      setError("Please upload a base image first.");
      return;
    }

    setSaving(true);
    setSaveProgress(hasContactId ? "Uploading image..." : "Uploading image template...");
    setError(null);

    try {
      console.log("[DynamicImagePanel] Starting save...");
      console.log("[DynamicImagePanel] locationId:", locationId);
      console.log("[DynamicImagePanel] contactId:", contactId);
      console.log("[DynamicImagePanel] sampleName:", sampleName);
      
      const base64 = fileBase64 || (await fileToBase64(file));
      console.log("[DynamicImagePanel] base64 length:", base64.length);
      
      console.log("[DynamicImagePanel] Calling saveAndUpdateMutation...");
      const responsePromise = saveAndUpdateMutation.mutateAsync({
        imageBase64: base64,
        locationId,
        contactId: contactId || "",
        sampleName,
        customFieldKey: "dynamic_image_url",
        overlayConfig,
      });

      // show interim progress
      setTimeout(() => setSaveProgress("Compositing image..."), 500);
      console.log("[DynamicImagePanel] Waiting for response...");
      const response = await responsePromise;
      console.log("[DynamicImagePanel] Got response:", response);
      setSaveProgress("Finalizing...");

      setResult(response);
      toast.success(hasContactId ? "Image saved and URL written to contact!" : "Image saved and template ready!");
      setSaveProgress(null);
      // Show preview confirmation screen so user can accept/decline
      setShowPreviewConfirm(true);
    } catch (err: any) {
      console.error("[DynamicImagePanel] Save error:", err);
      console.error("[DynamicImagePanel] Error data:", err?.data);
      const message = err?.data?.code === "NOT_FOUND" ? err.message : (err?.message || "Failed to save image");
      setError(message);
      toast.error(message);
      setSaveProgress(null);
    } finally {
      setSaving(false);
    }
  };

  // Copy to clipboard
  const copyUrl = () => {
    if (!result?.dynamicUrlTemplate) return;
    navigator.clipboard.writeText(result.dynamicUrlTemplate);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseImage = () => {
    if (!result) return;
    // notify parent (MessagingPage) to save the template and close modal
    if (onSaveUrl) onSaveUrl(result.dynamicUrlTemplate);
    // reset local preview state
    setShowPreviewConfirm(false);
    setResult(null);
  };

  const handleKeepEditing = () => {
    setShowPreviewConfirm(false);
  };

  // Drag and drop
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const updateOverlayConfig = (key: keyof typeof overlayConfig, value: any) => {
    setOverlayConfig((prev) => ({ ...prev, [key]: value }));
  };

  const containerClass = isModal
    ? "w-full max-h-[90vh] overflow-y-auto"
    : "mt-6 border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-900";

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className={isModal ? "mb-4 pb-3 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-900" : "mb-4 pb-3 border-b border-slate-200 dark:border-slate-700"}>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Upload className="w-4 h-4" />
          🖼 Dynamic Image Personalizer
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Upload a static image and personalize it with names</p>
      </div>

      <div className={isModal ? "px-4" : ""}>
        {/* Error Alert */}
        {error && (
          <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* File Upload Drop Zone */}
        <div
          className={`mb-3 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
            dragging
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/10"
              : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800"
          }`}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700 dark:text-slate-300">
                ✅ <strong>{file.name}</strong> ({(file.size / 1024).toFixed(0)} KB)
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setPreviewBase64(null);
                }}
                className="text-red-500 hover:text-red-600 text-xs"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Drag & drop or <strong>click</strong> to upload image (JPG/PNG, max 20MB)
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden"
          />
        </div>

        {/* Configuration Panel */}
        {file && (
          <div className="mb-3 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg space-y-2 border border-slate-200 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Sample Name
                </label>
                <Input
                  type="text"
                  value={sampleName}
                  onChange={(e) => setSampleName(e.target.value)}
                  placeholder="Alice"
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Font Size
                </label>
                <Input
                  type="number"
                  min={12}
                  max={300}
                  value={overlayConfig.fontSize}
                  onChange={(e) => updateOverlayConfig("fontSize", Number(e.target.value))}
                  className="h-7 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Color
                </label>
                <input
                  type="color"
                  value={overlayConfig.fontColor}
                  onChange={(e) => updateOverlayConfig("fontColor", e.target.value)}
                  className="w-full h-7 border border-slate-300 dark:border-slate-600 rounded cursor-pointer"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Weight
                </label>
                <select
                  value={overlayConfig.fontWeight}
                  onChange={(e) => updateOverlayConfig("fontWeight", e.target.value)}
                  className="w-full h-7 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Position
              </label>
              <select
                value={overlayConfig.positionType}
                onChange={(e) => updateOverlayConfig("positionType", e.target.value)}
                className="w-full h-7 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
              >
                <option value="center">Center</option>
                <option value="custom">Custom X/Y %</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  X %
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={overlayConfig.xPercent}
                  onChange={(e) => updateOverlayConfig("xPercent", Number(e.target.value))}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Y %
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={overlayConfig.yPercent}
                  onChange={(e) => updateOverlayConfig("yPercent", Number(e.target.value))}
                  className="h-7 text-xs"
                />
              </div>
            </div>

            <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
              Drag the text directly on preview. Current: X {overlayConfig.xPercent}% , Y {overlayConfig.yPercent}% , Size {overlayConfig.fontSize}px
            </div>
          </div>
        )}

        {/* Live Preview */}
        {file && previewBase64 && (
          <div className="mb-3 p-2 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1">
              Live Preview {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            </p>
            <div className="w-full max-h-48 rounded relative overflow-hidden bg-black/5">
              <img
                src={`data:image/png;base64,${previewBase64}`}
                alt="Live preview"
                className="w-full max-h-48 object-contain"
                draggable={false}
              />

              {/* Client-side draggable overlay for instant positioning */}
              <div
                className="absolute left-0 top-0 w-full h-full pointer-events-none"
                style={{ touchAction: "none" }}
              >
                <DraggableTextOverlay
                  sampleName={sampleName}
                  overlayConfig={overlayConfig}
                  onUpdatePosition={(xPct: number, yPct: number) => {
                    updateOverlayConfig("xPercent", xPct);
                    updateOverlayConfig("yPercent", yPct);
                  }}
                  onDragEnd={handleDragEnd}
                  onResizeEnd={handleResizeEnd}
                  setDraggingOverlay={setDraggingOverlay}
                />
              </div>
            </div>
          </div>
        )}

        {saveProgress ? (
          <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{saveProgress}</span>
          </div>
        ) : null}

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={!file || saving}
          className="w-full mb-3"
          size="sm"
        >
          {saving ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Upload className="w-3 h-3 mr-1" />
              Save & Configure
            </>
          )}
        </Button>

        {/* Preview confirmation after save: let user accept or return to editing */}
        {showPreviewConfirm && result && (
          <div className="mb-3 p-4 border rounded-lg bg-gradient-to-b from-blue-50 to-white dark:from-blue-900/20 dark:to-slate-900 border-blue-300 dark:border-blue-800 shadow-md">
            <p className="text-base font-bold mb-3 text-slate-900 dark:text-white flex items-center gap-2">
              ✨ Generated Image Preview
            </p>
            <div className="mb-4 w-full rounded-lg overflow-hidden border-2 border-blue-200 dark:border-blue-700 bg-slate-50 dark:bg-slate-800">
              <img src={result.previewUrl} alt="Preview result" className="w-full h-auto max-h-80 object-contain" />
            </div>
            <div className="flex gap-2">
              <Button 
                variant="default" 
                onClick={handleUseImage} 
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                size="lg"
              >
                ✓ Use this Image
              </Button>
              <Button 
                variant="outline" 
                onClick={handleKeepEditing} 
                className="flex-1"
                size="lg"
              >
                ← Keep Editing
              </Button>
            </div>
          </div>
        )}

        {/* Result (only show when NOT in preview confirmation mode) */}
        {result && !showPreviewConfirm && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
            <div className="flex items-start gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-green-700 dark:text-green-300">
                  ✅ Success! Ready to use.
                </p>
              </div>
            </div>

            <div className="bg-slate-900 dark:bg-slate-950 rounded p-2 mb-2 text-xs font-mono text-green-300 break-all overflow-x-auto">
              {result.dynamicUrlTemplate}
              <span className="text-amber-300">{'{'}</span>
              <span className="text-cyan-300">name</span>
              <span className="text-amber-300">{'}'}</span>
            </div>

            {!isModal && (
              <div className="flex gap-2">
                <button
                  onClick={copyUrl}
                  className="flex-1 px-2 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 inline mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 inline mr-1" />
                      Copy URL
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        <p className="mb-3 text-[11px] text-muted-foreground">
          Drag the text box directly on the preview. Use the corner handle to resize. Saving works even without a selected contact; if a contact is selected, the URL is also synced there.
        </p>
      </div>
    </div>
  );
}
