This is an IDE intended for teaching, and thus allowing others (presumably
students) to spectate while code is being written. It allows you (or students)
to run code in the browser, and to have student-specific document versions, to
experiment with code while being taught.


# Setup

Setup is quite manual right now. You must install codemirror and fontawesome as
directories in the client code, and for optional eval support, may install
pyodide and picocjs as well. Then, simply present the client code over any
standard HTTP server. A redirect rule helps: By default, if you access a path
such as "/.../foo", it will look for a document named "foo". If you can't set
up a redirect rule, you can use "?doc=foo" (search parameters) instead.

As well as the client, you of course need a server. `npm install` in the server
directory to install its dependencies, then use `node livedes.js` to run the
server. If the client is served over HTTPS, put the certificate in the
`server/cert` directory so that the server will work over HTTPS as well.

The final obnoxious part of setup is setting up documents. LiveDE currently
doesn't have a document creator, you need to make them by hand. To create a
document named "foo", create a file `server/data/foo.json` with content similar
to this, adjusted as needed:

```
{
    "meta": {
        "language": "javascript"
    },
    "password": "p4ssw0rd"
}
```

Note that while the password is *temporarily* in plain text in the JSON file,
it will be salted and hashed when the document is first actually loaded.


# Main interface

To load a document, load something like `index.html?doc=foo` in a browser, or a
simpler URL using a redirect rule as described above. If the document exists,
it will be displayed in a read-only code editor. From here, the interface
changes depending on whether you're an instructor (herein called "master") or a
student.


# Master interface

To access the master interface, add a `master` search parameter to the URL
(e.g. `?doc=foo&master` or `?master`), then enter the password for the document
at the prompt. Note that the search parameter isn't a security feature, it's
just used to avoid cluttering the student interface; the password is the
security feature.

From the master interface, you can edit the document, unlock the document, see
student versions, and see student questions.

A locked document has only one fork (the master fork) and is only editable by
the master. An unlocked document is editable by students, and each student who
chooses to edit the document gets their own version. The master can see the
student versions using a dropdown that appears when the students write them. If
the master locks the document while viewing a student version, that becomes the
master fork, instead of the original master fork.

The locking interface is intended to give students an opportunity to try
solutions in a relatively anonymous fashion, and for the instructor to reward
correct solutions by accepting them.

The "Question" button on the master interface opens a blank window. When
student questions are received, they are sent to that window. The intent is for
the questions window to be on a monitor that is not visible to students.

Finally, the master has a "hide" button to hide the user interface header and
display, in its place, the URL of the document. This is so that students can
easily find it while the instructor is editing it.


# Student interface

Both students and masters may run code if the document is in one of the
languages that LiveDE supports evaluating, currently JavaScript and Python.
Pressing the "run" button opens a subwindow in which the program output and any
errors are displayed. The output window can be closed with its "X" button. The
"run" button always runs the document as currently displayed, even if it's not
the master fork.

The "local" button makes a local copy of the current state of the document that
the student can edit. When finished, they can return to the master copy with
the "revert" button. The intention of this feature is to allow experimentation
outside of the lock system.

When the document is unlocked (and has not been locally copied), the "local"
button is replaced by an "unlocked" interface, and the document is editable.
Edits are propagated as forks that the master can see.

Finally, the "question" button opens a dialogue in which a question may be
entered. The question is passed anonymously to the master.
