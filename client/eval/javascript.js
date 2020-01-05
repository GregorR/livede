/*
 * LiveDE eval module for JavaScript
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

LiveDEEval.javascript = function(code, print) {
    LiveDEEval["javascript/ready"]();

    // Replace console.log so the eval'd code can print
    var origLog = console.log;
    var func = null;
    console.log = function(val) {
        if (typeof val !== "object") {
            print(val + "\n");
        } else {
            try {
                val = JSON.stringify(val);
                print(val + "\n");
            } catch(ex) {
                print(ex.toString() + "\n");
            }
        }
    };

    // Compile
    try {
        func = Function(code);
    } catch (ex) {
        print(ex.toString() + "\n");
    }

    // Execute
    try {
        if (func)
            func();
    } catch (ex) {
        print(ex.toString() + "\n");
    }

    // Then replace console.log
    console.log = origLog;
};
