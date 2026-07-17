# Locator & DOM Verifier Workspace

A simple tool for opening saved web pages (`.mhtml` / `.html` files) and picking out elements on them to build a **locator map** — basically a list of "here's how to find this button/field on this page" rules, saved as JSON. Handy for QA/automation work.

## What it does (in plain English)

1. You give it a folder of saved web page snapshots.
2. It shows each page in the browser, just like the real site.
3. You click on elements (buttons, inputs, etc.) and it records how to locate them.
4. Everything you record gets saved to `locator_findings.json` / `locator.json`.

## What's inside

| File / Folder | What it's for |
|---|---|
| `server.js` | The web server (Express) that runs everything |
| `index.html` | The main page you see in the browser |
| `js/` | Frontend logic (inspecting elements, mapping tool, JSON editor, etc.) |
| `css/` | Styling (Tailwind + DaisyUI) |
| `mhtmlParser.js` | Reads `.mhtml` snapshot files so they can be displayed |
| `api/server.js` | Same server, packaged for deployment on Vercel |

## How to run it

**1. Install the dependencies** (only needed once):
```
npm install
```

**2. Start the server:**
```
npm start
```

Then open your browser to **http://localhost:3000**

### If you're editing styles (Tailwind CSS)

Run this instead — it rebuilds the CSS automatically as you edit:
```
npm run dev
```

## Deploying

This is set up to deploy on **Vercel** out of the box (see `vercel.json`) — just push and connect the repo, no extra config needed.
