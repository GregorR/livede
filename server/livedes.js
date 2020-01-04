#!/usr/bin/env node
/*
 * The LiveDE teaching development environment server
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

const fs = require("fs");
const http = require("http");
const https = require("https");
const ws = require("ws");
const prot = require("../client/protocol.js");
const sjcl = require("../client/sjcl.js");
const sch = sjcl.codec.hex;
const hash = sjcl.hash.sha256;
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
    var forkNo = 0;

    return function(msg) {
        msg = Buffer.from(msg);

        // First message must be a handshake
        var p = prot.handshake;
        if (msg.length < p.length) {
            return ws.close();
        }

        var cmd = msg.readUInt32LE(0);
        if (cmd !== prot.ids.handshake) {
            return ws.close();
        }

        var vers = msg.readUInt32LE(p.version);
        if (vers !== prot.version) {
            return ws.close();
        }

        doc = "data/" + msg.toString("utf8", p.doc).replace(/[^A-Za-z0-9]/g, "_") + ".json";
        if (!exists(doc)) {
            return ws.close();
        }

        // Set up the document
        if (!(doc in docs))
            docs[doc] = {onchange: {}, forkNos: {}, masters: {}, saveTimer: null, data: JSON.parse(fs.readFileSync(doc, "utf8"))};
        docd = docs[doc];

        if (!docd.data.meta)
            docd.data.meta = {locked: true};
        if (!docd.data.data)
            docd.data.data = [""];
        if (docd.data.password && Object.keys(docd.onchange).length === 0) {
            // Raw password, replace it with a hashed one
            var salt = docd.data.salt = ~~(Math.random() * 1000000000);
            var inp = salt + docd.data.password;
            docd.data.passwordHash = sch.fromBits(hash.hash(salt + docd.data.password));
            delete docd.data.password;
            pushChange();
        }

        // Get a connection ID
        id = ~~(Math.random() * 2000000000);
        while (id in docd.onchange)
            id = ~~(Math.random() * 2000000000);
        docd.onchange[id] = onchange;
        docd.forkNos[id] = 0;

        // Send the login salt and connection ID
        p = prot.welcome;
        msg = Buffer.alloc(p.length);
        msg.writeUInt32LE(prot.ids.welcome, 0);
        msg.writeUInt32LE(docd.data.salt || 0, p.salt);
        msg.writeUInt32LE(id, p.id);
        ws.send(msg);

        // Send the document metadata
        p = prot.meta;
        var meta = Buffer.from(JSON.stringify(docd.data.meta));
        msg = Buffer.alloc(p.length + meta.length);
        msg.writeUInt32LE(prot.ids.meta, 0);
        meta.copy(msg, p.meta);
        ws.send(msg);

        // Finally, send the document text
        p = prot.full;
        var data = Buffer.from(docd.data.data[0]);
        msg = Buffer.alloc(p.length + data.length);
        msg.writeUInt32LE(prot.ids.full, 0);
        msg.writeUInt32LE(0, p.fork);
        data.copy(msg, p.doc);
        ws.send(msg);

        ws.on("message", onmessage);
        ws.on("close", onclose);
    };

    // Normal client messages
    function onmessage(msg) {
        msg = Buffer.from(msg);
        if (msg.length < 4)
            return ws.close();
        var cmd = msg.readUInt32LE(0);

        switch (cmd) {
            case prot.ids.login:
                if (msg.length < prot.login.length)
                    return ws.close();
                loginAttempt(msg);
                break;

            case prot.ids.metadiff:
                if (msg.length < prot.metadiff.length || !master)
                    return ws.close();
                metaDiff(msg);
                break;

            case prot.ids.cdiff:
                if (msg.length < prot.cdiff.length)
                    return ws.close();
                if (!master && !maybeFork())
                    return;
                applyPatch(msg);
                break;

            case prot.ids.reqfull:
                reqFull(msg);
                break;

            case prot.ids.question:
                question(msg);
                break;

            default:
                return ws.close();
        }
    }

    // Triggered when another client has changed the data
    function onchange(msg) {
        ws.send(msg);
        forkNo = docd.forkNos[id];
    }

    // Socket closed
    function onclose() {
        delete docd.onchange[id];
        delete docd.forkNos[id];
        delete docd.masters[id];
        if (Object.keys(docd.onchange).length === 0)
            delete docs[doc];
    }

    // Called when this client has changed the data
    function pushChange(field, value) {
        var msg = null, prev;
        var sendToAll = false;
        if (typeof field !== "undefined") {
            // Change to a given field
            if (field === "data") {
                prev = docd.data.data[forkNo];
                docd.data.data[forkNo] = value;

                // Diffable change to actual data
                var diff = dmp.diff_main(prev, value);
                dmp.diff_cleanupEfficiency(diff);
                var patches = dmp.patch_make(prev, diff);
                var pbuf = Buffer.from(dmp.patch_toText(patches));
                var hashed = hash.hash(value)[0];
                var p = prot.diff;
                msg = new Buffer(p.length + pbuf.length);
                msg.writeUInt32LE(prot.ids.diff, 0);
                msg.writeUInt32LE(forkNo, p.fork);
                msg.writeInt32LE(hashed, p.hash);
                pbuf.copy(msg, p.diff);

                // In addition, send just the hash to just this client
                p = prot.hash;
                var hashMsg = new Buffer(p.length);
                hashMsg.writeUInt32LE(prot.ids.hash, 0);
                hashMsg.writeInt32LE(hashed, p.hash);
                ws.send(hashMsg);

            } else {
                prev = docd.data.meta[field];
                docd.data.meta[field] = value;
                sendToAll = true;

                // Non-diffable, JSONable change
                var fieldBuf, out;
                fieldBuf = Buffer.from(field);
                if (typeof value === "undefined") {
                    delete docd.data.meta[field];
                    out = new Buffer(0);
                } else {
                    out = Buffer.from(JSON.stringify(value));
                }
                var p = prot.metadiff;
                msg = new Buffer(p.length + fieldBuf.length + out.length);
                msg.writeUInt32LE(prot.ids.metadiff, 0);
                msg.writeUInt32LE(fieldBuf.length, p.fieldLen);
                fieldBuf.copy(msg, p.field);
                out.copy(msg, p.value + fieldBuf.length);
            }

        } else {
            // Force a full push
            var p = prot.full;
            var out = Buffer.from(docd.data.data[forkNo]);
            msg = new Buffer(p.length + out.length);
            msg.writeUInt32LE(prot.ids.full, 0);
            msg.writeUInt32LE(forkNo, p.fork);
            out.copy(msg, p.doc);

        }

        // Push the change to other clients
        for (var oid in docd.onchange) {
            if (+oid !== id &&
                (sendToAll ||
                 docd.forkNos[oid] === forkNo ||
                 docd.masters[oid]))
                docd.onchange[oid](msg);
        }

        // Save it after a bit
        if (docd.saveTimer)
            clearTimeout(docd.saveTimer);
        docd.saveTimer = setTimeout(save, 30000);
    }

    // Save the current data
    function save() {
        fs.writeFileSync(doc, JSON.stringify(docd.data), "utf8");
        docd.saveTimer = null;
    }

    // An attempted (master) login
    function loginAttempt(msg) {
        if (!docd.data.passwordHash) {
            // There is no correct password!
            return ws.close();
        }

        var p = prot.login;
        var givenPassword = msg.toString("utf8", p.password);
        var correctPassword = sch.fromBits(hash.hash(id + docd.data.passwordHash));
        if (givenPassword !== correctPassword)
            return ws.close();

        // Correct password, they're a master
        master = docd.masters[id] = true;
        var msg = new Buffer(p.length);
        msg.writeUInt32LE(prot.ids.loggedin, 0);
        ws.send(msg);
    }

    // Fork if forking is allowed and we're on fork 0
    function maybeFork() {
        if (docd.data.meta.locked)
            return false;

        if (forkNo === 0) {
            // Fork to a new version
            forkNo = docd.data.data.length;
            docd.data.data.push(docd.data.data[0]);

            // And inform masters
            var p = prot.fork;
            var msg = new Buffer(p.length);
            msg.writeUInt32LE(prot.ids.fork, 0);
            msg.writeUInt32LE(0, p.from);
            msg.writeUInt32LE(forkNo, p.to);
            for (var oid in docd.masters)
                docd.onchange[oid](msg);
        }

        return true;
    }

    // A metadata diff from a client
    function metaDiff(msg) {
        var p = prot.metadiff;
        var fieldLen = msg.readUInt32LE(p.fieldLen);
        if (msg.length < p.length + fieldLen)
            return ws.close();

        var field = msg.toString("utf8", p.field, p.field + fieldLen);
        var value;

        // Don't trust the input
        try {
            value = JSON.parse(msg.toString("utf8", p.value + fieldLen));
        } catch (ex) {
            return ws.close();
        }

        // Perform the update
        pushChange(field, value);

        // Perform special operations if needed
        if (field === "locked" && value) {
            // We just locked, so everyone has to be on fork 0 now
            docd.data.data = [docd.data.data[0]];
            for (var oid in docd.forkNos)
                docd.forkNos[oid] = 0;
            forkNo = 0;
            pushChange();

            // And indicate that we joined to any masters
            p = prot.join;
            var msg = new Buffer(p.length);
            msg.writeUInt32LE(prot.ids.join, 0);
            for (var oid in docd.masters)
                docd.onchange[oid](msg);
        }
    }

    // Apply a patch from this client
    function applyPatch(msg) {
        var p = prot.cdiff;

        // Don't trust anything
        try {
            var patches = dmp.patch_fromText(msg.toString("utf8", p.diff));
            var result = dmp.patch_apply(patches, docd.data.data[forkNo])[0];
            // We recalculate the patch instead of transmitting theirs elsewhere
            pushChange("data", result);
        } catch (ex) {
            console.error(ex); // Eventually ws.close
        }
    }

    // Request for the full document
    function reqFull(msg) {
        var p = prot.reqfull;
        var reqFork = master ? msg.readUInt32LE(p.fork) : forkNo;

        var data = Buffer.from(docd.data.data[reqFork]);
        msg = Buffer.alloc(p.length + data.length);
        msg.writeUInt32LE(prot.ids.full, 0);
        msg.writeUInt32LE(reqFork, p.fork);
        data.copy(msg, p.doc);
        ws.send(msg);
    }

    // Student question
    function question(msg) {
        // Forward it to all masters
        for (var oid in docd.masters)
            docd.onchange[oid](msg);
    }
}
