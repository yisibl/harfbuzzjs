// Based on https://github.com/harfbuzz/harfbuzzjs/issues/9#issuecomment-507874962
// Which was based on https://github.com/harfbuzz/harfbuzzjs/issues/9#issuecomment-507622485
const { readFile, writeFile } = require('fs').promises;
const { join, extname, basename } = require('path');
const { performance } = require('node:perf_hooks');

(async () => {
    const { instance: { exports } } = await WebAssembly.instantiate(await readFile(join(__dirname, '../hb-subset.wasm')));

    function _subset_flag(s) {
        if (s == "--glyph-names") { return 0x00000080; }
        if (s == "--no-layout-closure") { return 0x00000200; }
        return 0x0;
    }

    function setSubsetFlags(input, flags) {
        let flagValue = 0;
        flags.forEach(function (s) {
            flagValue |= _subset_flag(s);
        })
        exports.hb_subset_input_set_flags(input, flagValue);
        // console.log('flagValue', flagValue)
    }

    function closureAndGetGids(input) {
        const plan = exports.hb_subset_plan_create_or_fail(face, input);
        const glyph_map = exports.hb_subset_plan_old_to_new_glyph_mapping(plan);

        const mySetPtr = exports.hb_set_create();
        // Add the keys of map to keys.
        // https://harfbuzz.github.io/harfbuzz-hb-map.html#hb-map-keys
        exports.hb_map_keys(glyph_map, mySetPtr);
        const gids = typedArrayFromSet(mySetPtr, Uint32Array);

        exports.hb_set_destroy(mySetPtr);
        exports.hb_map_destroy(glyph_map);
        exports.hb_subset_plan_destroy(plan);

        return gids;
    }

    const fileName = 'MaterialSymbolsOutlined-VF.ttf';
    const fontBlob = await readFile(join(__dirname, fileName));

    const t = performance.now();
    const heapu8 = new Uint8Array(exports.memory.buffer);
    const fontBuffer = exports.malloc(fontBlob.byteLength);
    heapu8.set(new Uint8Array(fontBlob), fontBuffer);

    /* Creating a face */
    const blob = exports.hb_blob_create(fontBuffer, fontBlob.byteLength, 2/*HB_MEMORY_MODE_WRITABLE*/, 0, 0);
    const face = exports.hb_face_create(blob, 0);
    exports.hb_blob_destroy(blob);
    // TODO: get gids via hb-shape
    const SUBSET_GIDS = [4261]; // star icon
    const SUBSET_TEXT = ['star']

    // Upper case STAR can also be mapped to the same icon.
    SUBSET_TEXT.forEach(word => {
        SUBSET_TEXT.push(word.toUpperCase());
    });

    /* Add your glyph indices here and subset */
    const input = exports.hb_subset_input_create_or_fail();
    const glyph_set = exports.hb_subset_input_glyph_set(input);
    for (const gid of SUBSET_GIDS) {
        exports.hb_set_add(glyph_set, gid);
    }

    const gids = closureAndGetGids(input);
    console.log('📌 Step 1: Glyph IDs', `[${gids.join(', ')}]`)

    const glyph_set2 = exports.hb_subset_input_glyph_set(input);
    for (const gid of gids) {
        exports.hb_set_add(glyph_set2, gid);
    }

    const unicode_set = exports.hb_subset_input_unicode_set(input);
    const codePoints = []
    for (const text of SUBSET_TEXT.toString()) {
        codePoints.push(text.codePointAt(0))        
        exports.hb_set_add(unicode_set, text.codePointAt(0));
    }
    console.log('codePoints', codePoints)

    setSubsetFlags(input, [
        '--no-layout-closure',
        // '--glyph-names'
    ])

    const new_gids = closureAndGetGids(input);
    console.log('📌 Step 2: Glyph IDs', `[${new_gids.join(', ')}]`)
    console.log(`🍞 Closed glyph list over : ${new_gids.length} glyphs after`)

    const subset = exports.hb_subset_or_fail(face, input);

    /* Clean up */
    exports.hb_subset_input_destroy(input);

    /* Get result blob */
    const resultBlob = exports.hb_face_reference_blob(subset);

    const offset = exports.hb_blob_get_data(resultBlob, 0);
    const subsetByteLength = exports.hb_blob_get_length(resultBlob);
    if (subsetByteLength === 0) {
        exports.hb_blob_destroy(resultBlob);
        exports.hb_face_destroy(subset);
        exports.hb_face_destroy(face);
        exports.free(fontBuffer);
        throw new Error(
            'Failed to create subset font, maybe the input file is corrupted?'
        );
    }

    // Output font data(Uint8Array)
    const subsetFontBlob = heapu8.subarray(offset, offset + exports.hb_blob_get_length(resultBlob));
    console.info('✨ Subset done in', performance.now() - t, 'ms');

    const extName = extname(fileName).toLowerCase();
    const fontName = basename(fileName, extName);
    await writeFile(join(__dirname, '/', `${fontName}.subset${extName}`), subsetFontBlob);
    console.info(`Wrote subset to: ${__dirname}/${fontName}.subset${extName}`);

    /* Clean up */
    exports.hb_blob_destroy(resultBlob);
    exports.hb_face_destroy(subset);
    exports.hb_face_destroy(face);
    exports.free(fontBuffer);

    /**
     * Return the typed array of HarfBuzz set contents.
     * @template {typeof Uint8Array | typeof Uint32Array | typeof Int32Array | typeof Float32Array} T
     * @param {number} setPtr Pointer of set
     * @param {T} arrayClass Typed array class
     * @returns {InstanceType<T>} Typed array instance
     */
    function typedArrayFromSet(setPtr, arrayClass) {
        const HB_SET_VALUE_INVALID = -1;
        const heapu32 = new Uint32Array(exports.memory.buffer);
        const heapi32 = new Int32Array(exports.memory.buffer);
        const heapf32 = new Float32Array(exports.memory.buffer);

        let heap = heapu8;
        if (arrayClass === Uint32Array) {
            heap = heapu32;
        } else if (arrayClass === Int32Array) {
            heap = heapi32;
        } else if (arrayClass === Float32Array) {
            heap = heapf32;
        }
        const bytesPerElment = arrayClass.BYTES_PER_ELEMENT;
        const setCount = exports.hb_set_get_population(setPtr);
        const arrayPtr = exports.malloc(
            setCount * bytesPerElment,
        );
        const arrayOffset = arrayPtr / bytesPerElment;
        const array = heap.subarray(
            arrayOffset,
            arrayOffset + setCount,
        );
        heap.set(array, arrayOffset);
        exports.hb_set_next_many(
            setPtr,
            HB_SET_VALUE_INVALID,
            arrayPtr,
            setCount,
        );
        return array;
    }

})();
