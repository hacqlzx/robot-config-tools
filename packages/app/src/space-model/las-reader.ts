/**
 * LAS/LAZ 点云文件读取器
 *
 * 依赖 laz-perf (WASM) 处理二进制解析与解压，浏览器原生可用。
 * 支持 LAS 1.0 ~ 1.4，点格式 0/1/2/3/6/7/8。
 */

/** 获取 laz-perf JS 文件 URL */
const getJsUrl = (): string => {
    return new URL('static/lib/laz-perf/laz-perf.js', document.baseURI).toString();
};

/** 获取 laz-perf WASM 文件 URL */
export const getWasmUrl = (): string => {
    return new URL('static/lib/laz-perf/laz-perf.wasm', document.baseURI).toString();
};

/** 缓存的 laz-perf 模块实例 */
let lazPerfModule: any = null;

/**
 * 运行时加载 laz-perf 模块（运行时 fetch + eval，绕过 Rollup CJS 互操作问题）
 */
export async function loadLazPerf(): Promise<any> {
    if (lazPerfModule) return lazPerfModule;

    const jsUrl = getJsUrl();
    const response = await fetch(jsUrl);
    const code = await response.text();

    // 创建 CJS 模拟环境：laz-perf.js 内部通过 module.exports 或 exports 输出
    const exportsObj: any = {};
    const moduleObj = { exports: exportsObj };

    // 安全的函数执行，提供 module 和 exports 作为局部变量
    // eslint-disable-next-line no-new-func
    const fn = new Function('module', 'exports', code);
    fn(moduleObj, exportsObj);

    // 获取模块输出的 createLazPerf 函数
    lazPerfModule = moduleObj.exports || exportsObj;
    return lazPerfModule;
}

/** LAS 文件头部元信息 */
export interface LasHeader {
    fileSignature: string;
    versionMajor: number;
    versionMinor: number;
    headerSize: number;
    pointDataOffset: number;
    pointFormatId: number;
    pointRecordLength: number;
    pointCount: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    offsetX: number;
    offsetY: number;
    offsetZ: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    generatingSoftware: string;
    creationDay: number;
    creationYear: number;
    globalEncoding: number;
}

/** 解码后的单点数据 */
export interface LasPoint {
    x: number;
    y: number;
    z: number;
    intensity: number;
    classification: number;
    returnNumber: number;
    numberOfReturns: number;
    scanDirectionFlag: number;
    edgeOfFlightLine: number;
    gpsTime?: number;
    red?: number;
    green?: number;
    blue?: number;
    nir?: number;
}

/**
 * 从原始字节解析 LAS 头部
 */
export function parseLasHeader(buffer: ArrayBuffer): LasHeader {
    const view = new DataView(buffer);
    const le = true;  // LAS 绝大多数字段小端

    const sig = String.fromCharCode(
        view.getUint8(0), view.getUint8(1),
        view.getUint8(2), view.getUint8(3)
    );
    if (sig !== 'LASF') {
        throw new Error(`无效的 LAS 文件，魔数：${sig}`);
    }

    const globalEncoding = view.getUint16(6, le);
    const versionMajor = view.getUint8(24);
    const versionMinor = view.getUint8(25);

    // 读取 null 结尾的字符串
    const readString = (offset: number, maxLen: number): string => {
        const bytes: number[] = [];
        for (let i = 0; i < maxLen; i++) {
            const b = view.getUint8(offset + i);
            if (b === 0) break;
            bytes.push(b);
        }
        return String.fromCharCode(...bytes);
    };

    const generatingSoftware = readString(58, 32);
    const creationDay = view.getUint16(90, le);
    const creationYear = view.getUint16(92, le);
    const headerSize = view.getUint16(94, le);
    const pointDataOffset = view.getUint32(96, le);
    const pointFormatId = view.getUint8(104);
    const pointRecordLength = view.getUint16(105, le);
    const legacyPointCount = view.getUint32(107, le);

    // LAS 1.4 使用 64 位点计数，否则使用旧版 32 位计数
    let pointCount: number;
    if (versionMinor >= 4 && headerSize >= 375) {
        pointCount = Number(view.getBigUint64(247, le));
    } else {
        pointCount = legacyPointCount;
    }

    const scaleX = view.getFloat64(131, le);
    const scaleY = view.getFloat64(139, le);
    const scaleZ = view.getFloat64(147, le);
    const offsetX = view.getFloat64(155, le);
    const offsetY = view.getFloat64(163, le);
    const offsetZ = view.getFloat64(171, le);
    const maxX = view.getFloat64(179, le);
    const minX = view.getFloat64(187, le);
    const maxY = view.getFloat64(195, le);
    const minY = view.getFloat64(203, le);
    const maxZ = view.getFloat64(211, le);
    const minZ = view.getFloat64(219, le);

    return {
        fileSignature: sig,
        versionMajor,
        versionMinor,
        headerSize,
        pointDataOffset,
        pointFormatId,
        pointRecordLength,
        pointCount,
        scaleX,
        scaleY,
        scaleZ,
        offsetX,
        offsetY,
        offsetZ,
        minX,
        maxX,
        minY,
        maxY,
        minZ,
        maxZ,
        generatingSoftware,
        creationDay,
        creationYear,
        globalEncoding
    };
}

