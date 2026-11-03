---
title: Four locks, none of them closed
summary: My 2024 trading bot's config describes four security controls, and none of them could take effect. A teardown, two years later.
published: 2026-10-25
updated: 2026-11-02
kind: essay
tags:
  - security
  - testing
firewall_reviewed: 2026-11-02
---

In 2024 I wrote a trading bot. A chart alert from TradingView hit an API Gateway endpoint on AWS, and a Lambda
function turned it into a market order with Alpaca, a stock broker, in a paper-trading account that uses fake money.
Three commits (saved versions of the code), 151 lines of Python and 114 lines of YAML. The last two commits are both
called "Adding working lambda", and that title is the only evidence in the repo that it
worked.

I went back and read it two years later. It's kind of embarrassing, and I think that's why it's useful.

## Four security settings that did nothing

My config file, `serverless.yml`, looks like somebody thought about security. It has an API key to say who can call
the bot, a usage plan to limit how often, an IP allowlist to limit from where, and a schema for the request body to
limit what they send.

None of them could work. API Gateway comes in two kinds, HTTP APIs and REST APIs, and those four settings are
[REST API features](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html). I'd wired the
function to `httpApi`, which deploys the HTTP kind. The Serverless Framework printed a warning about the settings it didn't recognize and deployed anyway. So anyone with the
URL could hit it: no key, any IP, any body.

I never noticed, because nothing in the repo ever sends a request that should fail. One request without the key
would have shown me.

## The key was in the file

The Alpaca key and secret are hardcoded in `serverless.yml`. It's a paper-trading key, so the worst case was one
fake account with no real money in it. I got lucky about which key I was holding. I'd have made the same mistake
with a live one.

## The order takes whatever you send it

My code builds a sane order: buy or sell at the market price, good for the day. Then line 64 does this:

```python
order_data.update(message)
```

That merges whatever the caller sent right over the top. The check 23 lines earlier makes sure `action` is buy or
sell, but Alpaca doesn't read `action`. It reads `side`. So a request that passes as a buy market order can go out
as a sell limit order, and the success message still says buy.

## Nothing made it safe to send twice

There's no `client_order_id`, so the same alert sent twice places two orders. TradingView
[cancels a webhook after three seconds](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/),
and my code can run longer than that. The alert log would say it failed while the order went through. Fire it
again by hand and you've doubled the trade. With real money behind it, that's the one that would've cost the most.

## What I take from it

A three-commit side project having bugs isn't news. What gets me is that the serious ones are all the same mistake.
I wrote the protections down and never tested whether they did anything.

The fix is the same for all of them: send the request that should fail, and watch it fail.
