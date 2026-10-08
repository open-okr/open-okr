---
"@openokr/web": patch
"@openokr/ui": patch
---

Sign-in, sign-up, password reset, setup and the welcome wizard check an email
address with the server's own rule.

An address like `priya@northwind`, which the browser accepts and the server
refuses, is now caught when you leave the field, with a sentence saying what
it needs, and the form does not send it. The forgot-password page used to say a
reset link was on its way for such an address. A space a phone's autocomplete
adds after the address is taken off.

Every password field, on sign-in and reset too, now has a "Show what you typed"
toggle. Password fields stop at 128 characters, where the server does, and a
field near its limit says how much of it is used. These screens, the backup
code page and the single sign-on form share one field style, with the error
and the hint read out with the field.
