export type Page =
  | 'browser'
  | 'domain-intel'
  | 'person-intel'
  | 'ip-intel'
  | 'web-intel'
  | 'recon'
  | 'network'
  | 'http-client'
  | 'vuln-scanner'
  | 'subdomain-enum'
  | 'osint-lookup'
  | 'osint-modules'
  | 'cyber-tools'
  | 'settings'
  | 'passwords'
  | 'privacy-dashboard'
  | 'bookmarks'
  | 'canvas';

export type TabSession = 'normal' | 'private';

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  page: Page;
  session: TabSession;
  previewImage?: string | null;
}

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  progress: number;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled';
  timestamp: Date;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  createdAt: Date;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  timestamp: Date;
}

export interface CredentialEntry {
  id: string;
  site: string;
  siteUrl: string;
  username: string;
  password: string;
  favicon: string | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommandResult {
  command: string;
  output: string;
  timestamp: Date;
  success: boolean;
}

export interface ReconTarget {
  host: string;
  ip: string;
  ports: PortInfo[];
  os?: string;
  status: 'alive' | 'dead' | 'unknown';
}

export interface PortInfo {
  port: number;
  protocol: string;
  service: string;
  state: 'open' | 'closed' | 'filtered';
  version?: string;
}

export interface NetworkNode {
  id: string;
  ip: string;
  mac?: string;
  hostname?: string;
  type: 'router' | 'host' | 'server' | 'device' | 'unknown';
  connections: string[];
}

export interface OSINTResult {
  source: string;
  type: string;
  data: Record<string, string>;
  timestamp: Date;
}

export interface SiteInfo {
  url: string;
  secure: boolean;
  certIssuer?: string;
  certSubject?: string;
  certExpiry?: string;
}

export interface FindMatch {
  index: number;
  total: number;
}

export interface AdBlockerStats {
  enabled: boolean;
  blockCount: number;
  filterCount: number;
}

export interface PrivacySiteStats {
  hostname: string;
  count: number;
  blocked: number;
  categories: { ads: number; analytics: number; social: number; crypto: number; other: number };
  domains: Record<string, { count: number; category: string }>;
  recent: Array<{ url: string; domain: string; category: string; timestamp: number; siteHost?: string }>;
  lastBlockedAt: number | null;
}

export interface PrivacyAllStats {
  enabled: boolean;
  blockCount: number;
  filterCount: number;
  perSite: PrivacySiteStats[];
  disabledSites: string[];
  recentGlobal: Array<{ url: string; domain: string; category: string; timestamp: number; siteHost?: string }>;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  authType: 'none' | 'bearer' | 'basic' | 'api-key';
  authToken: string;
  contentType: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
}

export interface SubdomainEntry {
  subdomain: string;
  ip: string;
  status: 'alive' | 'dead' | 'unknown';
  ports: number[];
  source: string;
}

export interface VulnCheck {
  id: string;
  name: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  result?: string;
  status: 'pending' | 'running' | 'completed';
}

export interface LookupResult {
  type: string;
  query: string;
  data: Record<string, string>;
  raw: string;
  timestamp: Date;
}

