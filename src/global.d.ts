interface SaveFilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

declare const __VERSION__: string;

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: SaveFilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface FileSystemWritableFileStreamLike {
  write(data: BlobPart | string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface Window {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
  __CANVAS_HLS_DOWNLOADER__?: unknown;
  __canvasHlsDownloaderHooksV1__?: boolean;
  __canvasPanoptoHlsDownloaderV1__?: boolean;
  Panopto?: { appRoot?: string };
  PanoptoReactComponents?: {
    Helpers?: { getLanguageFriendlyName?: (language: number) => string };
  };
}
