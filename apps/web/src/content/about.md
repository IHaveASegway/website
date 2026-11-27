---
firewall_reviewed: 2026-11-27
---

I take an idea and build the entire system. I love building products consumers can use, easy and simple. I keep tech debt low, so we can stay flexible and grow quickly for whatever customers and the business demand. At the core of it, I really love solving problems. Lately I've been working out how to get real software out of coding agents.

### How I got here

I started out doing a route, grew into a manager, then went into software to solve problems the business was having that impacted real people. That brought a different type of fulfillment. I liked sitting with a problem, getting it wrong a bunch of times, and finally watching it run. That turned into about five years building backend systems and data platforms.

I didn't type this site's code. Coding agents wrote it, and the first draft of most of its words. I set the direction, sent back what wasn't right, and made the calls.

### The biggest thing I've built

About a third of the code in a CRM service with millions of lines. It supports thousands of employees and more than a hundred thousand customers, with some tables over 500M rows. I work on the platform team, giving engineers the tools to abstract complex systems and implement them easily in our apps, on mobile and on the web.

### A bakery you can order from

Proof of Concept Bakery is a made-up bakery with working software. You can order from the menu, pay with a Stripe test card and watch the kitchen board move as the order is made. Behind the counter there's delivery scheduling, catering, a CRM with campaigns and a dispatch screen that plans the routes.

Every visitor gets a private copy of the bakery, filled with made-up customers and orders, and it's wiped every night. The backends are Rust on Cloudflare Workers. A guide beside each button shows what just happened on the server, and why I used that tool.

### Things I built that you can try

- **Everyone wants the menu right when its saved copy runs out.** The Cache Lab sets off that stampede at a made-up bakery, then lets you stop it. I love this one.
- **A program crashes halfway through an order.** The Queue Lab lets you crash one and see the order lost, done twice or done once.
- **The report says 2,108 orders. There were 2,012.** A job failed partway and ran again. The Backfill Lab has the fix.
- **A bakery's whole day is too many choices to plan by hand.** The Route Lab uses VROOM, an open-source solver I didn't have to write. Its first design had a server. Now it runs in your browser for $0.
- **What you saved has to survive when a server dies.** The Raft Lab is the deep end.

Most are simulations of one problem the bakery above has to solve, and some come from things I've worked on. The end goal was to tie them all together into the bakery's working software, to explain what it takes to run a business at scale, safely and with good performance. I'll keep adding more.

### Open source

stillhere: change analytics for git and GitHub. It shows what landed, what lasted and who knows the code, and every number traces back to its commits. It's pre-release, and it doesn't measure a person's value.

### This site

The hosting, the tests, the releases and the labs. With just me and the coding agents, the first labs were live within nine days of the first commit.

I set a ceiling of $30 a month to run it. It costs about $11 a year, and that's the domain. Pages are static files, which Cloudflare serves free with no limit, so a busy day can't run up a bill. That leaves out what the coding agents cost.

On launch day I rehearsed putting the old version back. It took 33 seconds. Later, every test on this site was green, but on my phone the site was still unusable. Now a test runs every page in Safari's engine at iPhone size, and it fails if anything moves on its own. That fix was live in under three hours, and so were four others I reported.

This site is small, though. With no database or login, there's no visitor data to lose. The bakery has both, but its customers are made up. Neither can show how I'd run a service with paying customers. The CRM work above is where I do that.

### What came from me

The Lab was my idea, so people could try what I build. Writing the plan down before any code was my call. The idea in my essay came from me too: one day we'll be glad nobody has to do a lot of today's work.

When a picture covered the words on my phone, a coding agent went to test at my phone's size. I told it, "It's not about my phone size… It's about user experience."

The little Segway icon was mine too.

### What I've worked with

Go, Python, TypeScript and SQL. PostgreSQL, MongoDB, RabbitMQ, LavinMQ and SQS. AWS, Kubernetes on GCP, Terraform and Pulumi. Airflow, dbt and Snowflake.

### If you've got an idea

Reach out on LinkedIn, where my full work history is too. I'd like to hear from recruiters about their companies, and about freelance work.
