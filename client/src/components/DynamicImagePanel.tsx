import React, { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Copy, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface DynamicImagePanelProps {
  locationId: string;
  contactId: string;
}

export default function DynamicImagePanel({ locationId, contactId }: DynamicImagePanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [sampleName, setSampleName] = useState("Alice");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    dynamicUrlTemplate: string;
    previewUrl: string;
    baseImageUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    // Immediately show preview with sample name
    await refreshPreview(f, sampleName);
  };

  // Refresh preview when config changes
  const refreshPreview = useCallback(
    async (imageFile?: File, name?: string) => {
      const currentFile = imageFile || file;
      const currentName = name || sampleName;

      if (!currentFile) return;

      setLoading(true);
      try {
        const base64 = await fileToBase64(currentFile);
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
    [file, sampleName, overlayConfig, previewMutationQuery]
  );

  // Debounced preview update
  useEffect(() => {
    const timer = setTimeout(() => {
      refreshPreview();
    }, 500);
    return () => clearTimeout(timer);
  }, [sampleName, overlayConfig, refreshPreview]);

  // Handle save
  const handleSave = async () => {
    if (!file) {
      setError("Please upload a base image first.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const base64 = await fileToBase64(file);
      const response = await saveAndUpdateMutation.mutateAsync({
        imageBase64: base64,
        locationId,
        contactId,
        sampleName,
        customFieldKey: "dynamic_image_url",
        overlayConfig,
      });

      setResult(response);
      toast.success("Image saved and URL written to contact!");
    } catch (err: any) {
      console.error("Save error:", err);
      const message = err?.data?.code === "NOT_FOUND" ? err.message : "Failed to save image";
      setError(message);
      toast.error(message);
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

  return (
    <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="mb-4 pb-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Upload className="w-4 h-4" />
          🖼 Dynamic Image Personalizer
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Upload a static image and personalize it with names</p>
      </div>

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

          {overlayConfig.positionType === "custom" && (
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
          )}
        </div>
      )}

      {/* Live Preview */}
      {file && previewBase64 && (
        <div className="mb-3 p-2 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1">
            Live Preview {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          </p>
          <img
            src={`data:image/png;base64,${previewBase64}`}
            alt="Live preview"
            className="w-full max-h-48 object-contain rounded"
          />
        </div>
      )}

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
            Save & Write URL to Contact
          </>
        )}
      </Button>

      {/* Result */}
      {result && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
          <div className="flex items-start gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-green-700 dark:text-green-300">
                ✅ Success! Dynamic URL written to contact.
              </p>
            </div>
          </div>

          <div className="bg-slate-900 dark:bg-slate-950 rounded p-2 mb-2 text-xs font-mono text-green-300 break-all overflow-x-auto">
            {result.dynamicUrlTemplate}
            <span className="text-amber-300">{'{'}</span>
            <span className="text-cyan-300">name</span>
            <span className="text-amber-300">{'}'}</span>
          </div>

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
            {result.previewUrl && (
              <a
                href={result.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 px-2 py-1 text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded transition text-center"
              >
                View Sample →
              </a>
            )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
            Use this URL in emails, SMS, or automations. Append any name: <code>{result.dynamicUrlTemplate}John</code>
          </p>
        </div>
      )}
    </div>
  );
}
