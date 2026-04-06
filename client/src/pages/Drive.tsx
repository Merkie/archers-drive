import { createSignal, createResource, For, Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { api } from "../lib/api";

interface DriveFolder {
  id: string;
  name: string;
}
interface DriveFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
}
interface DriveListing {
  folderId: string | null;
  breadcrumbs: Array<{ id: string | null; name: string }>;
  folders: DriveFolder[];
  files: DriveFile[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function Drive() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [listing, { refetch }] = createResource(
    () => ({ folderId: params.id }),
    async ({ folderId }) => {
      const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
      return api.get<DriveListing>(`/drive/list${qs}`);
    }
  );

  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function handleUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (params.id) form.append("folderId", params.id);
      await api.postForm("/drive/files/upload", form);
      input.value = "";
      refetch();
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleNewFolder() {
    const name = prompt("Folder name");
    if (!name) return;
    try {
      await api.post("/drive/folders", { name, parentId: params.id ?? null });
      refetch();
    } catch (err: any) {
      setError(err.message ?? "Could not create folder");
    }
  }

  async function deleteFile(file: DriveFile) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    await api.delete(`/drive/files/${file.id}`);
    refetch();
  }

  async function deleteFolder(folder: DriveFolder) {
    if (!confirm(`Delete folder "${folder.name}" and everything in it?`)) return;
    await api.delete(`/drive/folders/${folder.id}`);
    refetch();
  }

  return (
    <div class="max-w-5xl mx-auto px-6 py-8">
      <Show when={listing()} fallback={<p class="text-white/40 text-sm">Loading…</p>}>
        {(data) => (
          <>
            <div class="flex items-center justify-between mb-6">
              <nav class="flex items-center gap-1 text-sm text-white/60">
                <For each={data().breadcrumbs}>
                  {(crumb, i) => (
                    <>
                      {i() > 0 && <span class="text-white/30">/</span>}
                      <button
                        class="hover:text-white"
                        onClick={() => navigate(crumb.id ? `/folders/${crumb.id}` : "/")}
                      >
                        {crumb.name}
                      </button>
                    </>
                  )}
                </For>
              </nav>
              <div class="flex items-center gap-2">
                <button
                  onClick={handleNewFolder}
                  class="text-sm px-3 py-1.5 rounded-md border border-white/15 hover:bg-white/[0.05]"
                >
                  New folder
                </button>
                <label class="text-sm px-3 py-1.5 rounded-md bg-white text-black font-medium cursor-pointer">
                  {uploading() ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    class="hidden"
                    onChange={handleUpload}
                    disabled={uploading()}
                  />
                </label>
              </div>
            </div>

            {error() && <p class="text-red-400 text-sm mb-4">{error()}</p>}

            <Show
              when={data().folders.length > 0 || data().files.length > 0}
              fallback={
                <div class="border border-dashed border-white/10 rounded-xl p-12 text-center text-white/40 text-sm">
                  This folder is empty. Upload a file to get started.
                </div>
              }
            >
              <div class="border border-white/10 rounded-xl divide-y divide-white/10">
                <For each={data().folders}>
                  {(folder) => (
                    <div class="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02]">
                      <button
                        class="flex items-center gap-3 text-left flex-1"
                        onClick={() => navigate(`/folders/${folder.id}`)}
                      >
                        <span class="text-white/70">📁</span>
                        <span class="text-white">{folder.name}</span>
                      </button>
                      <button
                        onClick={() => deleteFolder(folder)}
                        class="text-xs text-white/40 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </For>
                <For each={data().files}>
                  {(file) => (
                    <div class="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02]">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        class="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <span class="text-white/70">📄</span>
                        <span class="text-white truncate">{file.name}</span>
                        <span class="text-xs text-white/40 ml-2">{formatSize(file.size)}</span>
                      </a>
                      <button
                        onClick={() => deleteFile(file)}
                        class="text-xs text-white/40 hover:text-red-400 ml-3"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
