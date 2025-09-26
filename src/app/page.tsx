/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
"use client";
import React, { useEffect, useRef, useState } from "react";
import defaultLogo from "../../public/default_logo.png";
import Image from "next/image";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type SourceMode = "camera" | "gallery";
type Facing = "user" | "environment";
type OSMReverseResp = { display_name?: string };
type OSMSearchItem = { display_name: string };

const DEFAULT_LOGO = defaultLogo;
const DEFAULT_ADDRESS =
  "Yayasan Widya Dharma, Sukasada, Kabupaten Buleleng, Bali, 81161";

// ===== Helpers =====
function coverRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const s = Math.max(dstW / srcW, dstH / srcH);
  const dw = Math.floor(srcW * s);
  const dh = Math.floor(srcH * s);
  const dx = Math.floor((dstW - dw) / 2);
  const dy = Math.floor((dstH - dh) / 2);
  return { dw, dh, dx, dy };
}
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxWidth) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function useLatest<T>(v: T) {
  const r = useRef(v);
  useEffect(() => {
    r.current = v;
  }, [v]);
  return r;
}
function getFontSizes(base: number) {
  const padOuter = Math.max(base * 0.05, 40);
  const gap = Math.max(base * 0.012, 10);
  return {
    padOuter,
    gap,
    logoSize: Math.max(base * 0.15, 85),
    timeFont: Math.max(base * 0.1, 50),
    metaFont: Math.max(base * 0.04, 16),
    addrFont: Math.max(base * 0.03, 12),
    barW: Math.max(base * 0.01, 6),
    addrLineGap(addrFont: number) {
      return Math.floor(addrFont * 0.2);
    },
  };
}
function getAvgBrightness(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  try {
    const imgData = ctx.getImageData(x, y, w, h);
    let total = 0;
    const step = 4 * 10; // sampling tiap 10 pixel biar cepat
    for (let i = 0; i < imgData.data.length; i += step) {
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      total += 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const count = imgData.data.length / step;
    return total / count;
  } catch {
    return 255;
  }
}

// ===== Component =====
export default function TimestampWatermarkPage() {
  const [facing, setFacing] = useState<Facing>("user");
  const [mode, setMode] = useState<SourceMode>("camera");
  const [isCamActive, setIsCamActive] = useState(false);
  const [position, setPosition] = useState<Corner>("bottom-left");
  const [dateISO, setDateISO] = useState("");
  const [timeText, setTimeText] = useState("");
  const [dateText, setDateText] = useState("");
  const [dayText, setDayText] = useState("");
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(DEFAULT_LOGO.src);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OSMSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const timeRef = useLatest(timeText);
  const dateRef = useLatest(dateText);
  const dayRef = useLatest(dayText);
  const addressRef = useLatest(address);
  const positionRef = useLatest(position);
  const getDPR = () => Math.max(1, window.devicePixelRatio || 1);

  useEffect(() => {
    const now = new Date();

    // ⏰ Waktu default harus "HH:MM"
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setTimeText(`${hh}:${mm}`);

    const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
    setDateISO(iso);

    setDateText(
      new Intl.DateTimeFormat("id-ID", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(now)
    );

    setDayText(
      new Intl.DateTimeFormat("id-ID", { weekday: "long" }).format(now)
    );

    startCamera();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (mode === "camera") {
      stopCamera();
      void startCamera();
    }
  }, [facing]);

  useEffect(() => {
    if (!logoFile) return;
    const url = URL.createObjectURL(logoFile);
    setLogoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!logoUrl) {
      logoImgRef.current = null;
      return;
    }
    const img = new window.Image();
    img.onload = () => (logoImgRef.current = img);
    img.onerror = () => (logoImgRef.current = null);
    img.src = logoUrl;
  }, [logoUrl]);

  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries)
        resizeCanvas(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    startRAFLoop();
    return stopRAFLoop;
  }, [mode]);

  async function startCamera() {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false,
      });
      const v = videoRef.current!;
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "true");
      v.setAttribute("autoplay", "true");
      v.srcObject = stream;
      streamRef.current = stream;
      setIsCamActive(true);
      setMode("camera");
      try {
        await v.play();
      } catch {}
    } catch (e: any) {
      setError("Tidak bisa mengakses kamera: " + (e?.message ?? String(e)));
      setIsCamActive(false);
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCamActive(false);
  }

  function switchToGallery() {
    setMode("gallery");
    stopCamera();
  }

  function switchToCamera() {
    setMode("camera");
    startCamera();
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = imgRef.current!;
    img.onload = () => {};
    img.src = url;
    setMode("gallery");
    stopCamera();
  }

  async function useMyLocation() {
    try {
      setError(null);
      setSearching(true);
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
        { headers: { "Accept-Language": "id-ID" } }
      );
      const data = (await res.json()) as OSMReverseResp;
      setAddress(
        data?.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
      );
    } catch (e: any) {
      setError("Gagal mendapatkan lokasi: " + (e?.message ?? String(e)));
    } finally {
      setSearching(false);
    }
  }

  async function searchAddress() {
    if (!searchQuery.trim()) return;
    try {
      setSearching(true);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&addressdetails=1&limit=5`,
        { headers: { "Accept-Language": "id-ID" } }
      );
      const data = (await res.json()) as OSMSearchItem[];
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError("Gagal mencari alamat: " + (e?.message ?? String(e)));
    } finally {
      setSearching(false);
    }
  }

  function applyResult(name: string) {
    setAddress(name);
    setSearchResults([]);
  }

  function resizeCanvas(cssW: number, cssH: number) {
    const c = canvasRef.current!;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    const dpr = getDPR();
    const pxW = Math.max(2, Math.floor(cssW * dpr));
    const pxH = Math.max(2, Math.floor(cssH * dpr));
    if (c.width !== pxW || c.height !== pxH) {
      c.width = pxW;
      c.height = pxH;
    }
  }

  function startRAFLoop() {
    stopRAFLoop();
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopRAFLoop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  // Fungsi render watermark untuk capture
  function renderWatermark(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    opts: {
      curTime: string;
      curDate: string;
      curDay: string;
      curAddress: string;
      curPosition: Corner;
      logoImg: HTMLImageElement | null;
    }
  ) {
    const { curTime, curDate, curDay, curAddress, curPosition, logoImg } = opts;
    ctx.textBaseline = "top";

    const base = Math.min(cw, ch);
    const {
      padOuter,
      gap,
      logoSize,
      timeFont,
      metaFont,
      addrFont,
      barW,
      addrLineGap,
    } = getFontSizes(base);
    const lineGap = addrLineGap(addrFont);

    // hitung lebar
    ctx.font = `800 ${timeFont}px sans-serif`;
    const timeW = ctx.measureText(curTime).width;

    ctx.font = `600 ${metaFont}px sans-serif`;
    const rightColW = Math.max(
      ctx.measureText(curDate).width,
      ctx.measureText(curDay).width
    );

    const topRowW = timeW + gap + barW + gap + rightColW;
    const topRowH = timeFont;

    ctx.font = `400 ${addrFont}px sans-serif`;
    const addrLines = wrapLines(ctx, curAddress, Math.max(topRowW, logoSize));
    const addrH =
      addrLines.length * addrFont + (addrLines.length - 1) * lineGap;

    const blockW = Math.max(logoSize, topRowW);
    const blockH = logoSize + gap + topRowH + gap + addrH;

    let x = padOuter,
      y = padOuter;
    if (curPosition === "top-right") x = cw - padOuter - blockW;
    else if (curPosition === "bottom-left") y = ch - padOuter - blockH;
    else if (curPosition === "bottom-right") {
      x = cw - padOuter - blockW;
      y = ch - padOuter - blockH;
    }

    // Hitung brightness background area watermark
    const avgBrightness = getAvgBrightness(ctx, x, y, blockW, blockH);
    const textColor = avgBrightness < 128 ? "#fff" : "#000";

    ctx.fillStyle = textColor;

    // section 1: logo
    if (logoImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + logoSize / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.clip();
      const s = Math.min(
        logoSize / logoImg.naturalWidth,
        logoSize / logoImg.naturalHeight
      );
      const dW = Math.floor(logoImg.naturalWidth * s);
      const dH = Math.floor(logoImg.naturalHeight * s);
      ctx.drawImage(
        logoImg,
        x + (logoSize - dW) / 2,
        y + (logoSize - dH) / 2,
        dW,
        dH
      );
      ctx.restore();
    }

    // setelah gambar logo
    y += logoSize;

    // padding tambahan di bawah logo
    const logoBottomPad = gap * 2; // misal 2x gap standar
    y += logoBottomPad;

    // section 2: jam + garis + tanggal/hari
    ctx.font = `800 ${timeFont}px sans-serif`;
    ctx.fillText(curTime, x, y);

    const barX = x + timeW + gap;
    ctx.fillStyle = "#F5B700";
    ctx.fillRect(barX, y, barW, topRowH);

    ctx.fillStyle = textColor;
    ctx.font = `600 ${metaFont}px sans-serif`;
    ctx.fillText(curDate, barX + barW + gap, y);
    ctx.fillText(curDay, barX + barW + gap, y + metaFont + 4);

    y += topRowH + gap;

    // section 3: alamat
    ctx.font = `400 ${addrFont}px sans-serif`;
    addrLines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * (addrFont + lineGap));
    });
  }

  // Fungsi draw untuk preview kamera dengan watermark
  function draw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const cw = c.width,
      ch = c.height;
    ctx.clearRect(0, 0, cw, ch);

    // ===== Background kamera/galeri =====
    let srcEl: HTMLVideoElement | HTMLImageElement | null = null;
    let sW = 0,
      sH = 0;
    if (mode === "camera" && videoRef.current) {
      const v = videoRef.current;
      if (v.readyState >= 2 && v.videoWidth && v.videoHeight) {
        srcEl = v;
        sW = v.videoWidth;
        sH = v.videoHeight;
      }
    } else if (mode === "gallery" && imgRef.current) {
      const im = imgRef.current;
      if (im.complete && im.naturalWidth && im.naturalHeight) {
        srcEl = im;
        sW = im.naturalWidth;
        sH = im.naturalHeight;
      }
    }
    if (srcEl && sW && sH) {
      const { dw, dh, dx, dy } = coverRect(sW, sH, cw, ch);
      if (mode === "camera" && facing === "user") {
        ctx.save();
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(srcEl, dx, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(srcEl, dx, dy, dw, dh);
      }
    }

    // ===== Data watermark =====
    const curTime = timeRef.current;
    const curDate = dateRef.current;
    const curDay = dayRef.current;
    const curAddress = addressRef.current;
    const curPosition = positionRef.current;

    // ukuran proporsional (pakai helper biar sinkron sama capture)
    const base = Math.min(cw, ch);
    const {
      padOuter,
      gap,
      logoSize,
      timeFont,
      metaFont,
      addrFont,
      barW,
      addrLineGap,
    } = getFontSizes(base);
    const lineGap = addrLineGap(addrFont);

    // hitung lebar teks
    ctx.font = `800 ${timeFont}px sans-serif`;
    const timeW = ctx.measureText(curTime).width;

    ctx.font = `600 ${metaFont}px sans-serif`;
    const rightColW = Math.max(
      ctx.measureText(curDate).width,
      ctx.measureText(curDay).width
    );

    const topRowW = timeW + gap + barW + gap + rightColW;
    const topRowH = timeFont;

    ctx.font = `400 ${addrFont}px sans-serif`;
    const addrLines = wrapLines(ctx, curAddress, Math.max(topRowW, logoSize));
    const addrH =
      addrLines.length * addrFont + (addrLines.length - 1) * lineGap;

    const blockW = Math.max(logoSize, topRowW);
    const blockH = logoSize + gap + topRowH + gap + addrH;

    // posisi corner
    let x = padOuter,
      y = padOuter;
    if (curPosition === "top-right") {
      x = cw - padOuter - blockW;
    } else if (curPosition === "bottom-left") {
      y = ch - padOuter - blockH;
    } else if (curPosition === "bottom-right") {
      x = cw - padOuter - blockW;
      y = ch - padOuter - blockH;
    }

    // ===== Section 1: logo =====
    const logoImg = logoImgRef.current;
    if (logoImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + logoSize / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.clip();
      const s = Math.min(
        logoSize / logoImg.naturalWidth,
        logoSize / logoImg.naturalHeight
      );
      const dW = Math.floor(logoImg.naturalWidth * s);
      const dH = Math.floor(logoImg.naturalHeight * s);
      ctx.drawImage(
        logoImg,
        x + (logoSize - dW) / 2,
        y + (logoSize - dH) / 2,
        dW,
        dH
      );
      ctx.restore();
    }

    // Hitung brightness background area watermark
    const avgBrightness = getAvgBrightness(ctx, x, y, blockW, blockH);
    const textColor = avgBrightness < 128 ? "#fff" : "#000";

    // setelah gambar logo
    y += logoSize;

    // padding tambahan di bawah logo
    const logoBottomPad = gap * 2; // misal 2x gap standar
    y += logoBottomPad;

    // ===== Section 2: jam + tanggal/hari =====
    ctx.fillStyle = textColor;

    ctx.textBaseline = "top";

    ctx.font = `800 ${timeFont}px sans-serif`;
    ctx.fillText(curTime, x, y);
    const barX = x + timeW + gap;
    ctx.fillStyle = "#F5B700";
    ctx.fillRect(barX, y, barW, topRowH);

    ctx.fillStyle = textColor;

    // ctx.fillStyle = "#fff";
    ctx.font = `600 ${metaFont}px sans-serif`;
    ctx.fillText(curDate, barX + barW + gap, y);
    ctx.fillText(curDay, barX + barW + gap, y + metaFont + 4);

    y += topRowH + gap;

    // ===== Section 3: alamat =====
    ctx.font = `400 ${addrFont}px sans-serif`;
    ctx.fillStyle = textColor;

    addrLines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * (addrFont + lineGap));
    });
  }

  // === Capture ===
  function capture() {
    let srcEl: HTMLVideoElement | HTMLImageElement | null = null;
    let sW = 0,
      sH = 0;

    if (mode === "camera" && videoRef.current) {
      const v = videoRef.current;
      if (v.readyState >= 2 && v.videoWidth && v.videoHeight) {
        srcEl = v;
        sW = v.videoWidth;
        sH = v.videoHeight;
      }
    } else if (mode === "gallery" && imgRef.current) {
      const im = imgRef.current;
      if (im.complete && im.naturalWidth && im.naturalHeight) {
        srcEl = im;
        sW = im.naturalWidth;
        sH = im.naturalHeight;
      }
    }
    if (!srcEl || !sW || !sH) return;

    // ⬇️ Tetap 3:4 (HD) — silakan ubah 3000x4000 kalau mau lebih besar/kecil
    const targetW = 3000;
    const targetH = 4000;

    const off = document.createElement("canvas");
    off.width = targetW;
    off.height = targetH;
    const ctx = off.getContext("2d");
    if (!ctx) return;

    // HD rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Background (object-cover)
    const { dw, dh, dx, dy } = coverRect(sW, sH, targetW, targetH);
    if (mode === "camera" && facing === "user") {
      ctx.save();
      ctx.translate(targetW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(srcEl, dx, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(srcEl, dx, dy, dw, dh);
    }

    // ✅ Render watermark pakai fungsi yang sama dengan preview
    renderWatermark(ctx, targetW, targetH, {
      curTime: timeRef.current,
      curDate: dateRef.current,
      curDay: dayRef.current,
      curAddress: addressRef.current,
      curPosition: positionRef.current,
      logoImg: logoImgRef.current,
    });

    // Export JPEG
    const dataUrl = off.toDataURL("image/jpeg", 0.95);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${Date.now()}.jpg`;
    a.click();
  }

  // ================= RENDER =================
  return (
    <div className="min-h-screen bg-blue-50">
      <header className="sticky top-0 z-40 bg-white backdrop-blur shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Photime</h1>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMode("camera");
                switchToCamera();
              }}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border ${
                mode === "camera" ? "bg-gray-900 text-white" : "bg-white"
              }`}
            >
              Mode Kamera
            </button>
            <button
              onClick={switchToGallery}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border ${
                mode === "gallery" ? "bg-gray-900 text-white" : "bg-white"
              }`}
            >
              Unggah
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid lg:grid-cols-2 gap-6">
        {/* Preview Panel */}
        <section className="bg-white rounded-2xl p-4 relative overflow-hidden">
          <div
            ref={previewBoxRef}
            className="aspect-[3/4] w-full bg-black/5 rounded-xl relative overflow-hidden"
          >
            <video
              ref={videoRef}
              className="hidden"
              autoPlay
              playsInline
              muted
            />
            <img ref={imgRef} className="hidden" alt="source" />

            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
            />
          </div>

          <div className="mt-4 flex items-center justify-center gap-3">
            <div className="flex gap-2">
              {mode === "camera" && (
                <button
                  onClick={isCamActive ? stopCamera : startCamera}
                  className="px-3 py-2 rounded-xl border bg-white font-medium"
                >
                  {isCamActive ? "Matikan Kamera" : "Nyalakan Kamera"}
                </button>
              )}
              {mode === "gallery" && (
                <label className="px-3 py-2 rounded-xl border bg-white font-medium cursor-pointer">
                  Pilih Gambar
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPickImage}
                  />
                </label>
              )}
              <button
                onClick={capture}
                className="px-3 py-2 rounded-xl bg-gray-900 text-white font-semibold"
              >
                Tangkap
              </button>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white font-medium">
                <p>Kamera F/R</p>
                <button
                  type="button"
                  onClick={() =>
                    setFacing((prev) =>
                      prev === "user" ? "environment" : "user"
                    )
                  }
                  className="relative inline-flex h-6 w-11 items-center rounded-full border"
                  aria-label="Toggle Kamera Depan/Belakang"
                  title="Toggle Kamera Depan/Belakang"
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-gray-900 transition ${
                      facing === "environment"
                        ? "translate-x-5"
                        : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </section>

        {/* Controls */}
        <section className="bg-white rounded-2xl p-4 space-y-6">
          <div>
            <h1 className="text-xl font-bold mb-6 text-center">
              Metadata Watermark
            </h1>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Waktu</label>
                  <input
                    type="time"
                    className="border rounded-xl px-3 py-2"
                    placeholder="HH:MM"
                    value={timeText}
                    onChange={(e) => setTimeText(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Tanggal</label>
                  <input
                    type="date"
                    className="border rounded-xl px-3 py-2"
                    value={dateISO}
                    onChange={(e) => {
                      const iso = e.target.value; // YYYY-MM-DD
                      setDateISO(iso);
                      const d = new Date(iso + "T00:00:00");
                      setDateText(
                        new Intl.DateTimeFormat("id-ID", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        }).format(d)
                      );

                      // set hari otomatis
                      setDayText(
                        new Intl.DateTimeFormat("id-ID", {
                          weekday: "long",
                        }).format(d)
                      );
                    }}
                  />
                  {/* Opsional: tampilkan hari hanya sebagai teks (read-only) */}
                  <p className="text-xs text-gray-600 mt-1"></p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Alamat</label>
                <div className="flex gap-2">
                  <input
                    className="border rounded-xl px-3 py-2 w-full"
                    placeholder="Alamat…"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />

                  <button
                    onClick={useMyLocation}
                    className="px-3 py-2 rounded-xl border bg-white"
                  >
                    Lokasiku
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-2">Tentukan Alamat</h2>
            <div className="flex gap-2">
              <input
                className="border rounded-xl px-3 py-2 w-full"
                placeholder="Cari alamat"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                onClick={searchAddress}
                className="px-3 py-2 rounded-xl border bg-white"
              >
                Cari
              </button>
            </div>
            {searching && (
              <p className="text-sm text-gray-500 mt-2">Mencari…</p>
            )}
            {searchResults.length > 0 && (
              <ul className="mt-2 max-h-48 overflow-auto border rounded-xl divide-y">
                {searchResults.map((r, i) => (
                  <li
                    key={`${r.display_name}-${i}`}
                    className="p-2 text-sm hover:bg-gray-50 cursor-pointer"
                    onClick={() => applyResult(r.display_name)}
                  >
                    {r.display_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-2">Posisi</h2>
            <div className="grid grid-cols-4 gap-2 max-w-xs">
              {(
                [
                  "top-left",
                  "top-right",
                  "bottom-left",
                  "bottom-right",
                ] as Corner[]
              ).map((p) => (
                <button
                  key={p}
                  onClick={() => setPosition(p)}
                  className={`px-3 py-2 rounded-xl border ${
                    position === p ? "bg-gray-900 text-white" : "bg-white"
                  }`}
                >
                  {p === "top-left" && "TL"}
                  {p === "top-right" && "TR"}
                  {p === "bottom-left" && "BL"}
                  {p === "bottom-right" && "BR"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Logo</label>
            <div className="relative">
              <Image
                src={logoFile ? URL.createObjectURL(logoFile) : defaultLogo}
                alt="logo"
                width={64}
                height={64}
                className="rounded-full p-2"
              />
              <span className="text-gray-500 text-sm">Pilih Logo</span>
              <label className="absolute inset-0 w-full h-full flex items-center justify-center opacity-0 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                  className="absolute inset-0 w-full h-full opacity-0"
                />
              </label>
            </div>
          </div>

          <div className="text-sm text-gray-600 border-t pt-3">
            <p className="font-semibold">Penting ⚠️</p>
            <p className="">
              Gunakan dengan bijak. Jangan manyalahgunakan untuk hal negatif,
              segala jenis penyalahgunaan bukan tanggung jawab pembuat aplikasi
              ini.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
