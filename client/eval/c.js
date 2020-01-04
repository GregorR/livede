/*
 * LiveDE eval module for Python, using PicoCJS
 *
 * Copyright (c) 2020 Gregor Richards
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

(function() {
    // Prepare to load PicoC
    if (typeof PicoC === "undefined") PicoC = {};
    PicoC.onRuntimeInitialized = onload;

    // Remember our current print function
    var currentPrint = null;

    // Load PicoC
    var scr = document.createElement("script");
    scr.addEventListener("load", onload);
    document.head.appendChild(scr);
    scr.src = "picocjs/picoc.asm.js";

    function onload() {
        // PicoC is loaded, so add the evaler
        LiveDEEval.c = evaler;

        // And set up stdout/stderr
        PicoC.FS.init(
            function() { return null; },
            rawPrint, rawPrint
        );
    }

    function evaler(code, print) {
        currentPrint = print;

        // Run the given code
        var ret = PicoC.picoc(code);

        // Flush stdout
        PicoC.picoc("#include <stdio.h>\nvoid main() { fflush(stdout); }");

        currentPrint = null;
        return ret;
    }

    // emscripten prints in a very raw way, so translate for currentPrint
    function rawPrint(cc) {
        if (currentPrint)
            currentPrint(String.fromCharCode(cc));
    }
})();
