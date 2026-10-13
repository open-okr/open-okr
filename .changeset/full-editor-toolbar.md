---
"@openokr/web": patch
"@openokr/ui": patch
---

Documents have a formatting toolbar.

The document editor shows the same toolbar as comments, plus Heading 1,
Heading 2, Quote and Insert a table, which the `/` menu already offered.
A button is greyed out where what it makes could not be saved: there is no
heading inside a list item, and a table cell holds text and lists only.

A review's written-up minutes open in the document editor, so a draft can be
given headings and lists before it is saved as a document.

Fixed: a document with a heading, and a comment, check-in note or review
note with a link or a mention, could not be saved. The editor handed those
parts over in a shape the server could not read, so the save was refused.
