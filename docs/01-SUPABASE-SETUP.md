# Step 1 — Create your database (Supabase)

**Time needed:** about 10 minutes.
**Cost:** free. No credit card is asked for.

You only ever do this once.

---

## 1. Create a free Supabase account

1. Go to **https://supabase.com**
2. Click **Start your project**
3. Sign in with GitHub or with an email address — either is fine.

---

## 2. Create the project

1. Click **New project**.
2. Fill in:

   | Field | What to enter |
   |---|---|
   | **Name** | `pilot-prospector` |
   | **Database Password** | Click **Generate a password**, then **copy it and paste it into a note somewhere safe.** You will probably never need it, but it cannot be shown to you again. |
   | **Region** | **South Asia (Mumbai)** — closest to your team, so the app feels fast. |
   | **Plan** | Free |

3. Click **Create new project**.
4. Wait 1–2 minutes while it sets itself up. Go and make a coffee.

---

## 3. Create the tables

This is the part that builds the actual database — the leads, the BDMs, the
assignments, and all the security rules.

1. In the left sidebar, click **SQL Editor**.
2. Click **New query**.
3. In VS Code, open the file `supabase/migrations/001_schema.sql`
4. Select everything in it (**Ctrl+A**), copy it (**Ctrl+C**).
5. Paste it into the Supabase SQL Editor box.
6. Click **Run** (bottom right).
7. You should see **Success. No rows returned.** That is correct.

Now repeat exactly the same steps for the other two files, **in this order**:

- `supabase/migrations/002_security.sql`
- `supabase/migrations/003_functions.sql`

> ⚠️ Order matters. 001 creates the tables, 002 locks them down, 003 adds the
> assignment and analytics logic.

If any of them shows a red error, **stop and tell me the exact error message** —
do not try to fix it yourself.

---

## 4. Collect your four keys

You now need four values. Two are safe for the browser; two are secrets.

### The two safe ones

1. Left sidebar → **Project Settings** (the gear icon at the bottom)
2. Click **Data API**
3. Copy **Project URL** — looks like `https://abcdefghijk.supabase.co`
4. Now click **API Keys** in the same settings menu
5. Copy the **`anon` / `public`** key — a very long string starting with `eyJ...`

### The two secret ones

Still under **Project Settings**:

6. On the **API Keys** page, find **`service_role`** and click **Reveal**, then copy it.
7. Click **JWT Keys** in the settings menu. Look for **JWT Secret** (it may be
   labelled *Legacy JWT Secret*). Click **Reveal** and copy it.

> 🔒 The `service_role` key and the JWT secret can read and change *everything*
> in your database, ignoring all security rules. Never paste them into a chat,
> an email, a screenshot, or any file that goes to GitHub. They belong only in
> the `.env` file on your own computer and in Netlify's settings later.

---

## 5. Put the keys into the app

1. In VS Code, open the file **`.env`** in the project root.
   (I have already created it for you with blanks to fill in.)
2. Replace each `PASTE_...HERE` placeholder with the matching value you copied.
3. Invent your own `SETUP_SECRET` — any long phrase you make up, for example
   `mygate-first-admin-9f2k7x`. You will type it once to create your first admin
   account, then delete it.
4. Put your own email address as `GEOCODER_CONTACT_EMAIL` — OpenStreetMap's free
   service asks for a contact address so they can reach you if something goes
   wrong. It is not shown to anyone.
5. Save the file (**Ctrl+S**).

The `.env` file is already listed in `.gitignore`, so it can never be uploaded
to GitHub by accident.

---

## 6. Start the app

In the VS Code terminal, type:

```
npm run dev
```

Then open **http://localhost:5173** in your browser.

You should see the landing page with **Login as Admin** and **Login as BDM**.

Tell me when you have got this far and I will walk you through creating your
first admin account.
