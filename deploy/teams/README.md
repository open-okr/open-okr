# Connecting Microsoft Teams

What this needs from Azure, in the order it needs it. Fifteen minutes, most of it
waiting for the portal.

## 1. Register the bot

In the Azure portal, create an **Azure Bot** resource.

- **Type of App**: Multi Tenant, unless every user is in one directory and you
  know you want Single Tenant.
- **Messaging endpoint**: `https://<your instance>/api/channels/teams`
- Under **Channels**, add **Microsoft Teams**.

Take three values away with you:

| Value | Where | Goes in |
|---|---|---|
| Application (client) ID | the bot's Configuration page | the Bot token box |
| Client secret | Certificates & secrets, a new secret | the Signing secret box |
| Directory (tenant) ID | the directory's Overview page | the Workspace id box |

The three boxes are named for Slack, because one form serves every provider. The
hint on the Teams card says which is which.

## 2. Connect it in OpenOKR

Sign in as an administrator, open **Settings, Notifications and channels**, and
fill in the Teams card. Nothing is verified at this point: the card says
"never verified" until a message actually arrives.

## 3. Upload the app

`manifest.json` in this directory is a template. Replace every
`REPLACE_WITH_YOUR_` value, add a `color.png` (192x192) and an `outline.png`
(32x32, transparent), and zip the three files together with no enclosing folder.

If you named your instance, with `OPENOKR_INSTANCE_NAME` or on General in
admin, put the same name in the manifest's `name` and `description` fields.
Teams shows the app by what the manifest says, and the instance cannot change
a file you upload.

Upload it in Teams under **Apps, Manage your apps, Upload an app**, or hand the
zip to a Teams administrator to publish for the organisation.

## 4. Say something to it

**This step is not optional, and it is the one people skip.** Microsoft gives no
way to look up where to send a Teams message: every inbound activity carries a
`serviceUrl` for its own region, and outbound has to use it. Until somebody
messages the bot, OpenOKR has nowhere to send and will say so rather than
failing:

> this workspace's Teams bot has not been messaged yet, so there is no service
> URL to reply to

Open a chat with the app and type `help`. That records the service URL and the
bot answers with what it can do.

## 5. Link a member

Each person links their own account once, from **Where to reach you** in their
account settings: press "Get a code" for Teams, then send that code to the bot.
Until they do, nothing they type is honoured, which is deliberate: a message from
an account the product cannot vouch for is answered with silence.

## What a nudge looks like

A reminder with nothing to act on arrives as an ordinary message. One with
actions arrives as an adaptive card: a blocker that has been open too long shows
its age, what it blocks and the next action its owner wrote, with **Resolve** and
**Take it on** as buttons and a link to the board.

Pressing one runs the same command somebody could have typed, checked the same
way, and audited with Teams named on the row.

## Checking in from Teams

`checkin` with a goal, typed or pressed as **Check in** on a reminder, answers
with a card holding the three questions: how it is going, how confident the
member is from 0 to 10, and one line on why. **Publish** sends the answers back,
and they are written exactly as a check-in from the browser is. Typing
`checkin` with no goal still asks the questions one message at a time.

## Posting a space's digest to a channel

Add the bot to the team the channel belongs to, then copy the channel's link
from Teams (**Get link to channel**). The part after `/channel/` and before the
next `/`, decoded, is the channel's ID and looks like `19:…@thread.tacv2`. A
space manager pastes it into **Teams channel ID** in the space's settings. Once
a weekly session closes, its coordinator can post the digest there from the
session page, once per week.
