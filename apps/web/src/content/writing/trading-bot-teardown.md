---
title: Four locks, none of them closed
summary: My 2024 trading bot's config describes four security controls, and none of them could take effect. A teardown, two years later.
published: 2026-10-24 # the day this draft was written: set it to the day the post publishes
draft: true
kind: postmortem
tags:
  - security
  - testing
firewall_reviewed: 1970-01-01 # NOT A REVIEW: no person has read this draft. Set the UTC day of the read; the review stamp in verify refuses this value until then.
---

In 2024 I wrote a trading bot. A TradingView alert would POST to an API Gateway endpoint, and a
Lambda would turn it into a market order on Alpaca's paper-trading API. Three commits, dated
2024-10-23 and 2024-10-24. 151 lines of my own Python, 114 lines of YAML. The last two commits are
both titled "Adding working lambda", and that title is the only evidence in the repository that it
worked.

Its config describes four security controls. None of them could take effect. Every line number
below is from the repository's last commit.

## Four controls, none of them attached

`serverless.yml` reads like the work of someone who had thought about security. It defines an API
key. It sets a usage plan: 5,000 requests a month, 100 requests a second, bursts to 200. It adds a
resource policy that allows only listed source IPs, TradingView's four
[published webhook addresses](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/)
among them. The event is marked `private: true`, which in the Serverless Framework means "require
the API key". A JSON schema says the body must be an object with a `message` string.

That is five settings and four controls, because the key and `private: true` are two halves of one
lock.

