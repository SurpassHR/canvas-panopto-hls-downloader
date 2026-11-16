export interface CapturedUrl {
  url: string;
  source: string;
  firstSeen: number;
  lastSeen: number;
}

export interface ByteRange {
  length: number;
  offset: number;
}

export interface HlsKey {
  method: string;
  url?: string;
  iv?: string;
  unsupported?: boolean;
  reason?: string;
}

export interface MediaResource {
  url: string;
  range: ByteRange | null;
  key: HlsKey | null;
}

export interface HlsInitSection extends MediaResource {}

export interface HlsSegment extends MediaResource {
  duration: number;
  sequence: number;
  map: HlsInitSection | null;
  gap: boolean;
}

export interface HlsVariant {
  url: string;
  bandwidth: number;
  width: number;
  height: number;
  frameRate: number;
  codecs: string;
  audioGroup: string;
  attributes: Record<string, string>;
}

export interface HlsSubtitleRendition {
  url: string;
  groupId: string;
  name: string;
  language: string;
  isDefault: boolean;
  forced: boolean;
  attributes: Record<string, string>;
}

export interface MediaPlaylist {
  segments: HlsSegment[];
  warnings: string[];
  mediaSequence: number;
  targetDuration: number;
  endList: boolean;
  playlistType: string;
  duration: number;
  hasMap: boolean;
  hasTs: boolean;
  ext: 'mp4' | 'ts';
  mime: string;
  hasUnsupportedEncryption: boolean;
  variant?: HlsVariant;
}

export interface DirectFilePlan {
  url: string;
  length: number;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleFormat = 'srt' | 'vtt' | 'txt';
export type SubtitleSource = 'panopto' | 'hls' | 'network';

export interface SubtitleTrack {
  id: string;
  label: string;
  languageCode: string;
  source: SubtitleSource;
  cues?: SubtitleCue[];
  url?: string;
  format?: 'vtt' | 'srt' | 'unknown';
}

export interface PanoptoCaptionInfo {
  Language: number;
  ShowDisclaimer?: boolean;
}

export interface PanoptoDeliveryInfo {
  Delivery?: {
    AvailableCaptions?: PanoptoCaptionInfo[];
  };
  AvailableCaptions?: PanoptoCaptionInfo[];
}

export interface PanoptoCaptionEvent {
  Caption?: string;
  Text?: string;
  Time?: number;
  StartTime?: number;
  Start?: number;
  AbsoluteTime?: number;
  CaptionDuration?: number;
  Duration?: number;
}

export interface DownloadSink {
  kind: 'file' | 'memory';
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface SubtitleUiState {
  loading: boolean;
  error: string;
}
