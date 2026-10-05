# College Event Management System

A web platform for managing college events and student registrations. Built with HTML, CSS, vanilla JavaScript and Node.js, with **no npm dependencies** (data is stored in a local JSON file).

## Features
**Organizers**: create, edit and delete events (title, description, category, venue, date, registration deadline, capacity, contact); view each event's participant records; mark attendance; remove participants; export participants to CSV.

**Participants**: sign up and log in; search and filter events; register with roll number, department, year and phone; cancel registration; view "My registrations".

**Rules enforced by the server**: role-based access, capacity limits, registration deadlines, no duplicate registrations, capacity cannot drop below current registrations, hashed passwords (scrypt), HttpOnly session cookies.

## Run
```bash
node server.js        # or: npm start
```
Open http://localhost:3000. Requires Node.js 16+.

Organizers sign up with an access code (default `ORG2026`). Change it:
```bash
ORGANIZER_CODE=mySecret PORT=8080 node server.js
```

## Structure
```
server.js        REST API + static file server
public/          index.html, style.css, app.js (single-page UI)
data/db.json     created automatically (git-ignored)
```

## API summary
`POST /api/signup|login|logout`, `GET /api/me`, `GET|POST /api/events`, `PUT|DELETE /api/events/:id`,
`POST|DELETE /api/events/:id/register`, `GET /api/events/:id/registrations`, `GET /api/events/:id/export`,
`GET /api/mine`, `PATCH|DELETE /api/regs/:id`.

## Push to GitHub
```bash
git init && git add . && git commit -m "College Event Management System"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
