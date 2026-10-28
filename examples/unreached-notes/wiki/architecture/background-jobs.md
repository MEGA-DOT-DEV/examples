# Background jobs

The worker takes jobs from the queue: invoice PDFs, reminder emails, CSV exports and payment syncs.

- A job retries 5 times with a growing delay, then lands in the "dead" list.
- Check the dead list every morning. Most entries are bounced emails.
- Long exports run at night, between 01:00 and 05:00 UTC.
