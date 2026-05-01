/**
 * CSVUpload Component
 * 
 * Design: Clean SaaS Utility — Functional Clarity
 * - Drag-and-drop zone with dashed border
 * - File type validation (CSV only)
 * - Triggers the column mapping flow on successful upload
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { parseCSV, type ParsedCSV } from '@/lib/csv-parser';

interface CSVUploadProps {
  onFileUploaded: (data: ParsedCSV) => void;
}

export default function CSVUpload({ onFileUploaded }: CSVUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
        toast.error('Invalid file type', {
          description: 'Please upload a CSV file only.',
        });
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast.error('File too large', {
          description: 'Maximum file size is 10MB.',
        });
        return;
      }

      setSelectedFile(file);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const parsed = parseCSV(text, file.name);
          onFileUploaded(parsed);
        } catch (error) {
          toast.error('Failed to parse CSV', {
            description: error instanceof Error ? error.message : 'Invalid CSV format',
          });
          setSelectedFile(null);
        }
      };
      reader.onerror = () => {
        toast.error('Failed to read file');
        setSelectedFile(null);
      };
      reader.readAsText(file);
    },
    [onFileUploaded]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Upload a CSV file of your contacts</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your CSV file should include the following columns:
        </p>
        <div className="flex gap-6 mt-2">
          <span className="text-sm font-medium text-foreground">Phone Number</span>
          <span className="text-sm font-medium text-foreground">First Name</span>
          <span className="text-sm font-medium text-foreground">Last Name</span>
          <span className="text-sm font-medium text-foreground">Email</span>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center py-12 px-6 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : selectedFile
            ? 'border-primary/40 bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/50'
        }`}
      >
        {selectedFile ? (
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearFile();
              }}
              className="ml-2 p-1 rounded-full hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm text-foreground font-medium">
              Click to upload{' '}
              <span className="text-muted-foreground font-normal">or drag and drop</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">CSV files only</p>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {!selectedFile && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="border-primary text-primary hover:bg-primary/5"
          >
            Select File
          </Button>
        </div>
      )}
    </div>
  );
}
