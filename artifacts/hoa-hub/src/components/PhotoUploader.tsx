import { useRef, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { c } from "@/lib/theme";
import { useRequestWorkOrderUploadUrl } from "@workspace/api-client-react";

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

export type StagedPhoto = {
  file: File;
  previewUrl: string;
};

export type UploadedPhoto = {
  storageKey: string;
  mimeType: string;
  size: number;
  name: string;
};

/**
 * Picks photos and stages them locally — does not upload to the server.
 * Use this for the resident submit form, where uploads happen after the
 * work-order is created.
 */
export function PhotoStager({
  photos,
  onChange,
  max = MAX_FILES,
}: {
  photos: StagedPhoto[];
  onChange: (next: StagedPhoto[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const incoming = Array.from(e.target.files ?? []);
    if (incoming.length === 0) return;
    const next = [...photos];
    for (const f of incoming) {
      if (next.length >= max) {
        setError(`At most ${max} photos`);
        break;
      }
      if (!ACCEPTED_MIMES.has(f.type) && !/\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)) {
        setError(`Unsupported file: ${f.name}`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} exceeds 10 MB`);
        continue;
      }
      next.push({ file: f, previewUrl: URL.createObjectURL(f) });
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(idx: number) {
    const removed = photos[idx];
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    onChange(photos.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2.5">
        {photos.map((p, i) => (
          <div key={i} className="relative h-20 w-20 rounded-lg overflow-hidden border" style={{ borderColor: c.border }}>
            <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              aria-label="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-20 w-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 hover:bg-slate-50"
            style={{ borderColor: c.border, color: c.inkMute }}
          >
            <Upload className="h-4 w-4" />
            <span className="text-[10.5px]">Add photo</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={handlePick}
        className="hidden"
      />
      <div className="text-[11px] mt-1.5" style={{ color: c.inkMute }}>
        Up to {max} photos · jpg / png / heic / webp · max 10 MB each
      </div>
      {error && <div className="text-[11px] mt-0.5" style={{ color: c.rose }}>{error}</div>}
    </div>
  );
}

/**
 * Uploads a single staged photo via presigned URL + register-attachment, in sequence.
 */
export async function uploadPhotoForWorkOrder({
  workOrderId,
  staged,
  requestUrl,
  registerAttachment,
}: {
  workOrderId: string;
  staged: StagedPhoto;
  requestUrl: (args: { name: string; size: number; contentType: string }) => Promise<{
    uploadURL: string;
    objectPath: string;
  }>;
  registerAttachment: (args: {
    workOrderId: string;
    storageKey: string;
    mimeType: string;
    size: number;
    name: string;
  }) => Promise<unknown>;
}): Promise<void> {
  const { file } = staged;
  const contentType = file.type || "image/jpeg";
  const url = await requestUrl({ name: file.name, size: file.size, contentType });
  const putRes = await fetch(url.uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  });
  if (!putRes.ok) throw new Error("Upload failed");
  await registerAttachment({
    workOrderId,
    storageKey: url.objectPath,
    mimeType: contentType,
    size: file.size,
    name: file.name,
  });
}

/**
 * Live uploader that picks files and immediately uploads them to a known
 * work-order, calling `onUploaded` after each success so callers can refresh
 * the gallery / events feed.
 */
export function LivePhotoUploader({
  workOrderId,
  onUploaded,
}: {
  workOrderId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestUploadUrl = useRequestWorkOrderUploadUrl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const incoming = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (incoming.length === 0) return;

    setBusy(true);
    try {
      for (const f of incoming) {
        if (!ACCEPTED_MIMES.has(f.type) && !/\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)) {
          setError(`Skipped unsupported file: ${f.name}`);
          continue;
        }
        if (f.size > MAX_BYTES) {
          setError(`${f.name} exceeds 10 MB`);
          continue;
        }
        const contentType = f.type || "image/jpeg";
        const url = await requestUploadUrl.mutateAsync({
          id: workOrderId,
          data: { name: f.name, size: f.size, contentType },
        });
        const putRes = await fetch(url.uploadURL, {
          method: "PUT",
          body: f,
          headers: { "Content-Type": contentType },
        });
        if (!putRes.ok) throw new Error(`Upload failed for ${f.name}`);
        const res = await fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/attachments`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey: url.objectPath,
            mimeType: contentType,
            size: f.size,
            name: f.name,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to register attachment");
        }
        onUploaded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50 disabled:opacity-60"
        style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {busy ? "Uploading…" : "Add photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={handlePick}
        className="hidden"
      />
      {error && <div className="text-[11px] mt-1" style={{ color: c.rose }}>{error}</div>}
    </div>
  );
}