/**
 * 从点记录字节缓冲区解析单个点（支持格式 0-3，6-8）
 * 字段偏移量基于 ASPRS LAS 规范
 */
export function parsePoint(buffer: ArrayBuffer, offset: number, formatId: number): LasPoint {
    const view = new DataView(buffer);
    const le = true;
    let pos = offset;

    const x = view.getInt32(pos, le); pos += 4;
    const y = view.getInt32(pos, le); pos += 4;
    const z = view.getInt32(pos, le); pos += 4;
    const intensity = view.getUint16(pos, le); pos += 2;

    let returnNumber: number;
    let numberOfReturns: number;
    let scanDirectionFlag: number;
    let edgeOfFlightLine: number;
    let classification: number;

    if (formatId >= 6) {
        // LAS 1.4 格式：return_number 占低 4 位，number_of_returns 占高 4 位
        const byte = view.getUint8(pos); pos += 1;
        returnNumber = byte & 0x0F;
        numberOfReturns = (byte >> 4) & 0x0F;

        // classification_flags 字节
        const flags = view.getUint8(pos); pos += 1;
        scanDirectionFlag = (flags >> 6) & 1;
        edgeOfFlightLine = (flags >> 7) & 1;

        // 独立 classification 字节
        classification = view.getUint8(pos); pos += 1;
    } else {
        // LAS 1.0-1.3 格式：return_number 占低 3 位，number_of_returns 占 3-5 位
        const byte = view.getUint8(pos); pos += 1;
        returnNumber = byte & 0x07;
        numberOfReturns = (byte >> 3) & 0x07;
        scanDirectionFlag = (byte >> 6) & 1;
        edgeOfFlightLine = (byte >> 7) & 1;

        // 旧版 classification + flags 合并字节
        const rawClass = view.getUint8(pos); pos += 1;
        classification = rawClass & 0x1F;
    }

    let scanAngle: number;
    const userData = view.getUint8(pos); pos += 1;

    if (formatId >= 6) {
        scanAngle = view.getInt16(pos, le); pos += 2;
    } else {
        scanAngle = view.getInt8(pos); pos += 1;
    }

    const pointSourceId = view.getUint16(pos, le); pos += 2;

    let gpsTime: number | undefined;
    let red: number | undefined;
    let green: number | undefined;
    let blue: number | undefined;
    let nir: number | undefined;

    // GPS 时间：格式 1,3,4,5,6+ 包含
    if (formatId === 1 || formatId === 3 || formatId === 4 || formatId === 5 || formatId >= 6) {
        gpsTime = view.getFloat64(pos, le); pos += 8;
    }

    // RGB：格式 2,3,5,7,8,10 包含
    if (formatId === 2 || formatId === 3 || formatId === 5 || formatId === 7 || formatId === 8 || formatId === 10) {
        red = view.getUint16(pos, le); pos += 2;
        green = view.getUint16(pos, le); pos += 2;
        blue = view.getUint16(pos, le); pos += 2;
    }

    // NIR：格式 8,10 包含
    if (formatId === 8 || formatId === 10) {
        nir = view.getUint16(pos, le); pos += 2;
    }

    return {
        x,
        y,
        z,
        intensity,
        classification,
        returnNumber,
        numberOfReturns,
        scanDirectionFlag,
        edgeOfFlightLine,
        gpsTime,
        red,
        green,
        blue,
        nir
    };
}

/**
 * 读取 LAS/LAZ 文件所有点数据（分批解码，避免阻塞主线程）
 * @param file - 浏览器 Blob 对象
 * @param maxCount - 最大解码点数，默认全部
 * @param onProgress - 进度回调 (0-1)
 * @param chunkSize - 每批解码点数，默认 100000
 * @returns 头部信息 + 点数组
 */
export async function readLasFile(
    file: Blob,
    maxCount: number = Infinity,
    onProgress?: (percent: number) => void,
    chunkSize: number = 100000
): Promise<{ header: LasHeader; points: LasPoint[] }> {
    const arrayBuffer = await file.arrayBuffer();
    const header = parseLasHeader(arrayBuffer);

    const createLazPerf = await loadLazPerf();
    const LazPerf = await createLazPerf({
        locateFile: () => getWasmUrl()
    });

    const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, arrayBuffer.byteLength);

    const actualCount = Math.min(laszip.getCount(), maxCount);
    const pointLength = laszip.getPointLength();
    const actualFormat = laszip.getPointFormat();

    const points: LasPoint[] = new Array(actualCount);
    const pointPtr = LazPerf._malloc(pointLength);

    // 分批解码，每批后让出主线程
    for (let i = 0; i < actualCount; i += chunkSize) {
        const end = Math.min(i + chunkSize, actualCount);
        for (let j = i; j < end; j++) {
            laszip.getPoint(pointPtr);
            const slice = LazPerf.HEAPU8.slice(pointPtr, pointPtr + pointLength);
            points[j] = parsePoint(slice.buffer, 0, actualFormat);
        }
        onProgress?.(end / actualCount);
        // 让出主线程，避免 UI 冻结
        if (end < actualCount) {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        }
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();

    return { header, points };
}

