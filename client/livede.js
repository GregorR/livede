(function() {
    var dge = document.getElementById.bind(document);
    var prot = LiveDEProtocol;

    // Library functions
    var dmp = new diff_match_patch();
    var sch = sjcl.codec.hex;
    var hash = sjcl.hash.sha256;

    // Our critical elements
    var masterUI = dge("master");
    var logInUI = dge("login");
    var loggedInUI = dge("loggedin");
    var lockUI = dge("lock");
    var hideUI = dge("hide");
    var ideUI = dge("ide");
    var ide = null;

    // Local state
    var modeStates = {};
    var doc = {};
    var salt = null, clientID = null;
    var loggedIn = false;

    // Figure out what document was requested by the location
    var pn = document.location.pathname;
    var docName = pn.slice(pn.lastIndexOf("/") + 1);

    // And figure out what was requested by the search
    var srch = new URL(document.location.href).searchParams;
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
                logInUI.style.display = "none";
                loggedInUI.style.display = "inline";
                loggedIn = true;
                if (doc && ide)
                    ide.setOption("readOnly", false);
                break;

            case prot.ids.full:
                full(msg);
                break;
        }
    };

    // Initial welcome
    function welcome(msg) {
        var p = prot.welcome;
        salt = msg.getUint32(p.salt, true);
        clientID = msg.getUint32(p.id, true);
    }

    // Received a full update
    function full(msg) {
        var p = prot.full;
        var newDoc = JSON.parse(decodeText(msg.buffer.slice(p.doc)));
        if (doc && ide) {
            // It's a full update to the existing doc.
            // ...

        } else {
            // Totally fresh document
            doc = newDoc;
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

        ideUI.style.fontSize = "3em";

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

        function then() {
            modeStates[mode] = true;
            thenPrime();
        }
    }

    // UI setup
    function setupUI() {
        logInUI.onclick = logIn;
    }

    // Request a login password
    function logIn() {
        if (salt === null) return; // Can't do anything 'til we know the salt

        // FIXME: Obviously don't want to read the password in the clear!
        var password = prompt("Password");
        password = hashStr(salt + password);
        password = hashStr(clientID + password);

        // Send the login request to the server
        var p = prot.login;
        var pwbuf = encodeText(password);
        var msg = new DataView(new ArrayBuffer(p.length + pwbuf.length));
        msg.setUint32(0, prot.ids.login, true);
        new Uint8Array(msg.buffer).set(pwbuf, p.password);
        ws.send(msg);
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
