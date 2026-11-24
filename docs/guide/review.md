# Review Inbox

The Review inbox is where owners see changes Hearth suggests to the memory and routines they own. **Nothing changes until an owner approves.**

::: info Turned on per organization
The Review inbox is part of the knowledge loop. An admin or operator turns it on for the organization (see [Admin Guide](/admin/#knowledge-loop)). When it is off, there is no **Review** item in the sidebar.
:::

## Where it comes from

While people work, Hearth quietly notes moments where the AI may be missing something: a search that found nothing, a thumbs-down, a person correcting an answer, an owner rewriting a routine's output, a failed run. See [How Hearth Learns From Gaps](/guide/memory#how-hearth-learns-from-gaps).

Every night a **curator** reads these notes. When at least two of them point at the same memory entry or routine, it drafts a small fix and puts a card in the owner's inbox.

## Who gets a card

You get a card only for things you own:

- **Org memory and org routines** — admins.
- **Team memory and team routines** — admins and that team's leads.
- **Your personal memory and routines** — you.
- An admin can also name an extra owner for an item.

Members do not see anything new in chat. If you change team or role, cards follow the new owners.

You get at most five new cards a day. Extra cards arrive on the next days.

## Reading a card

Open **Review** in the sidebar. Each card shows:

- **Header** — "Proposal from the curator", what it changes, and who owns it.
- **What changes** — the current text and the proposed text, side by side (one above the other on a phone).
- **Why** — the curator's reason and what it saw, such as "3 agents flagged a gap. 2 people corrected an answer." You see a quote or a link only when you can open where it came from. A correction from someone's private chat shows as "A member corrected an answer", with no quote.
- **Who it affects** — everyone in the organization, one team, or one person, and any routine it changes.

For a routine, a card only changes the routine's instructions. It never changes who receives it, when it runs, or who can use it.

## Approve, edit or reject

- **Approve** saves the proposed text as a new version. You can roll it back later from the item's history.
- **Edit** lets you change the text first, then **Save and approve**.
- **Reject** turns it down. You can say why (optional). The curator reads your reason and will not suggest the same fix again.

If someone changed the item after the card was made, Hearth shows the text that is there now. Check it, then approve again to apply the change on top of it.

When you approve a fix to a routine, Hearth also saves a [test case](/guide/routines#versions-dry-runs-and-tests) with the words the fix added. If a later card would remove words an earlier fix added, Hearth shows which test case it breaks. Edit the text to keep them, or choose **Approve anyway**.

Everything works with the keyboard: Tab to a button, Enter to press it, Escape to cancel an edit or a rejection.

## Daily summary and reminder

Hearth does not ping you for each card. Instead:

- At 9am in your timezone, your daily digest gets **one line** when cards wait for you — for example "3 proposals wait in Review", or "1 proposal for Customer update steps" when they are all about one item. Nothing waits, nothing is added.
- When a card has waited **7 days**, that line comes with **one reminder** ("Waiting a week: …"). It is sent once per card, never again.
- Clicking the item in the bell opens Review.
- Email is off by default. Turn on **Email the review summary** in Settings → Profile to get it by email too.
- Turn off **Daily review summary** to stop both the line and the reminder.

Your timezone comes from your profile. With no timezone set, Hearth uses UTC.

Approving or rejecting a card sends nothing to anyone. The people whose feedback led to a fix see one quiet line on their Activity page: "Your input improved N things this week."

