---
"openokr": minor
---

A demo workspace's people can be signed in as.

`pnpm db:seed` has always written a believable organisation, and its seven
invented people have always been members with nobody behind them. That is right
for a seed on a laptop, where the presenter is signed in and the cast are names
on a screen, and wrong for a public demo instance, where the visitor is nobody
and the only way to see the product as the Head of Engineering sees it is to be
her.

`pnpm demo:prepare` gives each of them an account, attaches it to the member
row the seed already wrote, puts both agent members into sandbox, and runs the
Coach and the Champion once so the nudges on screen are ones the product
produced rather than rows something inserted.

It refuses a workspace the demo builder did not build, and never touches a
member who already has a real person behind them. The password is published on
purpose, because a demo account nobody can sign into is not a demo account.
