#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const https = require("https");
const ws = require("ws");
const prot = require("../client/protocol.js");
const sjcl = require("../client/sjcl.js");
const DiffPatch = require("../client/diff_match_patch.js");
const dmp = new DiffPatch();

const docs = {};

function exists(path) {
    try {
        fs.accessSync(path);
        return true;
    } catch (ex) {
        return false;
    }
}

// Start an HTTP or HTTPS server, as appropriate
var hs = null;
if (exists("cert/privkey.pem")) {
    hs = https.createServer({
        cert: fs.readFileSync("cert/fullchain.pem", "utf8"),
        key: fs.readFileSync("cert/privkey.pem", "utf8")
    });
} else {
    hs = http.createServer();
}

hs.on("error", (err) => {
    console.error(err);
    process.exit(1);
});

hs.on("listening", startWS);

hs.listen(9843);

// Start the WS server
var wss = null;
function startWS() {
    wss = new ws.Server({server: hs});

    wss.on("connection", (ws) => {
        // First message must be a handshake
        ws.once("message", connection(ws));
    });
}

function connection(ws) {
    var id, doc, docd;
    var master = false;

    return function(msg) {
        msg = Buffer.from(msg);

        // First message must be a handshake
        var p = prot.handshake;
        if (msg.length < p.length)
            return ws.close();

        var cmd = msg.readUInt32LE(0);
        if (cmd !== prot.ids.handshake)
            return ws.close();

        var vers = msg.readUInt32LE(p.version);
        if (vers !== prot.version)
            return ws.close();

        doc = "data/" + msg.toString("utf8", p.doc).replace(/[^A-Za-z0-9]/g, "_") + ".json";
        if (!exists(doc))
            return ws.close();

        // Set up the document
        if (!(doc in docs))
            docs[doc] = {onchange: {}, saveTimer: null, data: JSON.parse(fs.readFileSync(doc, "utf8"))};
        docd = docs[doc];

        if (!docd.data.data)
            docd.data.data = "";
        if (docd.data.password && Object.keys(docd.onchange).length === 0) {
            // Raw password, replace it with a hashed one
            var salt = docd.data.salt = ~~(Math.random() * 1000000000);
            var inp = salt + docd.data.password;
            docd.data.passwordHash = sjcl.hash.sha512.hash(salt + docd.data.password);
            delete docd.data.password;
            pushChange();
        }

        // Get a connection ID
        id = ~~(Math.random() * 1000000000);
        while (id in docd.onchange)
            id = ~~(Math.random() * 1000000000);
        docd.onchange[id] = onchange;

        // Now send back the current state of the document
        p = prot.full;
        var state = Buffer.from(JSON.stringify(docd.data));
        msg = Buffer.alloc(p.length + state.length);
        msg.writeUInt32LE(prot.ids.full, 0);
        state.copy(buf, p.doc);
        ws.send(msg);

        ws.on("message", onmessage);
    };

    // Normal client messages
    function onmessage(msg) {
        msg = Buffer.from(msg);
        if (msg.length < 4)
            return ws.close();
        var cmd = msg.readUInt32LE(0);

        switch (cmd) {
            default:
                return ws.close();
        }
    }

    // Triggered when another client has changed the data
    function onchange(msg) {
        ws.send(msg);
    }

    // Called when this client has changed the data
    function pushChange(field, value) {
        var msg = null;
        if (typeof field !== "undefined") {
            var prev = docd.data[field];
            docd.data[field] = value;

            // Change to a given field
            if (field === "data") {
                // Diffable change
                var diff = dmp.diff_cleanupEfficiency(dmp.diff_main(prev, value));
                diff = Buffer.from(JSON.stringify(diff));
                var sha512 = sjcl.hash.sha512.hash(value);
                var p = prot.diff;
                msg = new Buffer(p.length + diff.length);
                msg.writeUInt32LE(prot.ids.diff, 0);
                msg.writeUInt32LE(sha512, p.sha512);
                diff.copy(msg, p.diff);

            } else {
                // Non-diffable, JSONable change
                var fieldBuf, out;
                fieldBuf = Buffer.from(field);
                if (typeof value === "undefined") {
                    delete docd.data[field];
                    out = new Buffer(0);
                } else {
                    out = Buffer.from(JSON.stringify(value));
                }
                var p = prot.meta;
                msg = new Buffer(p.length + fieldBuf.length + out.length);
                msg.writeUInt32LE(prot.ids.meta, 0);
                msg.writeUInt32LE(fieldBuf.length, p.fieldLen);
                field.copy(msg, p.field);
                out.copy(msg, p.value + fieldBuf.length);
            }

        } else {
            // Force a full push
            var p = prot.full;
            var out = Buffer.from(JSON.stringify(docd.data));
            msg = new Buffer(p.length + out.length);
            msg.writeUInt32LE(prot.ids.full, 0);
            out.copy(msg, p.doc);

        }

        // Push the change to other clients
        for (var oid in docd.onchange) {
            if (oid !== id)
                docd.onchange[oid](msg);
        }

        // Save it after a bit
        if (docd.saveTimer)
            clearTimeout(docd.saveTimer);
        docd.saveTimer = setTimeout(30000, save);
    }

    // Save the current data
    function save() {
        fs.writeFileSync(doc, JSON.stringify(docd.data), "utf8");
        docd.saveTimer = null;
    }
}
