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
            doc: 4,
            length: 4
        },

        metadiff: {
            fieldLen: 4,
            field: 8,
            value: 8, // + fieldLen
            length: 8
        },

        diff: {
            hash: 4,
            diff: 8,
            length: 8
        },

        cdiff: {
            diff: 4,
            length: 4
        }
    };

    if (typeof process !== "undefined")
        module.exports = LiveDEProtocol;
    else if (typeof window !== "undefined")
        window.LiveDEProtocol = LiveDEProtocol;
})();
