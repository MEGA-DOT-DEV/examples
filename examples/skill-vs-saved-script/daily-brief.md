---
name: daily-brief
description: Prepares the team's morning brief from the issue tracker, the pull requests, the deploy log and the calendar. Use it once a day, in the morning.
---

# Daily brief

List what needs the team's attention today. Read all four sources: issues, pull requests, deploys and meetings. Today's date is in the task.

1. **Overdue issues.** The status is not `done`, and the due date is before today. An issue with no due date is never overdue. An issue due today is not overdue yet.
2. **Waiting pull requests.** The state is `open`, it is not a draft, and it was opened more than 2 days ago: 3 or more days before today.
3. **Failed deploys.** The status is exactly `failed`, and the deploy finished yesterday. A `rolled_back` deploy is not a failed deploy. Older failures were in an earlier brief.
4. **Meetings today.** The meetings on today's date.

Answer with the brief as JSON: four lists of IDs, `overdue_issues`, `waiting_prs`, `failed_deploys` and `meetings_today`. An empty list is a valid answer.
