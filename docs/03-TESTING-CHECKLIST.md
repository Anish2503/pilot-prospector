# Testing checklist

Work through this once before you hand the link to your team. It takes about
20 minutes and covers everything the app does.

Tick each box. If anything does not behave as described, tell me exactly what
you did and what happened.

---

## Before you start

You will need:

- A computer with the app open
- **Your phone**, on the same Wi-Fi (or using the live Netlify link)
- The sample file `docs/sample-leads.xlsx`, or your own spreadsheet

---

## 1. The front door

- [ ] Opening the app shows a landing page with **Login as Admin** and **Login as BDM**
- [ ] Both buttons lead to their own sign-in screen
- [ ] Each sign-in screen has a link across to the other one

## 2. Admin sign-in

- [ ] Your username and password sign you in
- [ ] A wrong password says *"Incorrect username or password"* — and does not reveal which was wrong
- [ ] Getting it wrong 5 times locks the account for 15 minutes
  *(skip this one unless you want to wait it out)*
- [ ] After signing in you land on the Dashboard

## 3. Uploading leads

- [ ] **Upload Leads** → drop in the spreadsheet
- [ ] It correctly guesses which column is the society name, units, area, city
- [ ] The summary shows rows detected, ready to import, duplicates, and rejects
- [ ] With the sample file you should see **20 ready · 1 duplicate · 1 cannot import**
- [ ] **Download the problem rows** produces a CSV naming the bad rows
- [ ] Importing shows a progress bar, then a summary
- [ ] The leads appear on the Leads page immediately afterwards

**Now upload the same file a second time:**

- [ ] It reports everything as *skipped*, and no duplicates are created

## 4. Leads table

- [ ] Search finds a society by name
- [ ] Search also finds one by **area**, and by a **POC phone number**
- [ ] Filters work: by BDM, status, city, area, POC collected, missing location
- [ ] Clicking a column heading sorts by it; clicking again reverses it
- [ ] Paging back and forth never shows the same society twice
- [ ] **Export** downloads an Excel file that opens correctly
- [ ] Exporting *without* ticking "include contact details" leaves POC columns out

## 5. Locations

- [ ] The page shows how many societies have no coordinates
- [ ] **Find locations** works through them one per second, listing each result
- [ ] Results are labelled high / medium / low confidence
- [ ] Low-confidence ones land in **Needs your review** rather than being trusted
- [ ] In the review list you can **Accept**, **Reject**, or **Enter by hand**
- [ ] After accepting, that society appears on the map

## 6. Map

- [ ] Pins appear, coloured by status, with a legend underneath
- [ ] Zooming out groups them into numbered clusters
- [ ] Clicking a pin shows the society name, units, area and who it is assigned to
- [ ] **Open lead** in the popup opens the full detail panel
- [ ] The filters narrow the pins down

## 7. BDMs

- [ ] **Add BDM** creates one and shows a 4-digit PIN in a large box
- [ ] Trying PIN `1234` is rejected as too easy to guess
- [ ] **New PIN** generates a different random one
- [ ] Adding a second BDM with the same name is refused
- [ ] **Reset PIN** produces a new PIN
- [ ] **Disable** removes them from the BDM sign-in list

## 8. Assigning

- [ ] Tick several leads → **Assign to BDM** → they show that BDM's name
- [ ] Open a lead → **Reassign** to a different BDM
- [ ] The lead's **Assignment history** shows both, with dates, old one marked *Reassigned*
- [ ] **Remove assignment** sets it back to Unassigned

## 9. The BDM experience — **do this on your phone**

Sign out, then **Login as BDM**.

- [ ] Your name is in the dropdown
- [ ] The 4 PIN boxes are big enough to tap accurately
- [ ] Entering the PIN signs you in
- [ ] The browser asks for location — the reason is explained before it asks
- [ ] **Allow** → leads reorder with the nearest first, each showing "1.2 km away"
- [ ] The note *"Distances are straight-line, not driving distance"* is visible
- [ ] Sort can be changed to farthest / recently updated / name
- [ ] **Deny location instead** (in browser settings) → a clear message appears and the list still works, sorted by name

Open a society:

- [ ] Name, address, distance and status are shown
- [ ] **Directions** opens Google Maps to that place
- [ ] Fill in remarks, units, competitor, POC name, designation and phone → **Save update**
- [ ] The update appears under **Previous updates**
- [ ] Add a **second** update with only a remark
- [ ] ✅ **The POC name and phone from the first update are still there** — this is the important one
- [ ] Both remarks are still readable separately

Test the bad-signal protection:

- [ ] Start typing a remark, then close the tab without saving
- [ ] Reopen that society — your text is still there, with an option to discard it

## 10. Security — worth doing once

- [ ] Assign a lead to **BDM A** only
- [ ] Sign in as **BDM B** — that lead must **not** appear in their list
- [ ] While signed in as BDM B, copy BDM A's lead URL (`/bdm/lead/<id>`) and paste it in
- [ ] ✅ It must say the society is not in your list — **not** show you the data
- [ ] Sign in as admin, **disable** a BDM, then try to sign in as them → refused

## 11. Analytics and activity

- [ ] Analytics shows KPIs, charts and the per-BDM table
- [ ] Choosing a BDM in **Individual BDM** shows just their figures
- [ ] The date filters change the numbers
- [ ] **Activity** lists everything you have just done — uploads, assignments, visits
- [ ] Filtering by *BDMs* shows only BDM actions
- [ ] Exporting the activity log downloads a CSV

## 12. Admin management

- [ ] **Add Super Admin** creates one and shows the username and password once
- [ ] Sign out and sign in as that new admin — they can do everything you can
- [ ] They can create yet another admin (all admins are equal)
- [ ] **Change my password** requires the current one first
- [ ] You **cannot** disable your own account
- [ ] The **last remaining** active admin cannot be disabled

---

## When something goes wrong

Send me:

1. What you were doing
2. The exact message shown on screen
3. Whether it was on the computer or the phone

If it is a technical error, press **F12** on the computer, click **Console**,
and copy anything in red.
