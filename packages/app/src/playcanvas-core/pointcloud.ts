/**
 * 点云元素类 — 使用 PRIMITIVE_POINTS 渲染 LAS/LAZ 点云
 */

import {
    BLEND_NORMAL,
    BUFFER_STATIC,
    BoundingBox,
    CULLFACE_NONE,
    Entity,
    Mesh,
    MeshInstance,
    PRIMITIVE_POINTS,
    Quat,
    SEMANTIC_POSITION,
    SEMANTIC_TEXCOORD0,
    ShaderMaterial,
    TYPE_FLOAT32,
    TYPE_UINT8,
    Vec3,
    VertexBuffer,
    VertexFormat
} from 'playcanvas';

import { Element, ElementType } from './element';
import { LasHeader, LasPoint } from './io';
import { parseLasHeader, loadLazPerf, getWasmUrl } from './io/read/las-reader';
import { pointcloudVert, pointcloudFrag } from './shaders/pointcloud-shader';

function calcCenterOffset(h: LasHeader): Float32Array {
    return new Float32Array([
        (h.minX + h.maxX) / 2,
        (h.minY + h.maxY) / 2,
        (h.minZ + h.maxZ) / 2
    ]);
}

function calcPointSize(h: LasHeader): number {
    const extent = Math.max(h.maxX - h.minX, h.maxY - h.minY, h.maxZ - h.minZ);
    return extent / Math.cbrt(h.pointCount) * 0.8;
}

class PointCloud extends Element {
    entity: Entity = null;
    mesh: Mesh = null;
    material: ShaderMaterial = null;
    meshInstance: MeshInstance = null;
    numPoints: number;
    boundStorage: BoundingBox;
    centerOffset: Float32Array;
    pointSizeValue: number;
    _visible = true;

    constructor(header: LasHeader) {
        super(ElementType.pointcloud);
        this.numPoints = header.pointCount;
        this.centerOffset = calcCenterOffset(header);
        this.pointSizeValue = calcPointSize(header);

        const [cx, cy, cz] = this.centerOffset;
        this.boundStorage = new BoundingBox();
        this.boundStorage.center.set(0, 0, 0);
        this.boundStorage.halfExtents.set(
            (header.maxX - header.minX) / 2,
            (header.maxY - header.minY) / 2,
            (header.maxZ - header.minZ) / 2
        );
    }

    /**
     * 从 LAS/LAZ Blob 直接解码到 GPU，零中间对象
     * 替代 readLasFile + initGpu 的两步流程，消除 LasPoint[] 数组的内存开销
     */
    static async fromLasFile(
        blob: Blob,
        device: any,
        layerId: number,
        onProgress?: (pct: number, current: number, total: number) => void,
        chunkSize: number = 200000
    ): Promise<PointCloud> {
        const arrayBuffer = await blob.arrayBuffer();
        const header = parseLasHeader(arrayBuffer);
        const pc = new PointCloud(header);
        await pc._initGpuFromBuffer(arrayBuffer, header, device, layerId, onProgress, chunkSize);
        return pc;
    }

    /**
     * 从已加载的 ArrayBuffer 直接解码到 GPU 缓冲区
     */
    private async _initGpuFromBuffer(
        arrayBuffer: ArrayBuffer,
        header: LasHeader,
        device: any,
        layerId: number,
        onProgress?: (pct: number, current: number, total: number) => void,
        chunkSize: number = 200000
    ): Promise<void> {
        const count = this.numPoints;
        const [cx, cy, cz] = this.centerOffset;
        const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ } = header;

        // 创建着色器材质
        this.material = new ShaderMaterial({
            uniqueName: 'pointcloud',
            vertexGLSL: pointcloudVert,
            fragmentGLSL: pointcloudFrag
        });
        this.material.blendType = BLEND_NORMAL;
        this.material.depthWrite = true;
        this.material.depthTest = true;
        this.material.cull = CULLFACE_NONE;
        this.material.setParameter('uPointSize', this.pointSizeValue);
        this.material.update();

        // 创建 GPU 顶点缓冲区
        const format = new VertexFormat(device, [
            { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_TEXCOORD0, components: 4, type: TYPE_UINT8, normalize: true }
        ]);
        const vb = new VertexBuffer(device, format, count, { usage: BUFFER_STATIC });
        const vbLock = vb.lock() as ArrayBuffer;
        const f32 = new Float32Array(vbLock);
        const u8 = new Uint8Array(vbLock);

        // 加载 laz-perf WASM
        const createLazPerf = await loadLazPerf();
        const LazPerf = await createLazPerf({
            locateFile: () => getWasmUrl()
        });

        // 将文件数据复制到 WASM 堆
        const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
        LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

        const laszip = new LazPerf.LASZip();
        laszip.open(filePtr, arrayBuffer.byteLength);

        const pointLength = laszip.getPointLength();
        const actualFormat = laszip.getPointFormat();
        const pointPtr = LazPerf._malloc(pointLength);

