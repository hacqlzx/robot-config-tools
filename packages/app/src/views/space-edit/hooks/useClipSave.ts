import * as pc from "playcanvas";
import { parseLasHeader, loadLazPerf, getWasmUrl } from "../../../playcanvas-core/io/read/las-reader";
import { pointcloudVert, pointcloudFrag } from "../../../playcanvas-core/shaders/pointcloud-shader";

interface Bounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

interface ClipSaveParams {
  entity: pc.Entity;
  app: pc.Application;
  origFilePath: string;
  bounds: Bounds;
  entityName: string;
  originalMeshRef: { current: { mi: pc.MeshInstance; vb: pc.VertexBuffer } | null };
  onProgress?: (pct: number) => void;
  setProgress: (p: number) => void;
  setSaving: (s: boolean) => void;
  onClose: () => void;
  onComplete?: (clipName: string) => void;
  message: { error: (msg: string) => void; warning: (msg: string) => void; success: (msg: string) => void };
}

const CHUNK = 200_000;

export async function performClipSave({
  entity, app, origFilePath, bounds, entityName,
  originalMeshRef, onProgress, setProgress, setSaving,
  onClose, onComplete, message,
}: ClipSaveParams) {
  const clipBounds = bounds;
  const gd = app.graphicsDevice;

  setSaving(true);
  setProgress(0);

  try {
    // ── 1. 解析原始 LAS 文件头 ──
    const headerBuf = await window.electronAPI!.readFileChunk(origFilePath, 0, 4096);
    const hdr = parseLasHeader(headerBuf);
    const isComp = (hdr.pointFormatId & 0x80) !== 0;
    const fmtId = hdr.pointFormatId & 0x7F;
    const totalCount = hdr.pointCount;
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, pointRecordLength, pointDataOffset } = hdr;
    // 实体已放在世界原点(floating origin)，这里用 header 中心(世界坐标)做坐标还原基准，
    // 轴序与加载时 entity 原本的 (cx, cz, cy) 一致
    const wp = new pc.Vec3((hdr.minX + hdr.maxX) / 2, (hdr.minZ + hdr.maxZ) / 2, (hdr.minY + hdr.maxY) / 2);
    const hasRgb = [2, 3, 5, 7, 8, 10].includes(fmtId);
    const rgbOff = hasRgb ? (fmtId >= 6 ? 30 : (fmtId === 3 || fmtId === 5 ? 28 : 20)) : 0;

    console.log("[裁切] ========== 开始 ==========");
    console.log("[裁切] 文件:", origFilePath);
    console.log("[裁切] 压缩:", isComp ? "LAZ" : "LAS");
    console.log("[裁切] 原始总点数:", totalCount.toLocaleString());
    console.log("[裁切] 裁切框 X:", clipBounds.minX.toFixed(1), "~", clipBounds.maxX.toFixed(1));
    console.log("[裁切] 裁切框 Y:", clipBounds.minY.toFixed(1), "~", clipBounds.maxY.toFixed(1));
    console.log("[裁切] 裁切框 Z:", clipBounds.minZ.toFixed(1), "~", clipBounds.maxZ.toFixed(1));

    const lasToLocal = (ix: number, iy: number, iz: number): [number, number, number] => [
      ix * scaleX + offsetX - wp.x,
      iz * scaleZ + offsetZ - wp.y,
      -(iy * scaleY + offsetY - wp.z),
    ];
    const isInside = (wx: number, wy: number, wz: number) =>
      wx >= clipBounds.minX && wx <= clipBounds.maxX &&
      wy >= clipBounds.minY && wy <= clipBounds.maxY &&
      wz >= clipBounds.minZ && wz <= clipBounds.maxZ;

    // ── 2. 第一遍：计数（顺便采样 RGB 位深）──
    let clippedCount = 0;
    let maxRgbSample = 0;
    const RGB_SAMPLE = 2000;

    if (isComp) {
      const createLazPerf = await loadLazPerf();
      const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });
      const arrayBuffer = await window.electronAPI!.readLargeFile(origFilePath);
      const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
      LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);
      const laszip = new LazPerf.LASZip();
      laszip.open(filePtr, arrayBuffer.byteLength);
      const pointPtr = LazPerf._malloc(laszip.getPointLength());

      for (let i = 0; i < totalCount; i++) {
        laszip.getPoint(pointPtr);
        const ix = LazPerf.HEAP32[pointPtr / 4];
        const iy = LazPerf.HEAP32[pointPtr / 4 + 1];
        const iz = LazPerf.HEAP32[pointPtr / 4 + 2];
        const [wx, wy, wz] = lasToLocal(ix, iy, iz);
        if (isInside(wx, wy, wz)) clippedCount++;
        if (hasRgb && i < RGB_SAMPLE) {
          const o = pointPtr + rgbOff;
          maxRgbSample = Math.max(maxRgbSample,
            LazPerf.HEAPU8[o] | (LazPerf.HEAPU8[o + 1] << 8),
            LazPerf.HEAPU8[o + 2] | (LazPerf.HEAPU8[o + 3] << 8),
            LazPerf.HEAPU8[o + 4] | (LazPerf.HEAPU8[o + 5] << 8));
        }
        if (i % CHUNK === 0) {
          setProgress(Math.round(i / totalCount * 30));
          onProgress?.(Math.round(i / totalCount * 30));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      LazPerf._free(pointPtr);
      LazPerf._free(filePtr);
      laszip.delete();
    } else {
      const totalBytes = totalCount * pointRecordLength;
      const fileChunkBytes = CHUNK * pointRecordLength;

      for (let fileOff = pointDataOffset; fileOff < pointDataOffset + totalBytes; fileOff += fileChunkBytes) {
        const globalIdx = Math.floor((fileOff - pointDataOffset) / pointRecordLength);
        const remaining = totalCount - globalIdx;
        const ptsInChunk = Math.min(CHUNK, remaining);
        const readSize = ptsInChunk * pointRecordLength;
        const chunkBuf = await window.electronAPI!.readFileChunk(origFilePath, fileOff, readSize);
        const view = new DataView(chunkBuf);

        for (let i = 0; i < ptsInChunk; i++) {
          const ptOff = i * pointRecordLength;
          const [wx, wy, wz] = lasToLocal(
            view.getInt32(ptOff, true),
            view.getInt32(ptOff + 4, true),
            view.getInt32(ptOff + 8, true),
          );
          if (isInside(wx, wy, wz)) clippedCount++;
          if (hasRgb && globalIdx + i < RGB_SAMPLE) {
            const o = ptOff + rgbOff;
            maxRgbSample = Math.max(maxRgbSample,
              view.getUint16(o, true), view.getUint16(o + 2, true), view.getUint16(o + 4, true));
          }
        }
        setProgress(Math.round((globalIdx + ptsInChunk) / totalCount * 30));
        onProgress?.(Math.round((globalIdx + ptsInChunk) / totalCount * 30));
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const rgbShift = hasRgb ? (maxRgbSample > 255 ? 8 : 0) : 8;
    console.log("[裁切] 裁切后点数:", clippedCount.toLocaleString());
    console.log("[裁切] 保留比例:", (clippedCount / totalCount * 100).toFixed(2) + "%");

    if (clippedCount === 0) {
      setSaving(false);
      message.warning("裁切范围内没有点");
      return;
    }

    // ── 3. 构建输出 ──
    const outPointLen = 26;
    const headerLen = 227;
    const totalOutSize = headerLen + clippedCount * outPointLen;
    const out = new Uint8Array(totalOutSize);

    const hv = new DataView(out.buffer, 0, headerLen);
    const enc = new TextEncoder();
    const wStr = (off: number, str: string, len: number) => {
      const b = enc.encode(str);
      for (let i = 0; i < len; i++) hv.setUint8(off + i, i < b.length ? b[i] : 0);
    };
    wStr(0, "LASF", 4);
    hv.setUint16(6, 0, true);
    hv.setUint8(24, 1); hv.setUint8(25, 2);
    wStr(26, "", 32); wStr(58, "robotConfig", 32);
    hv.setUint16(90, 0, true); hv.setUint16(92, 2025, true);
    hv.setUint16(94, headerLen, true); hv.setUint32(96, headerLen, true);
    hv.setUint32(100, 0, true);
    hv.setUint8(104, 2); hv.setUint16(105, outPointLen, true);
    hv.setUint32(107, clippedCount, true);
    hv.setFloat64(131, scaleX, true); hv.setFloat64(139, scaleY, true); hv.setFloat64(147, scaleZ, true);
    hv.setFloat64(155, offsetX, true); hv.setFloat64(163, offsetY, true); hv.setFloat64(171, offsetZ, true);

    // ── 4. 第二遍：写入 ──
    const vf = new pc.VertexFormat(gd, [
      { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_TEXCOORD0, components: 4, type: pc.TYPE_UINT8, normalize: true },
    ]);
    const newVb = new pc.VertexBuffer(gd, vf, clippedCount, { usage: pc.BUFFER_STATIC });
    const nd = newVb.lock() as ArrayBuffer;
    const nf = new Float32Array(nd);
    const nu = new Uint8Array(nd);
    let outIdx = headerLen;
    let gpuIdx = 0;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    const i32 = new Int32Array(new ArrayBuffer(4));
    const u8v = new Uint8Array(i32.buffer);

    if (isComp) {
      const createLazPerf2 = await loadLazPerf();
      const LazPerf2 = await createLazPerf2({ locateFile: () => getWasmUrl() });
      const ab2 = await window.electronAPI!.readLargeFile(origFilePath);
      const fp2 = LazPerf2._malloc(ab2.byteLength);
      LazPerf2.HEAPU8.set(new Uint8Array(ab2), fp2);
      const laszip2 = new LazPerf2.LASZip();
      laszip2.open(fp2, ab2.byteLength);
      const pp2 = LazPerf2._malloc(laszip2.getPointLength());

      for (let i = 0; i < totalCount; i++) {
        laszip2.getPoint(pp2);
        const ix = LazPerf2.HEAP32[pp2 / 4];
        const iy = LazPerf2.HEAP32[pp2 / 4 + 1];
        const iz = LazPerf2.HEAP32[pp2 / 4 + 2];
        const [wx, wy, wz] = lasToLocal(ix, iy, iz);
        if (!isInside(wx, wy, wz)) continue;

        nf[gpuIdx * 4] = wx;
        nf[gpuIdx * 4 + 1] = wy;
        nf[gpuIdx * 4 + 2] = wz;

        if (hasRgb) {
          const o = pp2 + rgbOff;
          const r16 = LazPerf2.HEAPU8[o] | (LazPerf2.HEAPU8[o + 1] << 8);
          const g16 = LazPerf2.HEAPU8[o + 2] | (LazPerf2.HEAPU8[o + 3] << 8);
          const b16 = LazPerf2.HEAPU8[o + 4] | (LazPerf2.HEAPU8[o + 5] << 8);
          nu[gpuIdx * 16 + 12] = (r16 >> rgbShift) & 0xff;
          nu[gpuIdx * 16 + 13] = (g16 >> rgbShift) & 0xff;
          nu[gpuIdx * 16 + 14] = (b16 >> rgbShift) & 0xff;
        } else {
          nu[gpuIdx * 16 + 12] = 128; nu[gpuIdx * 16 + 13] = 128; nu[gpuIdx * 16 + 14] = 128;
        }
        nu[gpuIdx * 16 + 15] = 255;

        i32[0] = Math.round((wx + wp.x - offsetX) / scaleX); out.set(u8v, outIdx); outIdx += 4;
        i32[0] = Math.round((-wz + wp.z - offsetY) / scaleY); out.set(u8v, outIdx); outIdx += 4;
        i32[0] = Math.round((wy + wp.y - offsetZ) / scaleZ); out.set(u8v, outIdx); outIdx += 4;
        out[outIdx++] = 128; out[outIdx++] = 0;
        out[outIdx++] = (1 & 0x07) | ((1 & 0x07) << 3);
        out[outIdx++] = 0; out[outIdx++] = 0; out[outIdx++] = 0;
        out[outIdx++] = 0; out[outIdx++] = 0;
        if (hasRgb) {
          const o = pp2 + rgbOff;
          out[outIdx++] = LazPerf2.HEAPU8[o];     out[outIdx++] = LazPerf2.HEAPU8[o + 1];
          out[outIdx++] = LazPerf2.HEAPU8[o + 2]; out[outIdx++] = LazPerf2.HEAPU8[o + 3];
          out[outIdx++] = LazPerf2.HEAPU8[o + 4]; out[outIdx++] = LazPerf2.HEAPU8[o + 5];
        } else {
          for (let k = 0; k < 6; k++) out[outIdx++] = 128;
        }

        const origY = -wz + wp.z;
        if (wx + wp.x < mnX) mnX = wx + wp.x; if (wx + wp.x > mxX) mxX = wx + wp.x;
        if (wy + wp.y < mnY) mnY = wy + wp.y; if (wy + wp.y > mxY) mxY = wy + wp.y;
        if (origY < mnZ) mnZ = origY; if (origY > mxZ) mxZ = origY;

        gpuIdx++;
        if (i % CHUNK === 0) {
          const pct = 30 + Math.round(i / totalCount * 60);
          setProgress(pct); onProgress?.(pct);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      LazPerf2._free(pp2); LazPerf2._free(fp2); laszip2.delete();
    } else {
      const totalBytes = totalCount * pointRecordLength;
      const fileChunkBytes = CHUNK * pointRecordLength;

      for (let fileOff = pointDataOffset; fileOff < pointDataOffset + totalBytes; fileOff += fileChunkBytes) {
        const globalIdx = Math.floor((fileOff - pointDataOffset) / pointRecordLength);
        const remaining = totalCount - globalIdx;
        const ptsInChunk = Math.min(CHUNK, remaining);
        const readSize = ptsInChunk * pointRecordLength;
        const chunkBuf = await window.electronAPI!.readFileChunk(origFilePath, fileOff, readSize);
        const view = new DataView(chunkBuf);

        for (let i = 0; i < ptsInChunk; i++) {
          const ptOff = i * pointRecordLength;
          const ix = view.getInt32(ptOff, true);
          const iy = view.getInt32(ptOff + 4, true);
          const iz = view.getInt32(ptOff + 8, true);
          const [wx, wy, wz] = lasToLocal(ix, iy, iz);
          if (!isInside(wx, wy, wz)) continue;

          nf[gpuIdx * 4] = wx;
          nf[gpuIdx * 4 + 1] = wy;
          nf[gpuIdx * 4 + 2] = wz;

          if (hasRgb) {
            const o = ptOff + rgbOff;
            nu[gpuIdx * 16 + 12] = (view.getUint16(o, true) >> rgbShift) & 0xff;
            nu[gpuIdx * 16 + 13] = (view.getUint16(o + 2, true) >> rgbShift) & 0xff;
            nu[gpuIdx * 16 + 14] = (view.getUint16(o + 4, true) >> rgbShift) & 0xff;
          } else {
            nu[gpuIdx * 16 + 12] = 128; nu[gpuIdx * 16 + 13] = 128; nu[gpuIdx * 16 + 14] = 128;
          }
          nu[gpuIdx * 16 + 15] = 255;

          i32[0] = Math.round((wx + wp.x - offsetX) / scaleX); out.set(u8v, outIdx); outIdx += 4;
          i32[0] = Math.round((-wz + wp.z - offsetY) / scaleY); out.set(u8v, outIdx); outIdx += 4;
          i32[0] = Math.round((wy + wp.y - offsetZ) / scaleZ); out.set(u8v, outIdx); outIdx += 4;
          out[outIdx++] = 128; out[outIdx++] = 0;
          out[outIdx++] = (1 & 0x07) | ((1 & 0x07) << 3);
          out[outIdx++] = 0; out[outIdx++] = 0; out[outIdx++] = 0;
          out[outIdx++] = 0; out[outIdx++] = 0;
          if (hasRgb) {
            const o = ptOff + rgbOff;
            out[outIdx++] = view.getUint8(o);     out[outIdx++] = view.getUint8(o + 1);
            out[outIdx++] = view.getUint8(o + 2); out[outIdx++] = view.getUint8(o + 3);
            out[outIdx++] = view.getUint8(o + 4); out[outIdx++] = view.getUint8(o + 5);
          } else {
            for (let k = 0; k < 6; k++) out[outIdx++] = 128;
          }

          if (wx + wp.x < mnX) mnX = wx + wp.x; if (wx + wp.x > mxX) mxX = wx + wp.x;
          if (wy + wp.y < mnY) mnY = wy + wp.y; if (wy + wp.y > mxY) mxY = wy + wp.y;
          if (-wz + wp.z < mnZ) mnZ = -wz + wp.z; if (-wz + wp.z > mxZ) mxZ = -wz + wp.z;

          gpuIdx++;
        }
        const pct = 30 + Math.round((globalIdx + ptsInChunk) / totalCount * 60);
        setProgress(pct); onProgress?.(pct);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    console.log("[裁切] 实际输出点数:", gpuIdx.toLocaleString());
    console.log("[裁切] 与预期一致:", gpuIdx === clippedCount);

    // 加载器会用 header bbox 中心作为 floating-origin。裁切文件若写入自身的紧 bbox，
    // 重新加载时会被重新居中，无法和原模型重合；这里保持原模型中心不变，仅扩展到包含裁切点。
    const halfX = Math.max(scaleX, Math.abs(mxX - wp.x), Math.abs(mnX - wp.x));
    const halfLasY = Math.max(scaleY, Math.abs(mxZ - wp.z), Math.abs(mnZ - wp.z));
    const halfLasZ = Math.max(scaleZ, Math.abs(mxY - wp.y), Math.abs(mnY - wp.y));
    hv.setFloat64(179, wp.x + halfX, true); hv.setFloat64(187, wp.x - halfX, true);
    hv.setFloat64(195, wp.z + halfLasY, true); hv.setFloat64(203, wp.z - halfLasY, true);
    hv.setFloat64(211, wp.y + halfLasZ, true); hv.setFloat64(219, wp.y - halfLasZ, true);

    newVb.unlock();

    // 更新 GPU 显示
    const newMesh = new pc.Mesh(gd); newMesh.vertexBuffer = newVb;
    newMesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: clippedCount };
    const newMat = new pc.ShaderMaterial({ uniqueName: "clipped-" + Date.now(), vertexGLSL: pointcloudVert, fragmentGLSL: pointcloudFrag });
    newMat.blendType = pc.BLEND_NORMAL; newMat.depthWrite = true; newMat.depthTest = true; newMat.cull = pc.CULLFACE_NONE; newMat.update();
    const newMi = new pc.MeshInstance(newMesh, newMat, null); newMi.cull = false;
    if (entity.render) entity.render.meshInstances = [newMi];
    if (originalMeshRef.current) originalMeshRef.current = null;

    // 保存到磁盘
    const baseName = entityName.replace(/\.(las|laz)$/i, "");
    let clipName = "";
    setProgress(95); onProgress?.(95);
    if (window.electronAPI) {
      const selectedProject = localStorage.getItem("selectedProject");
      if (selectedProject) {
        const dirFiles = await window.electronAPI.project.listTree(selectedProject, "地图");
        const existing = dirFiles.filter((f: any) => f.isDir && new RegExp("^" + baseName + "_\\d+$").test(f.name));
        let idx = 1;
        while (existing.some((f: any) => f.name === baseName + "_" + idx)) idx++;
        clipName = baseName + "_" + idx;
        await window.electronAPI.project.writeFile(selectedProject, "地图/" + clipName + "/" + clipName + ".las", out.buffer.slice(0, outIdx));
        console.log("[裁切] 已保存:", "地图/" + clipName + "/" + clipName + ".las");
        console.log("[裁切] 输出大小:", (outIdx / 1024 / 1024).toFixed(1), "MB");
      }
    }

    console.log("[裁切] ========== 完成 ==========");
    onProgress?.(100);
    await new Promise((r) => setTimeout(r, 100));
    setSaving(false);
    onClose();
    onComplete?.(clipName);
    message.success("裁切完成，保留 " + clippedCount.toLocaleString() + " 个点（全量无降采样）");
  } catch (e: any) {
    console.error("[裁切] 失败:", e);
    message.error("裁切失败: " + e.message);
    setSaving(false);
  }
}
