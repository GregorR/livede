/*
 * The LiveDE teaching development environment protocol
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
    var LiveDEProtocol = {
        version: 1,

        ids: {
            handshake: 0x00,    // Initial connection handshake, C->S
            welcome: 0x01,      // Return of handshake, S->C
            login: 0x02,        // Log-in request, C->S
            loggedin: 0x03,     // Ack of log-in request, S->C

            meta: 0x10,         // Full document metadata, S->C
            full: 0x11,         // Full document text, S->C
            metadiff: 0x12,     // Change to a metadata field
            diff: 0x13,         // Change to the document text, S->C
            cdiff: 0x14,        // Change to the document text, C->S (no hash)
            hash: 0x15,         // Just the updated hash, S->C
            fork: 0x16,         // Indicate that a new fork exists, S->C

            reqfull: 0x20,      // Hash mismatch, request full document
            join: 0x21,         // Indicates that there are no longer forks, S->C
        },

        handshake: {
            version: 4,
            doc: 8,
            length: 8
        },

        welcome: {
            salt: 4,
            id: 8,
            length: 12
        },

        login: {
            password: 4, // Double-salted
            length: 4
        },

        loggedin: {
            length: 4
        },

        meta: {
            meta: 4,
            length: 4
        },

        full: {
            fork: 4,
            doc: 8,
            length: 8
        },

        metadiff: {
            fieldLen: 4,
            field: 8,
            value: 8, // + fieldLen
            length: 8
        },

        diff: {
            fork: 4,
            hash: 8,
            diff: 12,
            length: 12
        },

        cdiff: {
            diff: 4,
            length: 4
        },

        hash: {
            hash: 4,
            length: 8
        },

        fork: {
            from: 4,
            to: 8,
            diff: 12,
            length: 12
        },

        reqfull: {
            fork: 4,
            length: 8
        },

        join: {
            length: 4
        }
    };

    if (typeof process !== "undefined")
        module.exports = LiveDEProtocol;
    else if (typeof window !== "undefined")
        window.LiveDEProtocol = LiveDEProtocol;
})();
