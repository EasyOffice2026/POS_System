// Where photos live: a public bucket of Supabase Storage, reached through its REST API with the
// project's service role key, so no package is needed (docs/deployment.md, "Images"). Without the
// settings, uploads are refused and links typed by hand still work.

export interface StoredFile {
  url: string;
}

export interface Storage {
  enabled: boolean;
  // Puts the bytes at the path and answers the public address to show them from.
  put(path: string, bytes: Uint8Array, contentType: string): Promise<StoredFile>;
}

export interface StorageOptions {
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
  bucket: string;
}

export function createSupabaseStorage({
  supabaseUrl,
  serviceRoleKey,
  bucket,
}: StorageOptions): Storage {
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      enabled: false,
      put() {
        return Promise.reject(
          new Error(
            'Storage is not set up: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing.',
          ),
        );
      },
    };
  }
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey };
  let bucketReady: Promise<void> | null = null;

  // The bucket is made public the first time, so the photos can be shown by their address.
  const ensureBucket = async () => {
    const res = await fetch(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers });
    if (res.ok) return;
    if (res.status !== 404 && res.status !== 400) {
      throw new Error(`Storage answered ${res.status} when asked for the bucket "${bucket}".`);
    }
    const made = await fetch(`${base}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
    });
    if (!made.ok && made.status !== 409) {
      throw new Error(
        `Storage could not make the bucket "${bucket}": ${made.status} ${await made.text()}`,
      );
    }
  };

  return {
    enabled: true,
    async put(path, bytes, contentType) {
      bucketReady ??= ensureBucket().catch((error: unknown) => {
        bucketReady = null;
        throw error;
      });
      await bucketReady;
      const target = path.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${target}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' },
        body: bytes,
      });
      if (!res.ok) throw new Error(`Storage refused the file: ${res.status} ${await res.text()}`);
      return { url: `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${target}` };
    },
  };
}

// For tests: keeps the files in memory and answers made-up addresses.
export function createMemoryStorage(): Storage & {
  files: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    enabled: true,
    files,
    put(path, bytes, contentType) {
      files.set(path, { bytes, contentType });
      return Promise.resolve({ url: `https://files.test/${path}` });
    },
  };
}
