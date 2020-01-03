/*
 * LiveDE eval module for Python, using pyodide
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
    // Set pyodide's path
    var base = document.location.pathname;
    base = base.slice(base.lastIndexOf("/") + 1);
    languagePluginUrl = base + "pyodide/";

    // Load pyodide
    var scr = document.createElement("script");
    scr.addEventListener("load", onload);
    document.head.appendChild(scr);
    scr.src = "pyodide/pyodide.js";

    // We need a global function for pyodide to access to perform printing
    var currentPrint = null;
    function pyodidePrint(val) {
        if (currentPrint)
            currentPrint(val);
    }
    window.pyodidePrint = pyodidePrint;

    function onload() {
        // pyodide is loaded, so add the evaler
        languagePluginLoader.then(function() {
            // Prepare for printing
            pyodide.runPython(`
                import io, sys
                from js import pyodidePrint

                class JSIO(io.TextIOBase):
                    def __init__(self):
                        pass

                    def write(self, s):
                        pyodidePrint(s)
                        return len(s)

                sys.stdout = JSIO()
                sys.stderr = sys.stdout
            `);
            pyodide.repr = pyodide.pyimport("repr");
            LiveDEEval.python = evaler;
        });
    }

    function evaler(code, print) {
        currentPrint = print;

        // Run the given code
        pyodide.runPythonAsync(code).then(done).catch(doneEx);

        function doneEx(ex) {
            // Done but there was an exception
            print(pyodide.repr(ex) + "\n");
            done();
        }

        function done() {
            currentPrint = null;
        }
    }
})();
