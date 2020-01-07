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
    var evalable = {javascript: true, python: true, c: true};
    var languageToMode = {c: ["clike", "text/x-csrc"]};
    var languageToExt = {javascript: "js", python: "py"};

    // Our critical elements
    var headersUI = dge("headers");
    var headerUI = dge("header");
    var runUI = dge("run");
    var saveUI = dge("save");
    var lockUI = dge("lock");
    var questionUI = dge("question");
    var questionWindow = null;
    var zoominUI = dge("zoomin");
    var zoomoutUI = dge("zoomout");
    var masterUI = dge("master");
    var logInFormUI = dge("loginForm");
    var logInPasswordUI = dge("loginPassword");
    var loggedInUI = dge("loggedin");
    var hideUI = dge("hide");
    var forkBoxUI = dge("forkbox");
    var forkSelectUI = dge("forkselect");
    var secondHeaderUI = dge("secondheader");
    var ideUI = dge("ide");
    var outputUI = dge("output");
    var outputCloseUI = dge("outputclose");
    var ide = null;
    var outputCM = null;

    // Local state
    // Which modes (languages) have we loaded?
    var modeStates = {};
    // The current canonical state of the document
    var doc = {};
    // And its hash (per fork)
    var docHash = [null];
    // The fork we're seeing (only relevant for master)
    var activeFork = 0;
    // True if we're in local-copy mode
    var local = false;
    /* If we're editing locally while other edits are also coming in, we wait a
     * second before checking for hash correctness */
    var checkHashTimeout = null;
    // Zoom level
    var zoom = 1;
    // Used for master login
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
                assertZoom();
                updateStatusUI();
                updateReadOnly();
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

            case prot.ids.metadiff:
                metaDiff(msg);
                break;

            case prot.ids.hash:
                recvHash(msg);
                break;

            case prot.ids.fork:
                fork(msg);
                break;

            case prot.ids.join:
                activateFork(0);
                doc.data = [doc.data[0]];
                docHash = [docHash[0]];
                updateStatusUI();
                break;

            case prot.ids.question:
                recvQuestion(msg);
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
        if (doc && doc.data) {
            newDoc.data = doc.data;
        } else {
            newDoc.data = [""];
        }
        doc = newDoc;
        updateStatusUI();
    }

    // Received a partial metadata update
    function metaDiff(msg) {
        var p = prot.metadiff;
        var fieldLen = msg.getUint32(p.fieldLen, true);
        var field = decodeText(msg.buffer.slice(p.field, p.field + fieldLen));
        var value = JSON.parse(decodeText(msg.buffer.slice(p.value + fieldLen)));
        doc[field] = value;

        if (field === "locked") {
            updateStatusUI();
            updateReadOnly();
        }
    }

    // Received a full content update
    function full(msg) {
        var p = prot.full;
        var forkNo = loggedIn ? msg.getUint32(p.fork, true) : 0;
        var newData = decodeText(msg.buffer.slice(p.doc));
        var newFork = false;
        if (doc && ide) {
            // It's a full update to the existing doc.
            if (local) {
                // Just take it, we're not watching anyway
                doc.data[forkNo] = newData;

            } else {
                // Apply it by patches so we preserve our selection.
                var diff = dmp.diff_main(doc.data[forkNo], newData);
                var patches = dmp.patch_make(doc.data[forkNo], diff);
                applyPatches(forkNo, patches);

            }

        } else {
            // Totally fresh document
            while (doc.data.length <= forkNo) {
                doc.data.push(doc.data[0]);
                docHash.push(null);
                newFork = true;
            }
            doc.data[forkNo] = newData;
            var language = doc.language = doc.language || "javascript";
            var mode = language;
            var mime;
            var ext = language
            if (language in languageToMode)
                mode = languageToMode[language];
            if (typeof mode === "object") {
                mime = mode[1];
                mode = mode[0];
            } else {
                mime = mode;
            }
            if (language in languageToExt)
                ext = languageToExt[language]
            doc.mode = mode;
            doc.mime = mime;
            doc.ext = ext;

            runUI.disabled = true;

            // Load the mode and eval code if needed
            if (!(mode in modeStates)) {
                // This mode is totally unloaded, so load it
                loadModeThen(mode, language, loadIDE);

            } else if (typeof modeStates[mode] !== "boolean") {
                // Partially loaded, this is a script
                modeStates[mode].addEventListener("load", loadIDE);
                modeStates[mode].addEventListener("error", loadIDE);

            } else {
                // Fully loaded, just load the IDE
                loadIDE();

            }

            // Activate the run button if it's already loaded
            if (evals[mode])
                ruinUI.disabled = false;

        }

        // Calculate the hash ourselves
        docHash[forkNo] = hash.hash(doc.data[forkNo])[0];

        if (newFork)
            updateStatusUI();
    }

    // Received a diff
    function diff(msg) {
        var p = prot.diff;
        var forkNo = loggedIn ? msg.getUint32(p.fork, true) : 0;
        docHash[forkNo] = msg.getInt32(p.hash, true);
        var patches = dmp.patch_fromText(decodeText(msg.buffer.slice(p.diff)));
        applyPatches(forkNo, patches);
    }

    // Received only a hash
    function recvHash(msg) {
        var p = prot.hash;
        docHash[0] = msg.getInt32(p.hash, true);
        if (checkHashTimeout)
            clearTimeout(checkHashTimeout);
        checkHashTimeout = setTimeout(checkHash, 1000);
    }

    // Receive a new fork
    function fork(msg) {
        var p = prot.fork;
        var from = msg.getUint32(p.from, true);
        var to = msg.getUint32(p.to, true);

        // Make the fork exist
        while (doc.data.length <= to) {
            doc.data.push(doc.data[0]);
            docHash.push(null);
        }
        doc.data[to] = doc.data[from];

        // Apply the diff if applicable
        if (msg.length > p.length) {
            var patches = dmp.patch_fromText(decodeText(msg.buffer.slice(p.diff)));
            applyPatches(to, patches);
        }

        // And show it
        updateStatusUI();
    }

    // Receive a question message
    function recvQuestion(msg) {
        var p = prot.question;
        var q = "";

        // Do NOT trust the data. This is forwarded verbatim!
        try {
            q = decodeText(msg.buffer.slice(p.question)).replace(/\n/g, "\\n");
        } catch (ex) {
            return;
        }

        showQuestion(q);
    }

    // Apply patches to the whole document
    function applyPatches(forkNo, patches) {
        var from = doc.data[forkNo];
        var updateIDE = (ide && !local && forkNo === activeFork);
        var fromLive = updateIDE ? ide.getValue() : from;
        var toLive;
        var selections = updateIDE ? ide.listSelections() : [];
        if (from !== fromLive) {
            // Conflict in our own data, apply patches to our canonical version and live version separately
            doc.data[forkNo] = applyPatchesPrime(from, [], patches);
            toLive = applyPatchesPrime(fromLive, selections, patches);

            // Can't check immediately with changes in-flight, so check after a second
            if (checkHashTimeout)
                clearTimeout(checkHashTimeout);
            checkHashTimeout = setTimeout(checkHash, 1000);

        } else {
            doc.data[forkNo] = applyPatchesPrime(from, selections, patches);
            toLive = doc.data[forkNo];

            // Check immediately
            if (!checkHashTimeout)
                checkHash();
        }

        if (updateIDE) {
            // Make sure we don't lose page scrolling
            var x = window.scrollX, y = window.scrollY;
            ide.setValue(toLive);
            ide.setSelections(selections);
            window.scroll(x, y);
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
        checkHashTimeout = null;

        for (var forkNo = 0; forkNo < doc.data.length; forkNo++) {
            if (docHash[forkNo] === null)
                continue;

            var localHash = hash.hash(doc.data[forkNo])[0];
            if (localHash === docHash[forkNo]) {
                // No problem
                continue;
            }

            console.error("Hash mismatch!");

            // Something is wrong!
            var p = prot.reqfull;
            var msg = new DataView(new ArrayBuffer(p.length));
            msg.setUint32(0, prot.ids.reqfull, true);
            msg.setUint32(p.fork, forkNo, true);
            ws.send(msg);
        }
    }

    // Load the IDE
    function loadIDE() {
        var mode = doc.mime || "javascript";

        ideUI.innerHTML = "";
        ide = CodeMirror(ideUI, {
            autofocus: true,
            indentUnit: 4,
            lineNumbers: true,
            lineWrapping: true,
            viewportMargin: Infinity,

            mode: mode,
            readOnly: true
        });

        updateReadOnly();

        ide.setOption("extraKeys", {
            Tab: function(cm) {
                cm.replaceSelection("    ");
            }
        });

        ide.setValue(doc.data[0]);

        ide.on("change", localChange);
    }

    // There was a local change
    var localChangeTimeout = null;
    function localChange() {
        if (local || (loggedIn && !doc.locked)) {
            // Don't propagate our changes
            return;
        }
        if (!localChangeTimeout)
            localChangeTimeout = setTimeout(localChangePrime, 250);
    }
    function localChangePrime() {
        localChangeTimeout = null;

        // Get our change as patches
        var from = doc.data[0];
        var to = ide.getValue();
        if (from === to) return;
        doc.data[0] = to;
        var diff = dmp.diff_main(from, to);
        dmp.diff_cleanupEfficiency(diff);
        var patches = dmp.patch_make(from, diff);
        var pbuf = encodeText(dmp.patch_toText(patches));

        // And push it to the server
        var p = prot.cdiff;
        var buf = new DataView(new ArrayBuffer(p.length + pbuf.length));
        buf.setUint32(0, prot.ids.cdiff, true);
        new Uint8Array(buf.buffer).set(pbuf, p.diff);
        ws.send(buf);
    }

    // Load a CodeMirror mode, then call the given function
    function loadModeThen(mode, language, thenPrime) {
        var scr = document.createElement("script");
        scr.addEventListener("load", then);
        scr.addEventListener("error", then);
        modeStates[mode] = scr;
        document.head.appendChild(scr);
        scr.src = "codemirror/mode/" + mode + "/" + mode + ".js";

        if (evalable[language] && !LiveDEEval[language]) {
            // Also load the eval code
            LiveDEEval[language + "/ready"] = function() {
                runUI.disabled = false;
                delete LiveDEEval[language + "/ready"];
            };
            var evalScr = document.createElement("script");
            document.head.appendChild(evalScr);
            evalScr.src = "eval/" + language + ".js";
        }

        function then() {
            modeStates[mode] = true;
            thenPrime();
        }
    }

    // UI setup
    function setupUI() {
        runUI.onclick = run;
        saveUI.onclick = save;
        lockUI.onclick = lockUnlock;
        questionUI.onclick = question;
        zoominUI.onclick = zoomIn;
        zoomoutUI.onclick = zoomOut;
        logInFormUI.onsubmit = logIn;
        hideUI.onclick = hideMenu;
        forkSelectUI.onchange = selectFork;
        secondHeaderUI.onclick = showMenu;
        outputCloseUI.onclick = outputClose;
        updateStatusUI();
    }

    // Update the UI when it's changed in some way
    function updateUI() {
        setTimeout(function() {
            var h = headersUI.offsetHeight;
            ideUI.style.top = outputUI.style.top = h + "px";
        }, 100);
    }
    window.addEventListener("resize", updateUI);

    // Update UI elements that reflect the current document status
    function updateStatusUI() {
        // (1) Lock/unlock/local button
        var h = '<i class="fas fa-';
        lockUI.disabled = false;
        if (local) {
            h += 'backward';
        } else if (loggedIn) {
            if (doc.locked)
                h += "lock";
            else
                h += "unlock";
        } else {
            if (doc.locked)
                h += "laptop-code"
            else
                h += "unlock";
        }
        h += '"></i>&nbsp;&nbsp;';
        if (local) {
            h += "Revert (<u>l</u>)";
        } else if (loggedIn) {
            if (doc.locked)
                h += "Un<u>l</u>ock";
            else
                h += "<u>L</u>ock";
        } else {
            if (doc.locked) {
                h += "<u>L</u>ocal";
            } else {
                h += "Unlocked";
                lockUI.disabled = true;
            }
        }
        lockUI.innerHTML = h;

        // (2) Fork selection
        if (!doc || !doc.data || doc.data.length <= 1) {
            // No forks
            forkBoxUI.style.display = "none";
            forkSelectUI.innerHTML = "";

        } else {
            forkBoxUI.style.display = "inline";

            // Generate an item for each fork
            while (forkSelectUI.children.length !== doc.data.length) {
                var i = forkSelectUI.children.length;
                var opt = document.createElement("option");
                opt.value = i;
                opt.innerText = i;
                if (i === 0)
                    opt.innerText = "Original";
                forkSelectUI.appendChild(opt);
            }

        }

        updateUI();
    }

    /* The read-only state of the buffer is quite complicated, as it depends on
     * a number of different ways that it may be writable */
    function updateReadOnly() {
        if (!doc || !ide) return;

        var readOnly = true;

        if (loggedIn) {
            // We can't write if it's unlocked to students
            readOnly = !doc.locked;

        } else {
            // We can write if it's unlocked, or we're doing local changes
            readOnly = !(!doc.locked || local);

        }

        ide.setOption("readOnly", readOnly);
    }

    // Run the code
    function run() {
        if (!doc || !doc.language || !evals[doc.language] || !ide) {
            // I can't run this!
            return;
        }

        ide.focus();

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
                mode: doc.mime
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

        if (ide)
            ide.focus();
    }

    // Save the current state
    function save() {
        if (!ide) return;

        var code = ide.getValue();
        var blob = new Blob([code], {type: "text/plain;charset=utf-8"});
        saveAs(blob, docName + "." + doc.ext);
    }

    // Lock or unlock the document in all the various ways it can be locked or unlocked
    function lockUnlock() {
        if (!ide) return;

        var p, msg;

        if (local) {
            // We're already in local editing mode, so swap back to global mode
            local = false;

            // Revert by patching so we can preserve selections
            var cur = ide.getValue();
            var diff = dmp.diff_main(cur, doc.data[0]);
            var patches = dmp.patch_make(cur, diff);
            doc.data[0] = cur;
            applyPatches(0, patches);

        } else if (loggedIn) {
            if (!doc.locked) {
                // Before actually locking, accept the version we have
                if (activeFork !== 0) {
                    p = prot.cdiff;
                    var from = doc.data[0];
                    var to = doc.data[activeFork];
                    doc.data[0] = doc.data[activeFork];
                    var diff = dmp.diff_main(from, to);
                    dmp.diff_cleanupEfficiency(diff);
                    var patches = dmp.patch_make(from, diff);
                    var pbuf = encodeText(dmp.patch_toText(patches));
                    msg = new DataView(new ArrayBuffer(p.length + pbuf.length));
                    msg.setUint32(0, prot.ids.cdiff, true);
                    new Uint8Array(msg.buffer).set(pbuf, p.diff);
                    ws.send(msg);
                }
            }

            // Prepare a lock/unlock message
            p = prot.metadiff;
            var fieldBuf = encodeText("locked");
            var valueBuf = encodeText(JSON.stringify(!doc.locked));
            msg = new DataView(new ArrayBuffer(p.length + fieldBuf.length + valueBuf.length));
            msg.setUint32(0, prot.ids.metadiff, true);
            msg.setUint32(p.fieldLen, fieldBuf.length, true);
            new Uint8Array(msg.buffer).set(fieldBuf, p.field);
            new Uint8Array(msg.buffer).set(valueBuf, p.value + fieldBuf.length);
            ws.send(msg);

            // And handle it ourselves to do the transition
            metaDiff(msg);

        } else {
            /* We're not in local editing mode, and not a master, so switch
             * into local editing mode */
            local = true;

        }

        updateStatusUI();
        updateReadOnly();
        ide.focus();
    }

    // Ask a question or pop up the question panel
    function question() {
        if (loggedIn) {
            showQuestion(null);
            return;
        }

        // Prompt for a question to ask
        var q = prompt("Question:", "");
        if (q === null || q === "") return;

        // Then send it
        var p = prot.question;
        var qbuf = encodeText(q);
        var msg = new DataView(new ArrayBuffer(p.length + qbuf.length));
        msg.setUint32(0, prot.ids.question, true);
        new Uint8Array(msg.buffer).set(qbuf, p.question);
        ws.send(msg);
    }

    // Show an asked question, popping open the window if needed
    function showQuestion(q) {
        // Show it if the window is there
        if (questionWindow && !questionWindow.closed && questionWindow.questionPanel) {
            if (q === null)
                return; // Just showing the window
            questionWindow.questionPanel.setValue(
                questionWindow.questionPanel.getValue() + q + "\n\n"
            );
            return;
        }

        // If the window doesn't exist, open it
        if (!questionWindow || questionWindow.closed) {
            questionWindow = window.open("question-panel.html", "LiveDEQP",
                "width=480,height=640,menubar=0,toolbar=0,location=0,personalbar=0,status=0");
        }

        // And delay the question asking
        setTimeout(function() { showQuestion(q); }, 1000);
    }

    // Zoom in
    function zoomIn() {
        zoom *= 1.25;
        if (zoom > 5) zoom = 5;
        assertZoom();
    }

    // Zoom out
    function zoomOut() {
        zoom /= 1.25;
        if (zoom < 0.5) zoom = 0.5;
        assertZoom();
    }

    // Set the zoom level
    function assertZoom() {
        if (zoom >= 0.81 && zoom <= 1.24) zoom = 1;

        // The IDE is more zoomed for the master
        var ideZoom = zoom;
        if (loggedIn)
            ideZoom *= 3;
        else
            ideZoom *= 1.5;

        // Zoom the IDE elements
        ideUI.style.fontSize = ideZoom + "em";
        if (ide)
            ide.refresh();
        outputUI.style.fontSize = ideZoom + "em";
        if (outputCM)
            outputCM.refresh();

        // Zoom the buttons
        document.querySelectorAll("#header button").forEach(function(b) {
            b.style.fontSize = zoom + "em";
        });

        updateUI();
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
        if (headerUI.style.display === "none") {
            // Never mind, SHOW the menu!
            showMenu();
            return;
        }

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

    // Update the active fork by select box
    function selectFork() {
        var newActiveFork = +forkSelectUI.value;
        if (newActiveFork === activeFork)
            return;

        activateFork(newActiveFork);
    }

    // Activate the given fork
    function activateFork(newActiveFork) {
        // Do it by patch to try to preserve our selection
        var from = doc.data[activeFork];
        var to = doc.data[newActiveFork];
        activeFork = newActiveFork;
        var diff = dmp.diff_main(from, to);
        var patches = dmp.patch_make(from, diff);
        doc.data[activeFork] = from;
        applyPatches(activeFork, patches);
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