/**
 * 从 LAS 文件加载并打印信息（调试用途）
 * 使用 laz-perf LASZip 统一处理 LAS 和 LAZ（压缩/非压缩均支持）
 *
 * @param file - 浏览器 File 对象
 * @param printLimit - 最多解析并打印的点数，默认 5
 */
export async function loadLasFile(file: Blob, printLimit: number = 5): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();

    // --- 1. 解析头部 ---
    const header = parseLasHeader(arrayBuffer);
    console.group(`[LAS] ${(file as any).name ?? 'unknown.las'}`);
    console.log('版本：', `LAS ${header.versionMajor}.${header.versionMinor}`);
    console.log('点格式 ID：', header.pointFormatId);
    console.log('点记录长度：', `${header.pointRecordLength} 字节`);
    console.log('点数：', header.pointCount.toLocaleString());
    console.log('生成软件：', header.generatingSoftware || '(未知)');
    console.log('创建日期：', `第 ${header.creationDay} 天, ${header.creationYear}`);
    console.log('坐标缩放 (scale)：', header.scaleX, header.scaleY, header.scaleZ);
    console.log('坐标偏移 (offset)：', header.offsetX, header.offsetY, header.offsetZ);
    console.log('点数据偏移：', header.pointDataOffset);
    console.log('XYZ 范围：');
    console.log('  X:', header.minX.toFixed(3), '~', header.maxX.toFixed(3));
    console.log('  Y:', header.minY.toFixed(3), '~', header.maxY.toFixed(3));
    console.log('  Z:', header.minZ.toFixed(3), '~', header.maxZ.toFixed(3));
    console.log('文件大小：', `${(file.size / 1024 / 1024).toFixed(2)} MB`);

    const isCompressed = header.pointFormatId >= 128;
    console.log('压缩 (LAZ)：', isCompressed);

    // --- 2. 使用 laz-perf 解析点数据 ---
    const createLazPerf = await loadLazPerf();
    console.log('createLazPerf 类型：', typeof createLazPerf);
    const LazPerf = await createLazPerf({
        locateFile: () => getWasmUrl()
    });
    const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, arrayBuffer.byteLength);

    const actualCount = laszip.getCount();
    const pointLength = laszip.getPointLength();
    const actualFormat = laszip.getPointFormat();
    console.log('解码后点数：', actualCount.toLocaleString());
    console.log('解码后点长度：', `${pointLength} 字节`);
    console.log('解码后点格式：', actualFormat);

    // --- 3. 解码并打印前 N 个点 ---
    console.log(`\n前 ${Math.min(actualCount, printLimit)} 个点数据：`);
    const pointPtr = LazPerf._malloc(pointLength);
    for (let i = 0; i < Math.min(actualCount, printLimit); i++) {
        laszip.getPoint(pointPtr);
        const pointBytes = LazPerf.HEAPU8.slice(pointPtr, pointPtr + pointLength);
        const p = parsePoint(pointBytes.buffer, 0, actualFormat);
        console.log(`  点 ${i}:`, p);
    }

    // --- 4. 统计分类分布（前 50000 个点） ---
    const statCount = Math.min(actualCount, 50000);
    const classDist = new Map<number, number>();
    for (let i = 0; i < statCount; i++) {
        laszip.getPoint(pointPtr);
        const classOff = (actualFormat >= 6) ? 16 : 15;
        let cls: number;
        if (actualFormat >= 6) {
            cls = LazPerf.HEAPU8[pointPtr + classOff];
        } else {
            cls = LazPerf.HEAPU8[pointPtr + classOff] & 0x1F;
        }
        classDist.set(cls, (classDist.get(cls) || 0) + 1);
    }
    console.log(`\n分类分布（前 ${statCount.toLocaleString()} 点）：`);
    const classNames: Record<number, string> = {
        0: '未分类',
        1: '未分配',
        2: '地面',
        3: '低矮植被',
        4: '中等植被',
        5: '高植被',
        6: '建筑',
        7: '低噪声',
        8: '模型关键点',
        9: '水体',
        10: '铁轨',
        11: '路面',
        12: '重叠/覆盖'
    };
    for (const [cls, count] of [...classDist.entries()].sort((a, b) => a[0] - b[0])) {
        const name = classNames[cls] || '未知';
        console.log(`  类别 ${cls} (${name}): ${count} 个 (${(count / statCount * 100).toFixed(1)}%)`);
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();
    console.groupEnd();
}
