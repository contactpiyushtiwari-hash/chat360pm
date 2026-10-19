import { GraphError } from '../http/errors';
import {
  PreconditionFailedError,
  type DocStore,
  type StoredDoc,
  type WriteCondition,
} from '../ports';
import { toGraphError, type GraphClient } from './client';

/** Encodes each path segment for Graph path-based addressing (`root:/a/b:`). */
export function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

interface DriveItem {
  id: string;
  eTag: string;
  webUrl: string;
  '@microsoft.graph.downloadUrl'?: string;
  folder?: unknown;
  name: string;
}

/**
 * JSON documents and files in one OneDrive / SharePoint drive, accessed app-only.
 * Concurrency control uses the driveItem eTag: writes send `If-Match`, and OneDrive answers 412
 * if someone changed the file since it was read. Creates use conflictBehavior=fail (409 if present).
 */
export class GraphDocStore implements DocStore {
  constructor(
    private readonly graph: GraphClient,
    private readonly driveId: string,
    private readonly rootPath: string,
    private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) =>
      fetch(u, i),
  ) {}

  private itemPath(path: string) {
    return `/drives/${encodeURIComponent(this.driveId)}/root:/${encodePath(`${this.rootPath}/${path}`)}`;
  }

  async getJson<T>(path: string): Promise<StoredDoc<T> | null> {
    const res = await this.graph.raw({
      path: `${this.itemPath(path)}?$select=id,eTag,webUrl,name,@microsoft.graph.downloadUrl`,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await toGraphError(res);
    const item = (await res.json()) as DriveItem;
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw new GraphError(502, 'no_download_url', `No download URL for ${path}`);
    // The download URL is pre-authenticated and short-lived; no bearer token is sent to it.
    const content = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!content.ok)
      throw new GraphError(content.status, 'download_failed', `Download failed for ${path}`);
    return { data: (await content.json()) as T, etag: item.eTag };
  }

  async putJson<T>(path: string, data: T, condition: WriteCondition): Promise<{ etag: string }> {
    const r = await this.put(
      path,
      new TextEncoder().encode(JSON.stringify(data, null, 1)),
      'application/json',
      condition,
    );
    return { etag: r.etag };
  }

  async putFile(path: string, bytes: Uint8Array, contentType: string, condition: WriteCondition) {
    return this.put(path, bytes, contentType, condition);
  }

  private async put(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    condition: WriteCondition,
  ) {
    const create = 'ifNoneMatch' in condition;
    const res = await this.graph.raw({
      method: 'PUT',
      path: `${this.itemPath(path)}:/content${create ? '?@microsoft.graph.conflictBehavior=fail' : ''}`,
      rawBody: bytes,
      headers: {
        'Content-Type': contentType,
        ...(create ? {} : { 'If-Match': condition.ifMatch }),
      },
    });
    if (res.status === 412 || (create && res.status === 409)) {
      throw new PreconditionFailedError(`${path} changed concurrently`);
    }
    if (!res.ok) throw await toGraphError(res);
    const item = (await res.json()) as DriveItem;
    return { itemId: item.id, webUrl: item.webUrl, etag: item.eTag };
  }

  async listFolders(path: string): Promise<string[]> {
    const names: string[] = [];
    let next: string | null = `${this.itemPath(path)}:/children?$select=name,folder&$top=200`;
    while (next) {
      const res = await this.graph.raw({ path: next });
      if (res.status === 404) return names;
      if (!res.ok) throw await toGraphError(res);
      const body = (await res.json()) as { value: DriveItem[]; '@odata.nextLink'?: string };
      names.push(...body.value.filter((v) => v.folder).map((v) => v.name));
      next =
        body['@odata.nextLink']?.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') ?? null;
    }
    return names;
  }
}
