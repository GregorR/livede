(function() {
    var LiveDEProtocol = {
        version: 1,

        ids: {
            handshake: 0x00,    // Initial connection handshake, C->S

            full: 0x10,         // Full state of the document, S->C
            meta: 0x11,         // Change to a metadata field
            diff: 0x12,         // Change to the document text, S->C
            cdiff: 0x13,        // Change to the document text, C->S (no hash)
        },

        handshake: {
            version: 4,
            doc: 8,
            length: 8
        },

        full: {
            doc: 4,
            length: 4
        },

        meta: {
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