        // 预计算 RGB 偏移
        const hasRgb = actualFormat === 2 || actualFormat === 3 || actualFormat === 5 ||
            actualFormat === 7 || actualFormat === 8 || actualFormat === 10;
        let rgbOff = 0;
        if (hasRgb) {
            if (actualFormat >= 6) {
                // LAS 1.4: 12(xyz)+2(intensity)+1(flags1)+1(flags2)+1(class)+1(userData)+2(scanAngle)+2(pointSourceId)+8(gpsTime)=30
                rgbOff = 30;
            } else if (actualFormat === 3 || actualFormat === 5) {
                // LAS 1.0-1.3 formats 3,5: have GPS time (8 bytes) before RGB
                // 12(xyz)+2(intensity)+1(flags)+1(class)+1(scanAngle)+1(userData)+2(pointSourceId)+8(gpsTime)=28
                rgbOff = 28;
            } else {
                // LAS 1.0-1.3 format 2: no GPS time
                // 12(xyz)+2(intensity)+1(flags)+1(class)+1(scanAngle)+1(userData)+2(pointSourceId)=20
                rgbOff = 20;
            }
        }

        // 采样检测 RGB 位深：部分 LAS 把 8 位颜色(0-255)存在 uint16 低字节，高字节为 0
        // 采样最大值 > 255 为真 16 位(取高字节 shift=8)，否则 8 位(直接取低字节 shift=0)
        let rgbShift = 8;
        if (hasRgb) {
            const sLaszip = new LazPerf.LASZip();
            sLaszip.open(filePtr, arrayBuffer.byteLength);
            const sPtr = LazPerf._malloc(pointLength);
            const sN = Math.min(2000, count);
            let maxRgb = 0;
            for (let k = 0; k < sN; k++) {
                sLaszip.getPoint(sPtr);
                const o = sPtr + rgbOff;
                maxRgb = Math.max(maxRgb,
                    LazPerf.HEAPU8[o] | (LazPerf.HEAPU8[o + 1] << 8),
                    LazPerf.HEAPU8[o + 2] | (LazPerf.HEAPU8[o + 3] << 8),
                    LazPerf.HEAPU8[o + 4] | (LazPerf.HEAPU8[o + 5] << 8));
            }
            rgbShift = maxRgb > 255 ? 8 : 0;
            LazPerf._free(sPtr);
            sLaszip.delete();
        }

        // 分批解码 + 直写 GPU 缓冲区
        for (let i = 0; i < count; i += chunkSize) {
            const end = Math.min(i + chunkSize, count);
            for (let j = i; j < end; j++) {
                laszip.getPoint(pointPtr);

                const wasmOff = pointPtr;

                // xyz 坐标变换
                const ix = LazPerf.HEAP32[wasmOff / 4];
                const iy = LazPerf.HEAP32[wasmOff / 4 + 1];
                const iz = LazPerf.HEAP32[wasmOff / 4 + 2];

                const base = j * 4;
                f32[base] = ix * scaleX + offsetX - cx;
                f32[base + 1] = iy * scaleY + offsetY - cy;
                f32[base + 2] = iz * scaleZ + offsetZ - cz;

                // RGB 颜色
                const byteOff = base * 4 + 12;
                if (hasRgb) {
                    const o = wasmOff + rgbOff;
                    u8[byteOff] = ((LazPerf.HEAPU8[o] | (LazPerf.HEAPU8[o + 1] << 8)) >> rgbShift) & 0xff;
                    u8[byteOff + 1] = ((LazPerf.HEAPU8[o + 2] | (LazPerf.HEAPU8[o + 3] << 8)) >> rgbShift) & 0xff;
                    u8[byteOff + 2] = ((LazPerf.HEAPU8[o + 4] | (LazPerf.HEAPU8[o + 5] << 8)) >> rgbShift) & 0xff;
                } else {
                    u8[byteOff] = 128;
                    u8[byteOff + 1] = 128;
                    u8[byteOff + 2] = 128;
                }
                u8[byteOff + 3] = 255;
            }
            onProgress?.(end / count, end, count);
            if (end < count) {
                await new Promise((resolve) => {
                    setTimeout(resolve, 0);
                });
            }
        }

        LazPerf._free(pointPtr);
        LazPerf._free(filePtr);
        laszip.delete();

        vb.unlock();

        // Mesh
        this.mesh = new Mesh(device);
        this.mesh.vertexBuffer = vb;
        this.mesh.primitive[0] = { baseVertex: 0, type: PRIMITIVE_POINTS, base: 0, count };

