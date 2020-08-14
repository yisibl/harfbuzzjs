#!/bin/bash

# [ -f nanojpeg.c ] || wget http://svn.emphy.de/nanojpeg/trunk/nanojpeg/nanojpeg.c

clang \
    -Os \
    ../libc/zephyr-string.c ../libc/malloc.cc ../libc/main.c \
    libwebp/src/dec/*.c libwebp/src/utils/*.c -I libwebp libwebp/src/dsp/*.c \
    --target=wasm32 -nostdlib -nostdinc \
    -Wno-builtin-requires-header \
    -flto \
    -Wl,--no-entry \
    -Wl,--lto-O3 \
    -Wl,--strip-all \
    -Wl,--gc-sections \
    -Wl,--export=malloc \
    -Wl,--export=free \
    -Wl,--export=VP8InitIoInternal \
    -Wl,--export=VP8New \
    -Wl,--export=VP8Decode \
    -Wl,--export=VP8Delete \
    -Wl,--export=__heap_base \
    -I../libc/include
wasm-opt -Os a.out -o libwebp.wasm && rm a.out