The function is wired to `httpApi`, which Serverless deploys as an API Gateway HTTP API, the v2
API. API keys, usage plans, resource policies and request validation are REST API features. AWS's
own
[comparison of REST and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
marks API keys, resource policies and request validation No for HTTP APIs. It has no row named
usage plans. Its row for per-client usage throttling, which links to AWS's page on usage plans,
reads No as well.

The framework does more than ignore them. Serverless Framework 4.4 builds API keys, usage plans and
resource policies only for REST (`http`) events. This file has none, so it never creates them.
`private` is not an option on an `httpApi` event, and the schema sits at the function level, where
the framework does not read it for any event type. For keys it does not recognize, the framework's
default
[validation mode](https://www.serverless.com/framework/docs/configuration-validation) is `warn`:
it prints a warning and deploys anyway.

So the config describes four locks in careful detail, and none of them is on the door. If the stack
deployed as written, anyone with the URL could reach the route: no key, any IP, any body at all.

The resource policy would not have worked on a REST API either. It builds the ARN from
`${self:service}-${self:provider.stage}`, the service name plus the stage, which reads like an
API's name. An `execute-api` ARN takes the API's generated ID in that position
([AWS's ARN reference](https://docs.aws.amazon.com/apigateway/latest/developerguide/arn-format-reference.html)),
so the string could never match. Serverless's own docs write the resource as `execute-api:/*/*/*`
and let AWS fill in the ID. AWS denies a caller that no Allow statement matches, so on a REST API
this policy would have locked out TradingView too.

The schema would not have worked either. It requires `message` to be a string, and the handler
needs an object there: line 110 takes `message` out of the body, and lines 37 to 39 read `symbol`,
`action` and `quantity` out of it by key. Enforced, the schema would refuse every body that could
place an order.

**The lesson:** a security control I have not watched refuse a request is not a control. It is a
comment. Nothing in the repository sends a request without the key. One such request would have
shown that the route was open.

## The credential

`serverless.yml` hardcodes an Alpaca key and its secret. They arrived in the second commit, on
2024-10-24, the same commit that added the file. They are still there in the last commit.

It is a paper-trading key. The code only ever sends it to `paper-api.alpaca.markets`
(`lambdas/handler.py` line 15), and Alpaca gives a paper account
[its own keys](https://docs.alpaca.markets/us/docs/paper-trading), different from the live
account's. So the blast radius is one simulated account, with no real money in it. That reasoning
is the trap. The habit is the same whether the key is paper or live. I got lucky about which one I
was holding.

The first commit brought a `.gitignore`, GitHub's stock Python template, which lists `.env`. And
`serverless.yml` keeps `.env*` out of the deploy package (line 88). Both are built to keep a `.env`
file out. I put the secret somewhere neither was looking. The commit that added it also added three
patterns to `.gitignore`, so I was editing the list of what git should ignore in the same commit
that handed git the key.

**The lesson:** a credential has one home, and a file tracked by git is never it. Git copies it
into every clone and every fork, and a later commit does not take it back.

## The order takes whatever the caller sends

In `lambdas/handler.py`, `execute_trade` builds a sane order: a market order, good for the day,
with the symbol and quantity from the request. Then line 64 does this:

```python
order_data.update(message)
```

It merges the caller's message over those defaults. The check on line 41, 23 lines earlier, makes
sure `action` is `buy` or `sell`. Alpaca does not read `action`. It reads `side`. So a body that
carries `side`, `type` or `time_in_force` replaces the defaults, any other order field, such as
`limit_price` or `extended_hours`, is added, and line 67 posts the result to Alpaca. A request
validated as a buy market order can go out as a sell limit order. The success message still says
"buy", because it is built from the validated `action`.

The one check on the caller's input in that function is undone by the line that builds the
request.

Alpaca's own rules still apply: `extended_hours` works only on a `limit` order with a
`time_in_force` of `day` or `gtc`, and `notional` cannot be combined with the `qty` the handler
always sets. Every order also carries the stray keys `action` and `quantity`, so all of this
assumes Alpaca ignores fields it does not know. The commit title's "working" implies that it does.
The repository does not prove it.

`quantity` gets less. The handler checks that the key exists (line 119) and nothing else: not that
it is a number, not that it is positive, not that it is bounded. And because of line 64, a `qty` in
the body replaces it anyway.

**The lesson:** validate at the boundary, then build the outbound object from only the fields you
validated. Never merge caller input into a payload you are about to sign your name to.

## Nothing made it safe to send twice

The handler never sets a `client_order_id`, and nothing else deduplicates. A request that carries
the same alert twice places a second order, and nothing in the code can tell it from the first.

TradingView does not promise to deliver an alert exactly once. The same webhook page says a request
that takes longer than three seconds "will be cancelled", and that webhooks "may occasionally fail
to reach the specified URL". It says nothing about retries. The handler makes two calls to Alpaca
in a row, and neither call sets a timeout, so it can run past three seconds. TradingView's alert
log would then show the webhook as failed while the Lambda went on and placed the order. Anyone who
re-fired the alert by hand after that would double the trade.

For a system whose whole job is to place orders on someone else's signal, the missing idempotency
key is the line that would have cost the most with real money behind it.

If the broker stalls, those same two calls hold the Lambda until its 29-second function timeout
ends it, long after TradingView has given up. Nothing in the repository configures an alarm, a kill
switch, a position limit or a maximum order size.

## The rest, briefly

- Upstream error bodies go back to the caller verbatim, inside a 400:
  `f"Failed to place order: {order_response.text}"` on line 72, and the same for the account check
  on line 49. Whatever Alpaca puts in an error, the caller reads.
- The whole event is logged with `json.dumps(event, indent=2)`, headers included, into CloudWatch,
  which keeps it for 14 days.
- `logger.info(order_response)` logs `<Response [200]>`, or whatever the status was: the status
  code and none of the body.
- `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` contradicts
  itself. A browser blocks a credentialed request that gets this response, and for any other
  request the credentials header does nothing. It is in there twice: in the handler's
  `create_response`, and in `serverless.yml`, under a `response` key the framework most likely
  never read. CORS means nothing to a machine-to-machine webhook anyway.
- Both Alpaca calls count any status but 200 as a failure (lines 48 and 70), including every other
  2xx. Alpaca documents 200 for a new order, so this is brittle rather than broken: any other 2xx
  would report a placed order as a failure.
- `PYTHON_PATH` is set in the environment. Python reads `PYTHONPATH`. It does nothing.
- Line 49 turns on X-Ray tracing for API Gateway. The same AWS comparison marks X-Ray tracing No
  for HTTP APIs.
- `.requirements.zip`, a 222-entry dependency bundle that the build generates, is committed.
- `requirements.txt` has Alpaca's older Python SDK, `alpaca-trade-api`, commented out, and installs
  only `requests`, so both calls to Alpaca are written by hand.
- Python 3.9, which reached end of life on 2025-10-31 ([PEP 596](https://peps.python.org/pep-0596/)).
  AWS deprecated its
  [Lambda runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) on
  2025-12-15.
- No tests. The only place `serverless.yml` names `pytest` is a list of packages to keep out of the
  deploy.

## Why this is on the site

The interesting part is not that a three-commit project had bugs. It is the shape of the mistakes.
Every serious one is the same mistake: I wrote something that described safety and never checked
whether it produced safety. The API key the framework never created. The IP allowlist on an ARN
that could not match. The validation undone 23 lines later. The success message that reports the
order it validated, not the one it sent.

Three habits would have caught most of it, and this repository inverts each one:

- **Write the decision down.** Nothing records why `httpApi` and not `http`. The README is two
  lines, and the commit messages are "Initial commit" and "Adding working lambda", twice. That one
  unrecorded choice switched off three of the four controls, and the fourth was in the wrong place
  anyway.
- **One owner per piece of data.** The credential lives in a tracked file, so every clone holds its
  own copy.
- **Fail closed.** When a check cannot prove a change is safe, the change does not ship. The
  framework's default does the opposite: it warns about keys it does not recognize, such as
  `private` on an `httpApi` event, and deploys. One line, `configValidationMode: error`, makes it
  refuse instead, and this file does not have it. Four controls, none tested, all open.

The fix for all four controls is the same habit: send the request that should fail, and watch it
fail.
