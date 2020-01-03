(function() {
    var dge = document.getElementById.bind(document);

    // Get all our critical elements
    var masterUI = dge("master");
    var logInUI = dge("login");
    var loggedInUI = dge("loggedin");
    var lockUI = dge("lock");
    var hideUI = dge("hide");
    var ideUI = dge("ide");
    var ide = null;

    // Figure out what document was requested by the location
    var pn = document.location.pathname;
    var doc = pn.slice(pn.lastIndexOf("/") + 1);

    // And figure out what was requested by the search
    var srch = new URL(document.location.href).searchParams;
    if (srch.has("doc"))
        doc = srch.get("doc");
    if (srch.has("master"))
        masterUI.style.display = "inline";

    // Connect to the server
    var sec = (document.location.protocol==="https:")?"s":"";
    var ws = new WebSocket("ws" + sec + "://" + document.location.hostname + ":9843");
    ws.binaryType = "arraybuffer";

    ws.onclose = ws.onerror = function() {
        ideUI.innerHTML = "Disconnected!";

        ideUI.innerHTML = "";
        ide = CodeMirror(ideUI, {
            autofocus: true,
            viewportMargin: Infinity,
            indentUnit: 4,
            lineWrapping: true,
            mode: "python"
        });

        ideUI.style.fontSize = "3em";
    };

    ws.onopen = function() {
        ideUI.innerHTML = "Connected!";
    };

    ws.onmessage = function(msg) {
        ideUI.innerHTML = msg;
    };
})();
