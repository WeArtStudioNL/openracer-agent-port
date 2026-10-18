/*
 * Zip.js
 *
 * Description: A small zip writer and reader for the garage (Garage.js): a car or a track as one file to pass on.
 *              Writing stores the files as they are (a glb or a JPEG hardly shrinks anyway); reading takes stored
 *              entries and deflated ones (the browser's DecompressionStream inflates them). No zip64: a file is below 4 GB.
 */

OpenRacer.Zip = (function () {
    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function dosTime(date) {
        return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
    }

    function bytesOf(data) {
        if (data instanceof Blob) return data.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
        if (typeof data === "string") return Promise.resolve(new TextEncoder().encode(data));
        if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
        return Promise.resolve(new Uint8Array(data.buffer || data));
    }

    // entries: [{ name, data: Blob | string | ArrayBuffer }]. Promise of a Blob (application/zip).
    function write(entries) {
        var encoder = new TextEncoder();
        var parts = [], central = [], offset = 0;
        var stamp = dosTime(new Date());
        return entries.reduce(function (chain, entry) {
            return chain.then(function () {
                return bytesOf(entry.data).then(function (bytes) {
                    var name = encoder.encode(entry.name);
                    var crc = crc32(bytes);
                    var local = new DataView(new ArrayBuffer(30));
                    local.setUint32(0, 0x04034b50, true);
                    local.setUint16(4, 20, true);        // version needed
                    local.setUint16(6, 0x0800, true);    // flags: UTF-8 names
                    local.setUint16(8, 0, true);         // method: stored
                    local.setUint16(10, stamp.time, true);
                    local.setUint16(12, stamp.date, true);
                    local.setUint32(14, crc, true);
                    local.setUint32(18, bytes.length, true);
                    local.setUint32(22, bytes.length, true);
                    local.setUint16(26, name.length, true);
                    local.setUint16(28, 0, true);
                    parts.push(local.buffer, name, bytes);
                    var dir = new DataView(new ArrayBuffer(46));
                    dir.setUint32(0, 0x02014b50, true);
                    dir.setUint16(4, 20, true);
                    dir.setUint16(6, 20, true);
                    dir.setUint16(8, 0x0800, true);
                    dir.setUint16(10, 0, true);
                    dir.setUint16(12, stamp.time, true);
                    dir.setUint16(14, stamp.date, true);
                    dir.setUint32(16, crc, true);
                    dir.setUint32(20, bytes.length, true);
                    dir.setUint32(24, bytes.length, true);
                    dir.setUint16(28, name.length, true);
                    dir.setUint16(30, 0, true);
                    dir.setUint16(32, 0, true);
                    dir.setUint16(34, 0, true);
                    dir.setUint16(36, 0, true);
                    dir.setUint32(38, 0, true);
                    dir.setUint32(42, offset, true);
                    central.push(dir.buffer, name);
                    offset += 30 + name.length + bytes.length;
                });
            });
        }, Promise.resolve()).then(function () {
            var size = 0;
            central.forEach(function (p) { size += p.byteLength; });
            var end = new DataView(new ArrayBuffer(22));
            end.setUint32(0, 0x06054b50, true);
            end.setUint16(4, 0, true);
            end.setUint16(6, 0, true);
            end.setUint16(8, entries.length, true);
            end.setUint16(10, entries.length, true);
            end.setUint32(12, size, true);
            end.setUint32(16, offset, true);
            end.setUint16(20, 0, true);
            return new Blob(parts.concat(central, [end.buffer]), { type: "application/zip" });
        });
    }

    function inflate(blob) {
        if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser cannot inflate a zip; it reads stored (uncompressed) zips only."));
        return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    }

    // Promise of [{ name, blob }] for a zip Blob or File
    function read(file) {
        var tail = Math.min(file.size, 65557 + 22);
        return file.slice(file.size - tail).arrayBuffer().then(function (buffer) {
            var view = new DataView(buffer);
            var eocd = -1;
            for (var i = buffer.byteLength - 22; i >= 0; i--) {
                if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) throw new Error("This is not a zip file.");
            var count = view.getUint16(eocd + 10, true);
            var size = view.getUint32(eocd + 12, true);
            var start = view.getUint32(eocd + 16, true);
            return file.slice(start, start + size).arrayBuffer().then(function (dirBuffer) {
                var dir = new DataView(dirBuffer);
                var decoder = new TextDecoder();
                var entries = [];
                var p = 0;
                for (var n = 0; n < count && p + 46 <= dirBuffer.byteLength; n++) {
                    if (dir.getUint32(p, true) !== 0x02014b50) break;
                    var method = dir.getUint16(p + 10, true);
                    var compressed = dir.getUint32(p + 20, true);
                    var nameLength = dir.getUint16(p + 28, true), extraLength = dir.getUint16(p + 30, true), commentLength = dir.getUint16(p + 32, true);
                    var localOffset = dir.getUint32(p + 42, true);
                    var name = decoder.decode(new Uint8Array(dirBuffer, p + 46, nameLength));
                    entries.push({ name: name, method: method, compressed: compressed, localOffset: localOffset });
                    p += 46 + nameLength + extraLength + commentLength;
                }
                return Promise.all(entries.map(function (entry) {
                    return file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer().then(function (localBuffer) {
                        var local = new DataView(localBuffer);
                        if (local.getUint32(0, true) !== 0x04034b50) throw new Error("The zip is damaged (" + entry.name + ").");
                        var dataStart = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
                        var data = file.slice(dataStart, dataStart + entry.compressed);
                        if (entry.method === 0) return { name: entry.name, blob: data };
                        if (entry.method === 8) return inflate(data).then(function (blob) { return { name: entry.name, blob: blob }; });
                        throw new Error("The zip uses a compression this reader does not know (" + entry.name + ").");
                    });
                }));
            });
        });
    }

    return { write: write, read: read, crc32: crc32 };
})();
