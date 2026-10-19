"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  FilesetResolver, InteractiveSegmenter,
} from "@mediapipe/tasks-vision";
import {
  ArrowDownToLine, Check, FileImage, ImagePlus, LoaderCircle,
  MousePointer2, RotateCcw, ShieldCheck, Sparkles, Upload, X,
} from "lucide-react";

type Item = {
  id: string;
  file: File;
  originalUrl: string;
  resultUrl?: string;
  status: "queued" | "processing" | "done" | "error";
  error?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const MAX_FILES = 20;
const MAX_SIZE = 25 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const MEDIAPIPE_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const INTERACTIVE_MODEL = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task";

function isSupportedImage(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return ACCEPTED.includes(file.type.toLowerCase()) || ACCEPTED_EXTENSIONS.includes(extension);
}

function outputName(name: string) {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return `${stem || "image"}-no-bg.png`;
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [selectingId, setSelectingId] = useState<string>();
  const [interactiveBusy, setInteractiveBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  const segmenterRef = useRef<InteractiveSegmenter | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => {
    itemsRef.current.forEach((item) => {
      URL.revokeObjectURL(item.originalUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    segmenterRef.current?.close();
  }, []);

  const completed = items.filter((item) => item.status === "done").length;
  const errors = items.filter((item) => item.status === "error").length;
  const locked = busy || interactiveBusy;
  const canAdd = !locked && items.length < MAX_FILES;

  function addFiles(fileList: FileList | File[]) {
    setMessage("");
    const incoming = Array.from(fileList);
    const remaining = MAX_FILES - itemsRef.current.length;
    if (remaining <= 0) {
      setMessage(`You can process up to ${MAX_FILES} images per batch.`);
      return;
    }
    const additions: Item[] = [];
    const problems: string[] = [];
    for (const file of incoming) {
      if (additions.length >= remaining) break;
      if (!isSupportedImage(file)) {
        problems.push(`${file.name}: use JPG, PNG, or WEBP.`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        problems.push(`${file.name}: file is larger than 25 MB.`);
        continue;
      }
      additions.push({
        id: crypto.randomUUID(),
        file,
        originalUrl: URL.createObjectURL(file),
        status: "queued",
      });
    }
    if (additions.length) {
      setItems((current) => [...current, ...additions]);
    }
    if (problems.length) setMessage(problems.slice(0, 3).join(" "));
    if (incoming.length > remaining) setMessage(`Only the first ${remaining} eligible images could be added.`);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  }

  function removeItem(id: string) {
    if (locked) return;
    setItems((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) {
        URL.revokeObjectURL(item.originalUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      }
      return current.filter((entry) => entry.id !== id);
    });
  }

  function clearAll() {
    if (locked) return;
    items.forEach((item) => {
      URL.revokeObjectURL(item.originalUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    setItems([]);
    setMessage("");
  }

  async function getInteractiveSegmenter() {
    if (segmenterRef.current) return segmenterRef.current;
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    segmenterRef.current = await InteractiveSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: INTERACTIVE_MODEL, delegate: "CPU" },
    });
    return segmenterRef.current;
  }

  async function selectSubject(
    item: Item,
    event: React.MouseEvent<HTMLImageElement>,
  ) {
    if (selectingId !== item.id || interactiveBusy) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };

    setInteractiveBusy(true);
    setSelectingId(undefined);
    setMessage("Loading Google MediaPipe and selecting the clicked subject…");
    setItems((current) => current.map((entry) =>
      entry.id === item.id ? { ...entry, status: "processing", error: undefined } : entry
    ));

    try {
      const source = new Image();
      source.src = item.originalUrl;
      await source.decode();

      const scale = Math.min(1, 2048 / Math.max(source.naturalWidth, source.naturalHeight));
      const width = Math.max(1, Math.round(source.naturalWidth * scale));
      const height = Math.max(1, Math.round(source.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable in this browser.");
      context.drawImage(source, 0, 0, width, height);

      // MediaPipe writes native informational messages (for example WebGL
      // context details) through console.error. Next's development overlay
      // mistakes those messages for application failures, so ignore only its
      // timestamped I/W native logs while this synchronous call runs.
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        const text = args.map(String).join(" ");
        if (
          /^[IW]\d{4}\s+\d{2}:\d{2}:\d{2}/.test(text)
          || text.startsWith("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")
        ) return;
        originalConsoleError(...args);
      };

      let mask;
      try {
        const segmenter = await getInteractiveSegmenter();
        segmenter.setImage(canvas);
        mask = segmenter.segment([{
          brushMode: 1,
          point: [point],
          isCompleted: true,
        }]);
      } finally {
        console.error = originalConsoleError;
      }
      const confidence = mask.getAsFloat32Array();
      const pixels = context.getImageData(0, 0, width, height);

      for (let index = 0; index < confidence.length; index += 1) {
        const value = Math.max(0, Math.min(1, (confidence[index] - 0.3) / 0.4));
        const smoothAlpha = value * value * (3 - 2 * value);
        pixels.data[index * 4 + 3] = Math.round(smoothAlpha * 255);
      }
      context.putImageData(pixels, 0, 0);
      mask.close();

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((output) => output ? resolve(output) : reject(new Error("Could not create the PNG.")), "image/png");
      });
      const resultUrl = URL.createObjectURL(blob);
      setItems((current) => current.map((entry) => {
        if (entry.id !== item.id) return entry;
        if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
        return { ...entry, status: "done", resultUrl };
      }));
      setMessage("Selected subject processed locally with Google MediaPipe.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Interactive segmentation failed.";
      setItems((current) => current.map((entry) =>
        entry.id === item.id ? { ...entry, status: "error", error: detail } : entry
      ));
      setMessage(`Could not select that subject: ${detail}`);
    } finally {
      setInteractiveBusy(false);
    }
  }

  async function processBatch() {
    if (!items.length || locked || !API_BASE) return;
    setBusy(true);
    setMessage("");
    let doneCount = 0;
    const queue = [...items];
    for (const queued of queue) {
      setItems((current) => current.map((item) =>
        item.id === queued.id ? { ...item, status: "processing", error: undefined } : item
      ));
      try {
        const body = new FormData();
        body.append("file", queued.file);
        const response = await fetch(`${API_BASE}/remove`, { method: "POST", body });
        if (!response.ok) {
          let detail = `Request failed (${response.status}).`;
          try {
            const payload = await response.json();
            if (payload.detail) detail = payload.detail;
          } catch {}
          throw new Error(detail);
        }
        const blob = await response.blob();
        if (!blob.type.includes("image/png")) throw new Error("The server returned an unexpected file.");
        const resultUrl = URL.createObjectURL(blob);
        setItems((current) => current.map((item) => {
          if (item.id !== queued.id) return item;
          if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
          return { ...item, status: "done", resultUrl };
        }));
        doneCount += 1;
      } catch (error) {
        const detail = error instanceof Error
          ? error.message
          : "Could not reach the local backend. Is it running on port 8000?";
        setItems((current) => current.map((item) =>
          item.id === queued.id ? { ...item, status: "error", error: detail } : item
        ));
      }
    }
    setBusy(false);
    setMessage(`Finished. ${doneCount} image${doneCount === 1 ? "" : "s"} processed${queue.length - doneCount ? `, ${queue.length - doneCount} failed` : ""}.`);
  }

  function downloadOne(item: Item) {
    if (!item.resultUrl) return;
    const anchor = document.createElement("a");
    anchor.href = item.resultUrl;
    anchor.download = outputName(item.file.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function downloadZip() {
    const ready = items.filter((item) => item.status === "done" && item.resultUrl);
    if (!ready.length || zipBusy) return;
    setZipBusy(true);
    try {
      const zip = new JSZip();
      for (const item of ready) {
        const response = await fetch(item.resultUrl!);
        const blob = await response.blob();
        let name = outputName(item.file.name);
        if (zip.file(name)) {
          const stem = name.replace(/\.png$/, "");
          name = `${stem}-${item.id.slice(0, 6)}.png`;
        }
        zip.file(name, blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "background-removed-images.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("Could not create the ZIP. Try downloading images individually.");
    } finally {
      setZipBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-6 sm:px-8 lg:px-10">
      <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
        <a href="#" className="flex items-center gap-2.5 font-bold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--green)]">
            <Sparkles size={19} />
          </span>
          <span className="text-lg">clearcut<span className="text-[#8b927f]">.</span></span>
        </a>
        <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/80 px-3 py-2 text-xs font-medium text-[#53604a]">
          <ShieldCheck size={15} />
          Local processing
        </div>
      </header>

      <section className="mx-auto max-w-3xl pb-8 pt-14 text-center sm:pt-20">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#dce5cb] bg-[#f0f6e6] px-3 py-1.5 text-xs font-semibold text-[#4e6239]">
          <span className="h-2 w-2 rounded-full bg-[#8cbf3e]" />
          FREE · OPEN SOURCE · NO ACCOUNT
        </div>
        <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.055em] sm:text-6xl">
          Your images.
          <br />
          <span className="text-[#79846d]">Without the background.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[var(--muted)] sm:text-lg">
          Remove backgrounds from a whole batch in one go. Keep your transparent PNGs, without sending images to a cloud API.
        </p>
      </section>

      <section className="mx-auto max-w-4xl">
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
          className={`rounded-3xl border-2 border-dashed p-7 text-center transition sm:p-12 ${
            dragging ? "border-[#7e9e46] bg-[#f0f7e3]" : "border-[#d8ddcf] bg-white/75"
          }`}
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--green)]">
            <ImagePlus size={27} strokeWidth={1.8} />
          </div>
          <h2 className="mt-5 text-lg font-semibold">Drop your images here</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">JPG, PNG or WEBP · Up to 25 MB each · Maximum 20 images</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={!canAdd}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3b4336]"
            >
              <Upload size={16} /> Choose images
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/png,image/jpeg,image/webp"
              multiple
              onChange={onInputChange}
              className="hidden"
            />
            <span className="text-xs text-[#93998c]">Your files stay on this device</span>
          </div>
        </div>

        {message && (
          <div role="status" className="mt-4 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[#50594a]">
            {message}
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Your batch <span className="ml-1 text-sm font-normal text-[var(--muted)]">({items.length}/{MAX_FILES})</span></h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {items.length ? `${completed} completed · ${items.filter(i => i.status === "queued").length} queued · ${errors} failed` : "Add images to get started"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={clearAll} disabled={!items.length || locked} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm font-medium hover:bg-[#f4f5ef]">
              <RotateCcw size={15} /> Clear
            </button>
            <button onClick={downloadZip} disabled={!completed || locked || zipBusy} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm font-medium hover:bg-[#f4f5ef]">
              {zipBusy ? <LoaderCircle className="animate-spin" size={15} /> : <ArrowDownToLine size={15} />}
              Download all (.zip)
            </button>
            {API_BASE && (
              <button onClick={processBatch} disabled={!items.some(i => i.status === "queued" || i.status === "error") || locked} className="inline-flex items-center gap-2 rounded-xl bg-[var(--green)] px-4 py-2.5 text-sm font-semibold text-[#26321c] hover:bg-[#b9e45a]">
                {busy ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}
                {busy ? "Removing backgrounds…" : "Automatic removal"}
              </button>
            )}
          </div>
        </div>

        {busy && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e7eadf]">
            <div className="h-full rounded-full bg-[#a4d64d] transition-all" style={{ width: `${items.length ? ((completed + errors) / items.length) * 100 : 0}%` }} />
          </div>
        )}

        {items.length > 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_5px_20px_rgba(40,50,30,0.035)]">
                <div className="relative grid grid-cols-2">
                  <div className="border-r border-[var(--line)]">
                    <div className="flex h-9 items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[.1em] text-[#7d8477]">
                      Original <FileImage size={13} />
                    </div>
                    <div className="flex h-40 items-center justify-center bg-[#f4f5f0] p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.originalUrl}
                        alt={`Original ${item.file.name}`}
                        onClick={(event) => selectSubject(item, event)}
                        className={`max-h-full max-w-full object-contain ${selectingId === item.id ? "cursor-crosshair ring-2 ring-[#8cbf3e]" : ""}`}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex h-9 items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[.1em] text-[#7d8477]">
                      Result
                      {item.status === "done" && <Check size={13} className="text-[#66952e]" />}
                    </div>
                    <div className="checkerboard flex h-40 items-center justify-center p-2">
                      {item.status === "done" && item.resultUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.resultUrl} alt={`Background removed ${item.file.name}`} className="max-h-full max-w-full object-contain" />
                      ) : item.status === "processing" ? (
                        <div className="flex flex-col items-center gap-2 text-xs text-[#647054]"><LoaderCircle className="animate-spin" size={22} />Processing</div>
                      ) : item.status === "error" ? (
                        <div className="px-2 text-center text-xs text-red-700">Couldn’t process</div>
                      ) : (
                        <span className="px-2 text-center text-xs text-[#8b9185]">Transparent preview appears here</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p title={item.file.name} className="truncate text-xs font-semibold">{item.file.name}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {item.status === "done" ? "Ready to download" : item.status === "processing" ? "AI is working…" : item.status === "error" ? (item.error || "Failed") : `${(item.file.size / 1024 / 1024).toFixed(2)} MB · Queued`}
                    </p>
                  </div>
                  <button
                    title="Select one subject"
                    disabled={locked && selectingId !== item.id}
                    onClick={() => {
                      setSelectingId((current) => current === item.id ? undefined : item.id);
                      setMessage("Click the person or object you want to keep in the Original preview.");
                    }}
                    className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold ${
                      selectingId === item.id ? "bg-[#dff3b4] text-[#34451f]" : "bg-[#f1f2ec] text-[#626a5b] hover:bg-[#e7eadf]"
                    }`}
                  >
                    {interactiveBusy && item.status === "processing" ? <LoaderCircle className="animate-spin" size={14} /> : <MousePointer2 size={14} />}
                    {selectingId === item.id ? "Click subject" : "Pick subject"}
                  </button>
                  {item.status === "done" ? (
                    <button title="Download PNG" onClick={() => downloadOne(item)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--green)] hover:bg-[#b9e45a]"><ArrowDownToLine size={16} /></button>
                  ) : !busy ? (
                    <button title="Remove image" onClick={() => removeItem(item.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#7d8477] hover:bg-[#f1f2ec]"><X size={16} /></button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] py-12 text-center">
            <FileImage className="mx-auto text-[#a5aa9c]" size={26} />
            <p className="mt-3 text-sm font-medium text-[#626a5b]">Your images will show up here</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Original and transparent result side by side</p>
          </div>
        )}
      </section>

      <footer className="mx-auto mt-16 flex max-w-4xl flex-col items-center justify-between gap-3 border-t border-[var(--line)] py-6 text-xs text-[#858b7d] sm:flex-row">
        <span>© 2026 clearcut. A tiny tool that does one thing well.</span>
        <span className="flex items-center gap-1.5"><ShieldCheck size={14} /> Processed locally on your machine</span>
      </footer>
    </main>
  );
}
