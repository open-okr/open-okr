---
"@openokr/web": patch
---

Live updates (the inbox, feed, board, agents screen and copilot) now send a heartbeat every 25 seconds, so a load balancer's or a CDN's idle timeout no longer cuts them and every open tab stops reconnecting about once a minute.
