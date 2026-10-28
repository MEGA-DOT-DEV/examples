# CSV import

Status: archived (August 2026)

- Dropped after a month in beta. Spreadsheet apps mangle our 18-digit IDs (`402853190744561664` becomes `4.02853E+17`), so files that users edited and imported again broke the links between notes.
- Lesson: no CSV for data that holds IDs. JSON keeps them as strings.