        // MeshInstance + Entity
        this.meshInstance = new MeshInstance(this.mesh, this.material, null);
        this.meshInstance.cull = false;
        this.entity = new Entity('pointcloud');
        this.entity.addComponent('render', {
            meshInstances: [this.meshInstance],
            layers: [layerId]
        });
    }

    async initGpu(header: LasHeader, points: LasPoint[], device: any, layerId: number, onProgress?: (pct: number, current: number, total: number) => void) {
        const count = points.length;
        const [cx, cy, cz] = this.centerOffset;
        const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ } = header;

        // 创建着色器材质
        this.material = new ShaderMaterial({
            uniqueName: 'pointcloud',
            vertexGLSL: pointcloudVert,
            fragmentGLSL: pointcloudFrag
        });
        this.material.blendType = BLEND_NORMAL;
        this.material.depthWrite = true;
        this.material.depthTest = true;
        this.material.cull = CULLFACE_NONE;
        this.material.setParameter('uPointSize', this.pointSizeValue);
        this.material.update();

        // 构建交错误顶点数据：POSITION(float32x3) + TEXCOORD0(uint8x4)
        // 每个顶点 = 12 bytes position + 4 bytes color = 16 bytes
        const format = new VertexFormat(device, [
            { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_TEXCOORD0, components: 4, type: TYPE_UINT8, normalize: true }
        ]);
        const vb = new VertexBuffer(device, format, count, { usage: BUFFER_STATIC });
        const vbLock = vb.lock() as ArrayBuffer;
        const f32 = new Float32Array(vbLock);
        const u8 = new Uint8Array(vbLock);

        // 采样检测 RGB 位深：>255 为真 16 位(取高字节)，否则 8 位存低字节(直接取值)
        let rgbShift = 8;
        {
            const sN = Math.min(2000, count);
            let maxRgb = 0;
            for (let k = 0; k < sN; k++) {
                const p = points[k];
                maxRgb = Math.max(maxRgb, p.red ?? 0, p.green ?? 0, p.blue ?? 0);
            }
            rgbShift = maxRgb > 255 ? 8 : 0;
        }

        // 分批填充顶点缓冲区，每批后让出主线程
        const CHUNK = 200000;
        for (let i = 0; i < count; i += CHUNK) {
            const end = Math.min(i + CHUNK, count);
            for (let j = i; j < end; j++) {
                const p = points[j];
                const base = j * 4;  // 4 floats per vertex
                f32[base] = p.x * scaleX + offsetX - cx;
                f32[base + 1] = p.y * scaleY + offsetY - cy;
                f32[base + 2] = p.z * scaleZ + offsetZ - cz;
                // 第 4 个 float 位置是 color (4 bytes uint8)
                const byteOff = base * 4 + 12;
                u8[byteOff] = ((p.red ?? 0) >> rgbShift) & 0xff;
                u8[byteOff + 1] = ((p.green ?? 0) >> rgbShift) & 0xff;
                u8[byteOff + 2] = ((p.blue ?? 0) >> rgbShift) & 0xff;
                u8[byteOff + 3] = 255;
            }
            onProgress?.(end / count, end, count);
            if (end < count) {
                await new Promise((resolve) => {
                    setTimeout(resolve, 0);
                });
            }
        }
        vb.unlock();

        // Mesh
        this.mesh = new Mesh(device);
        this.mesh.vertexBuffer = vb;
        this.mesh.primitive[0] = { baseVertex: 0, type: PRIMITIVE_POINTS, base: 0, count };

        // MeshInstance + Entity
        this.meshInstance = new MeshInstance(this.mesh, this.material, null);
        this.meshInstance.cull = false;
        this.entity = new Entity('pointcloud');
        this.entity.addComponent('render', {
            meshInstances: [this.meshInstance],
            layers: [layerId]
        });
    }

    get visible() {
        return this._visible;
    }
    set visible(v: boolean) {
        this._visible = v;
        if (this.entity) this.entity.enabled = v;
    }

    get pointSize() {
        return this.pointSizeValue;
    }
    set pointSize(v: number) {
        this.pointSizeValue = v;
        if (this.material) {
            this.material.setParameter('uPointSize', v);
        }
    }

    get worldBound(): BoundingBox | null {
        return this.boundStorage;
    }

    async add() {
        this.scene.contentRoot.addChild(this.entity);
        this.scene.boundDirty = true;
    }

    remove() {
        if (this.entity) this.scene.contentRoot.removeChild(this.entity);
    }

    /**
     * 获取轴心点变换（供 Transform 工具使用）
     * 返回包围盒中心的世界空间位置
     */
    getPivot(_origin: string, _selectedOnly: boolean, target: { position: Vec3; rotation: Quat; scale: Vec3 }) {
        target.position.copy(this.boundStorage.center);
        target.rotation.set(0, 0, 0, 1);
        target.scale.set(1, 1, 1);
    }

    /**
     * 应用变换到整个点云实体（供 Transform 工具使用）
     */
    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (this.entity) {
            if (position) this.entity.setLocalPosition(position);
            if (rotation) this.entity.setLocalRotation(rotation);
            if (scale) this.entity.setLocalScale(scale);
        }
    }
}

export { PointCloud };
