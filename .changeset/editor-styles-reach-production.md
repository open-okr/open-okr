---
"@openokr/web": patch
---

The document editor has its base styles in production again.

The editor used to add its own small stylesheet to the page as it opened, and
the instance's security policy, which only allows styles it served itself,
refused it. So every document page logged a policy error in the browser, and
the editor ran without the rule that keeps runs of spaces as typed. The same
rules now ship in the application's own stylesheet, and nothing is refused.
