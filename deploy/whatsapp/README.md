# Connecting WhatsApp

What this needs from Meta, in the order it needs it. Longer than the other
providers, and most of the time is theirs rather than yours: a business number
has to be verified before anything can be sent.

## 1. Create the app and the number

In the Meta developer console, create an app of type **Business** and add the
**WhatsApp** product.

- Under **API Setup**, add a phone number and complete Meta's verification.
- Generate a **permanent** access token from a System User with the
  `whatsapp_business_messaging` permission. The temporary token on that page
  expires in twenty-four hours and is only useful for a first test.

Take four values away with you:

| Value | Where | Goes in |
|---|---|---|
| Permanent access token | System User, Generate token | the Bot token box |
| App secret | App settings, Basic | the Signing secret box, first |
| A verify token you choose | anything, any length | the Signing secret box, second, after a space |
| Phone number ID | WhatsApp, API Setup | the Workspace id box |

The verify token is not issued by Meta. You pick it, put it in the form, and
give Meta the same string in step 3; it is how the endpoint proves it is yours.

## 2. Connect it in OpenOKR

Sign in as an administrator, open **Settings, Notifications and channels**, and
fill in the WhatsApp card. Two secrets go in one box separated by a space,
because the form is one form for every provider and a third box would be a box
every other card had to explain away.

## 3. Point the webhook at this instance

In the console, under **WhatsApp, Configuration**:

- **Callback URL**:
  `https://<your instance>/api/channels/whatsapp?phone_number_id=<your phone number ID>`
- **Verify token**: the same string you put in the form.
- Subscribe to the **messages** field.

Press Verify and Save. Meta sends a GET with a challenge; the endpoint answers it
only when the token matches, and answers 403 otherwise without saying why.

The number is on the query string because the handshake carries no body, and one
instance can serve several workspaces with several numbers.

## 4. Link a member

Each person links their own number once, from **Where to reach you** in their
account settings: press "Get a code" for WhatsApp, then send that code to the
business number. Until they do, nothing they send is honoured.

## 5. What arrives, and when

WhatsApp is the one provider that limits *when* the product may speak. Outside a
twenty-four hour window opened by the member's own last message, only templates
Meta approved in advance may be sent.

**Two steps on the channel settings screen, both of them one-off.**

1. Press **Sync from Meta** once your number has received a message. The
   templates this account has are listed, with the variables each one expects
   and whether Meta has approved it.
2. Under **Which template answers which reminder**, choose a reminder, choose an
   approved template, and choose what fills each of its `{{n}}` placeholders.

The five things a placeholder can be filled with are the person's name, the
workspace's name, what the reminder is about by name, the rule that fired, and
**the command to reply with**. That last one is what makes a reminder answerable:
WhatsApp has no buttons, so a template saying "Reply {{2}}" arrives as "Reply
checkin 8f2c…", and typing that back starts the check-in.

A reminder with no template mapped still reaches the member's inbox inside the
product. It does not reach their phone, and the settings screen says so rather
than the message failing quietly at Meta.

## What a message looks like

There are no buttons. A reminder with actions arrives as text with a line per
action saying what to reply, which on this provider is the literal instruction:

```
Resolve: reply "resolve 8f2c…"
Take it on: reply "take 8f2c…"
```

Typing that back runs the same command, checked the same way, and audited with
WhatsApp named on the row.
