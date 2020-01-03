/*
 * The LiveDE teaching development environment
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
    var dge = document.getElementById.bind(document);
    var prot = LiveDEProtocol;
    var evals = window.LiveDEEval = {};

    // Library functions
    var dmp = new diff_match_patch();
    var sch = sjcl.codec.hex;
    var hash = sjcl.hash.sha256;
    var evalable = {javascript: true, python: true};

    // Our critical elements
    var headersUI = dge("headers");
    var headerUI = dge("header");
    var runUI = dge("run");
    var masterUI = dge("master");
    var logInFormUI = dge("loginForm");
    var logInPasswordUI = dge("loginPassword");
    var loggedInUI = dge("loggedin");
    var lockUI = dge("lock");
    var hideUI = dge("hide");
    var secondHeaderUI = dge("secondheader");
    var ideUI = dge("ide");
    var outputUI = dge("output");
    var outputCloseUI = dge("outputclose");
    var ide = null;
    var outputCM = null;

    // Local state
    var modeStates = {};
    var doc = {};
    var docHash = null;
    var checkHashTimeout = null;
    var salt = null, clientID = null;
    var loggedIn = false;

    // Figure out what document was requested by the location
    var pn = document.location.pathname;
    var docName = pn.slice(pn.lastIndexOf("/") + 1);

    // And figure out what was requested by the search
    var docURL = new URL(document.location.href);
    var srch = docURL.searchParams;
    if (srch.has("doc"))
        docName = srch.get("doc");
    if (srch.has("master"))
        masterUI.style.display = "inline";

    // Set up the UI
    setupUI();

    // Connect to the server
    var sec = (document.location.protocol==="https:")?"s":"";
    console.error("ws" + sec + "://" + document.location.hostname + ":9843");
    var ws = new WebSocket("ws" + sec + "://" + document.location.hostname + ":9843");
    ws.binaryType = "arraybuffer";

    ws.onclose = ws.onerror = function() {
        ideUI.innerHTML = "Disconnected!";
    };

    ws.onopen = function() {
        ideUI.innerHTML = "Connected!";

        // Send our handshake
        var p = prot.handshake;
        var docNameBuf = encodeText(docName);
        var handshake = new DataView(new ArrayBuffer(p.length + docNameBuf.length));
        handshake.setUint32(0, prot.ids.handshake, true);
        handshake.setUint32(p.version, prot.version, true);
        new Uint8Array(handshake.buffer).set(docNameBuf, p.doc);
        ws.send(handshake.buffer);
    };

    // Handle messages
    ws.onmessage = function(msg) {
        msg = new DataView(msg.data);
        var cmd = msg.getUint32(0, true);

        switch (cmd) {
            case prot.ids.welcome:
                welcome(msg);
                break;

            case prot.ids.loggedin:
                logInFormUI.style.display = "none";
                loggedInUI.style.display = "inline";
                loggedIn = true;
                if (doc && ide)
                    ide.setOption("readOnly", false);
                updateUI();
                break;

            case prot.ids.meta:
                meta(msg);
                break;

            case prot.ids.full:
                full(msg);
                break;

            case prot.ids.diff:
                diff(msg);
                break;

            case prot.ids.hash:
                recvHash(msg);
                break;
        }
    };

    // Initial welcome
    function welcome(msg) {
        var p = prot.welcome;
        salt = msg.getUint32(p.salt, true);
        clientID = msg.getUint32(p.id, true);
    }

    // Received a full metadata update
    function meta(msg) {
        var p = prot.meta;
        var newDoc = JSON.parse(decodeText(msg.buffer.slice(p.meta)));
        if (doc) {
            newDoc.data = doc.data;
        } else {
            newDoc.data = "";
        }
        doc = newDoc;
    }

    // Received a full content update
    function full(msg) {
        var p = prot.full;
        var newData = decodeText(msg.buffer.slice(p.doc));
        if (doc && ide) {
            /* It's a full update to the existing doc. Apply it by patches so
             * we preserve our selection. */
            var diff = dmp.diff_main(doc.data, newData);
            var patches = dmp.patch_make(doc.data, diff);
            applyPatches(patches);

        } else {
            // Totally fresh document
            doc.data = newData;
            var mode = doc.language || "javascript";
            if (!(mode in modeStates)) {
                // This mode is totally unloaded, so load it
                loadModeThen(mode, loadIDE);

            } else if (typeof modeStates[mode] !== "boolean") {
                // Partially loaded, this is a script
                modeStates[mode].addEventListener("load", loadIDE);
                modeStates[mode].addEventListener("error", loadIDE);

            } else {
                // Fully loaded, just load the IDE
                loadIDE();

            }

        }
    }

    // Received a diff
    function diff(msg) {
        var p = prot.diff;
        docHash = msg.getInt32(p.hash, true);
        var patches = JSON.parse(decodeText(msg.buffer.slice(p.diff)));
        applyPatches(patches);
    }

    // Received only a hash
    function recvHash(msg) {
        var p = prot.hash;
        docHash = msg.getInt32(p.hash, true);
        if (checkHashTimeout)
            clearTimeout(checkHashTimeout);
        checkHashTimeout = setTimeout(checkHash, 1000);
    }

    // Apply patches to the whole document
    function applyPatches(patches) {
        var from = doc.data;
        var fromLive = ide ? ide.getValue() : from;
        var selections = ide ? ide.listSelections() : [];
        if (from !== fromLive) {
            // Conflict in our own data, apply patches to our canonical version and live version separately
            doc.data = applyPatchesPrime(from, [], patches);
            ide.setValue(applyPatchesPrime(fromLive, selections, patches));
            ide.setSelections(selections);

            // Can't check immediately with changes in-flight, so check after a second
            if (checkHashTimeout)
                clearTimeout(checkHashTimeout);
            checkHashTimeout = setTimeout(checkHash, 1000);

        } else {
            doc.data = applyPatchesPrime(from, selections, patches);
            if (ide) {
                ide.setValue(doc.data);
                ide.setSelections(selections);
            }

            // Check immediately
            if (!checkHashTimeout)
                checkHash();
        }
    }

    // Apply patches to data and selections
    function applyPatchesPrime(data, selections, patches) {
        // Modify our selections to exact locations instead of line + ch
        var lines = data.split("\n");
        var di = 0, si = 0, li, selection = selections[0];
        for (li = 0; li < lines.length && selection; li++) {
            while (selection) {
                if (selection.anchor.line === li) {
                    selection.anchor.exact = di + selection.anchor.ch;
                    if (selection.head.line < li) {
                        selection = selections[++si];
                        continue;
                    }

                }

                if (selection.head.line === li) {
                    selection.head.exact = di + selection.head.ch;
                    if (selection.anchor.line <= li) {
                        selection = selections[++si];
                        continue;
                    }
                }

                break;
            }

            // Advance past this line
            di += lines[li].length + 1; // + \n
        }

        // Now apply the patches
        patches.forEach(function(patch) {
            var step = dmp.patch_apply([patch], data);
            if (!step[1][0]) {
                // Patch failed!
                return;
            }

            data = step[0];

            // Now apply it to the selections
            selections.forEach(function(selection) {
                var from = selection.anchor.exact;
                var to = selection.head.exact;
                var swapped = false;
                if (from > to) {
                    from = to;
                    to = selection.anchor.exact;
                    swapped = true;
                }
                from = applyPatchSelection(from, patch, false);
                to = applyPatchSelection(to, patch, from !== to);
                if (swapped) {
                    selection.anchor.exact = to;
                    selection.head.exact = from;
                } else {
                    selection.anchor.exact = from;
                    selection.head.exact = to;
                }
            });
        });

        // Then un-exactify the selections again
        lines = data.split("\n");
        di = si = 0;
        selection = selections[0];
        for (li = 0; li < lines.length && selection; li++) {
            var end = di + lines[li].length + 1;

            while (selection) {
                if (selection.anchor.exact < end) {
                    // Anchor is on this line
                    selection.anchor.line = li;
                    selection.anchor.ch = selection.anchor.exact - di;
                    if (selection.head.exact < di) {
                        selection = selections[++si];
                        continue;
                    }
                }

                if (selection.head.exact < end) {
                    // Head is on this line
                    selection.head.line = li;
                    selection.head.ch = selection.head.exact - di;
                    if (selection.anchor.exact < end) {
                        selection = selections[++si];
                        continue;
                    }
                }

                break;
            }

            di = end;
        }

        return data;
    }

    // Apply a patch to a selection part
    function applyPatchSelection(loc, patch, right) {
        if (loc < patch.start1) {
            // Entirely left of the range of the patch

        } else if (loc >= patch.start1 && loc <= patch.start1 + patch.length1) {
            // Inside the range of the patch
            if (right)
                loc += patch.length2 - patch.length1;

        } else {
            // Entirely right of the range of the patch
            loc += patch.length2 - patch.length1;

        }

        return loc;
    }

    // Check that the hash matches, and request an update if it doesn't
    function checkHash() {
        if (checkHashTimeout)
            checkHashTimeout = null;

        var localHash = hash.hash(doc.data)[0];
        if (localHash === docHash) {
            // No problem
            return;
        }

        // Something is wrong!
        var p = prot.reqfull;
        var msg = new DataView(new ArrayBuffer(p.length));
        msg.setUint32(0, prot.ids.reqfull, true);
        ws.send(msg);
    }

    // Load the IDE
    function loadIDE() {
        var mode = doc.language || "javascript";

        ideUI.innerHTML = "";
        ide = CodeMirror(ideUI, {
            autofocus: true,
            indentUnit: 4,
            lineWrapping: true,
            viewportMargin: Infinity,

            mode: mode,
            readOnly: !loggedIn
        });

        ide.setOption("extraKeys", {
            Tab: function(cm) {
                cm.replaceSelection("    ");
            }
        });

        ideUI.style.fontSize = "3em";
        outputUI.style.fontSize = "3em";

        ide.setValue(doc.data);

        ide.on("change", localChange);
    }

    // There was a local change
    var localChangeTimeout = null;
    function localChange() {
        if (!localChangeTimeout)
            localChangeTimeout = setTimeout(localChangePrime, 250);
    }
    function localChangePrime() {
        localChangeTimeout = null;

        // Get our change as patches
        var from = doc.data;
        var to = ide.getValue();
        if (from === to) return;
        doc.data = to;
        var diff = dmp.diff_main(from, to);
        dmp.diff_cleanupEfficiency(diff);
        var patches = dmp.patch_make(from, diff);
        var pbuf = encodeText(JSON.stringify(patches));

        // And push it to the server
        var p = prot.cdiff;
        var buf = new DataView(new ArrayBuffer(p.length + pbuf.length));
        buf.setUint32(0, prot.ids.cdiff, true);
        new Uint8Array(buf.buffer).set(pbuf, p.diff);
        ws.send(buf);
    }

    // Load a CodeMirror mode, then call the given function
    function loadModeThen(mode, thenPrime) {
        var scr = document.createElement("script");
        scr.addEventListener("load", then);
        scr.addEventListener("error", then);
        modeStates[mode] = scr;
        document.head.appendChild(scr);
        scr.src = "codemirror/mode/" + mode + "/" + mode + ".js";

        if (evalable[mode]) {
            // Also load the eval code
            var evalScr = document.createElement("script");
            document.head.appendChild(evalScr);
            evalScr.src = "eval/" + mode + ".js";
        }

        function then() {
            modeStates[mode] = true;
            thenPrime();
        }
    }

    // UI setup
    function setupUI() {
        runUI.onclick = run;
        logInFormUI.onsubmit = logIn;
        hideUI.onclick = hideMenu;
        secondHeaderUI.onclick = showMenu;
        outputCloseUI.onclick = outputClose;
        updateUI();
    }

    // Update the UI when it's changed in some way
    function updateUI() {
        setTimeout(function() {
            var h = headersUI.offsetHeight;
            ideUI.style.top = outputUI.style.top = h + "px";
        }, 100);
    }

    // Run the code
    function run() {
        if (!doc || !doc.language || !evals[doc.language] || !ide) {
            // I can't run this!
            return;
        }

        // Show the output window
        ideUI.style.right = "50%";
        outputUI.style.display = "inline-block";

        // Create the output "IDE"
        if (!outputCM) {
            outputCM = CodeMirror(outputUI, {
                lineWrapping: true,
                readOnly: true,
                theme: "vibrant-ink",
                viewportMargin: Infinity,
                mode: doc.language
            });
        } else {
            outputCM.setValue("");
        }

        // Get the code
        var code = ide.getValue();

        // Run it capturing output
        evals[doc.language](code, function(str) {
            // FIXME: This is a grotesque way to do this
            outputCM.setValue(outputCM.getValue() + str);
        });
    }

    // Close the output
    function outputClose() {
        outputUI.style.display = "none";
        ideUI.style.right = "0";
    }

    // Request a login password
    function logIn() {
        if (salt === null) return false; // Can't do anything 'til we know the salt

        // Hash the password
        var password = logInPasswordUI.value;
        password = hashStr(salt + password);
        password = hashStr(clientID + password);

        // Send the login request to the server
        var p = prot.login;
        var pwbuf = encodeText(password);
        var msg = new DataView(new ArrayBuffer(p.length + pwbuf.length));
        msg.setUint32(0, prot.ids.login, true);
        new Uint8Array(msg.buffer).set(pwbuf, p.password);
        ws.send(msg);

        return false;
    }

    // Hide the menu
    function hideMenu() {
        // Make a URL to hide it with
        var url = docURL.host + docURL.pathname;
        if (srch.has("doc"))
            url += "?doc=" + srch.get("doc");

        // Put it in the span
        secondHeaderUI.innerText = url;

        // And swap visibility
        headerUI.style.display = "none";
        secondHeaderUI.style.display = "block";
        updateUI();
    }

    // Show the menu
    function showMenu() {
        headerUI.style.display = "block";
        secondHeaderUI.style.display = "none";
        updateUI();
    }

    // General text encoder
    function encodeText(text) {
        if (window.TextEncoder) {
            return new TextEncoder().encode(text);
        } else {
            // ASCII only approximation
            var ret = new Uint8Array(text.length);
            for (var ti = 0; ti < text.length; ti++) {
                var cc = text.charCodeAt(ti);
                if (cc > 127)
                    cc = 95;
                ret[ti] = cc;
            }
            return ret;
        }
    }

    // General text decoder
    function decodeText(data) {
        if (window.TextDecoder) {
            return new TextDecoder("utf-8").decode(data);
        } else {
            var ret = "";
            data = new Uint8Array(data);
            for (var ti = 0; ti < data.length; ti++) {
                ret += String.fromCharCode(data[ti]);
            }
            return ret;
        }
    }

    // General SHA-256 as a hex string
    function hashStr(data) {
        return sch.fromBits(hash.hash(data));
    }
})();
