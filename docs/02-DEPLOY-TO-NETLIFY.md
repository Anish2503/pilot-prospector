# Step 2 — Put the app online

**Time needed:** about 20 minutes the first time.
**Cost:** free.

At the end of this you will have **one web address** you can send to your whole
team. After that, any change I make goes live automatically when it is pushed.

You do not need to understand Git. Just type the commands exactly as written.

---

## Part 1 — Put your code on GitHub (10 minutes)

GitHub is where the code lives. Netlify reads it from there.

### 1.1 Create a free GitHub account

Go to **https://github.com** and sign up, if you do not already have an account.

### 1.2 Create an empty repository

1. Click the **+** in the top-right → **New repository**
2. **Repository name:** `pilot-prospector`
3. **Visibility:** choose **Private** — this is internal company code
4. **Do NOT** tick "Add a README file" or add a .gitignore. Leave it completely empty.
5. Click **Create repository**
6. Leave that page open — you will need the address on it in a moment.

### 1.3 Tell Git who you are

In VS Code, open the terminal (**Terminal → New Terminal**) and type these two
lines, replacing the name and email with your own:

```
git config --global user.name "Anish Suneja"
git config --global user.email "you@example.com"
```

### 1.4 Upload the code

Still in the VS Code terminal, run these lines **one at a time**:

```
git init
```
```
git add .
```
```
git commit -m "Pilot Prospector - BDM lead management"
```
```
git branch -M main
```

Now connect it to the repository you just made. Replace `YOUR-USERNAME` with
your actual GitHub username:

```
git remote add origin https://github.com/YOUR-USERNAME/pilot-prospector.git
```
```
git push -u origin main
```

A browser window may pop up asking you to sign in to GitHub. Do that, and the
upload will finish.

> ✅ **Check:** refresh your GitHub repository page. You should see all the
> folders — `src`, `netlify`, `supabase`, `docs`.
>
> 🔒 **Also check:** there is **no `.env` file** in the list. There should not
> be — it is deliberately excluded. If you somehow see one, stop and tell me.

---

## Part 2 — Deploy on Netlify (10 minutes)

### 2.1 Create a free Netlify account

Go to **https://netlify.com** → **Sign up** → choose **GitHub** as the sign-up
method. This links the two accounts automatically.

### 2.2 Import the project

1. Click **Add new site** → **Import an existing project**
2. Choose **Deploy with GitHub**
3. Authorise Netlify when asked, then pick **pilot-prospector** from the list

Netlify reads the settings from the `netlify.toml` file I have already written,
so the build settings should fill themselves in:

| Setting | Value (should already be filled) |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

**Do not click Deploy yet.** Add the settings first — see the next step.

### 2.3 Add your settings

Click **Add environment variables** (or, if you already deployed, go to
**Site configuration → Environment variables**).

Add these **seven** variables. The values are the same ones already in your
local `.env` file — open it in VS Code and copy each across.

| Name | Where it came from |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / public key |
| `VITE_APP_NAME` | `Pilot Prospector` |
| `SUPABASE_URL` | The same Project URL again |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key 🔒 |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret 🔒 |
| `GEOCODER_CONTACT_EMAIL` | Your email address |

> 🔒 The two marked with a padlock are powerful secrets. They are safe in
> Netlify — they stay on Netlify's servers and are never sent to a browser.
> Only the three beginning `VITE_` reach the user's device.

**Do NOT add `SETUP_SECRET`.** You already created your admin account, so it is
no longer needed. Leaving it out means nobody can ever run the setup page again.

### 2.4 Deploy

Click **Deploy pilot-prospector**. It takes about a minute.

When it finishes you get an address like:

```
https://spontaneous-marzipan-a1b2c3.netlify.app
```

### 2.5 Give it a friendlier name

1. **Site configuration → General → Site details → Change site name**
2. Type something like `mygate-bdm` and save

Your address becomes:

```
https://mygate-bdm.netlify.app
```

**That is the single link you share with your team.**

---

## Part 3 — Check it works

Open your new address on a computer and try:

- [ ] The landing page appears with **Login as Admin** and **Login as BDM**
- [ ] You can sign in as admin with your username and password
- [ ] The dashboard shows your leads
- [ ] The map loads and shows pins
- [ ] The Leads page loads

Then open it **on your phone** and try:

- [ ] Sign in as a BDM using their name and PIN
- [ ] The browser asks for location permission — allow it
- [ ] Your leads are sorted nearest first
- [ ] Open a society and save a test update

> 📱 Location only works over `https`. Your Netlify address is https, so this
> works there even though it may not on a plain `http` address.

---

## Part 4 — Making changes later

Whenever I change something, put it live with these three lines:

```
git add .
```
```
git commit -m "describe what changed"
```
```
git push
```

Netlify notices the push and rebuilds automatically, usually within two minutes.
You do not need to touch Netlify again.

---

## What it all costs

| Service | Free allowance | Realistic use for your team | Cost |
|---|---|---|---|
| **Netlify** | 100 GB traffic, 300 build minutes/month | A handful of users, a few deploys | **₹0** |
| **Supabase** | 500 MB database, 5 GB traffic/month | 10,000 leads uses well under 100 MB | **₹0** |
| **OpenStreetMap tiles** | Free, fair-use | Normal team browsing | **₹0** |
| **Nominatim geocoding** | Free, 1 lookup/second | One-off runs after each upload | **₹0** |
| **GitHub** | Unlimited private repos | One repository | **₹0** |

**No credit card is needed for any of the above.**

### Two honest warnings

1. **Supabase pauses free projects after 7 days of no activity.** Your team
   using the app daily prevents this. If it does pause, open the Supabase
   dashboard and click Restore — it takes a minute and loses nothing.

2. **Nominatim is a volunteer-run service.** It is genuinely free but limited to
   one lookup per second, and its accuracy on Indian society names is fair
   rather than excellent. If you later import tens of thousands of leads, tell
   me and I will switch the location lookup to Google's Geocoding API — that
   needs a Google Cloud billing account with a card on file, and costs roughly
   **$5 per 1,000 lookups** after the free monthly credit. The code is already
   written so this is a small change, not a rewrite.

---

## If something goes wrong

**The site shows "The app is not configured yet"**
An environment variable is missing or misspelled in Netlify. Check all seven
against the table above, then **Deploys → Trigger deploy → Clear cache and
deploy site**.

**Login says "The server is having trouble"**
Usually `SUPABASE_URL` has extra text on the end. It must be exactly
`https://yourproject.supabase.co` — no `/rest/v1/`, no trailing slash.

**"Incorrect username or password" but you are certain it is right**
Five wrong attempts locks an account for 15 minutes. Wait it out, or have
another Super Admin reset the password.

**Anything else** — copy the exact message and send it to me.
