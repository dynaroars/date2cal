// Golden corpus (see ARCHITECTURE.md). Each case is representative of a
// category of real email, not a synthetic edge case (those already live in
// detect.test.js/rules.js coverage). `expect: 'event'` cases assert at
// least one candidate is found, on the right calendar day when
// `expectedDate` is given. `expect: 'none'` cases assert zero candidates --
// these are the precision guardrails: a false positive here is worse than a
// miss on an 'event' case.
//
// referenceDate is fixed per case (rather than shared) so each case reads
// standalone and relative expressions ("tomorrow") are checked against a
// realistic "message sent on this date" anchor.

const REF_SEP = new Date('2026-09-18T09:00:00-04:00') // Tuesday

export const CORPUS = [
    // ---- event: explicit invites --------------------------------------
    {
        name: 'team meeting with room',
        subject: 'Team meeting this week',
        body: "Hi all,\n\nLet's meet on Tuesday, October 6, 2026 at 2:00 PM in Room 301 to go over Q4 planning.\n\nThanks,\nAlex",
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-06',
    },
    {
        name: 'seminar announcement with range',
        subject: 'CS Colloquium: Distributed Systems',
        body: 'The colloquium will be held on Thursday, October 8, 2026 from 3:00 PM to 4:15 PM in the Nguyen Engineering Building, Room 4705.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-08',
    },
    {
        name: 'dissertation defense',
        subject: 'Dissertation Defense Announcement',
        body: 'You are invited to the dissertation defense of Jane Doe. Monday, September 28, 2026, 10:00 AM - 12:00 PM, Nguyen Engineering Building.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-28',
    },
    {
        name: 'casual quick sync',
        subject: 'quick sync?',
        body: 'hey, can we sync tomorrow at 3pm? just need 15 min.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-19',
    },
    {
        name: 'recurring standup',
        subject: 'Standup schedule',
        body: 'Reminder: our standup is weekly, every Monday at 9am, starting next Monday.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-21',
    },
    {
        name: 'webinar with timezone',
        subject: 'Webinar: Intro to WebExtensions',
        body: 'Join us for the webinar on October 6 at 11am PST / 2pm EST. Link to follow.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-06',
    },
    {
        name: 'interview scheduling',
        subject: 'Interview confirmation',
        body: 'This confirms your interview on Friday, November 13, 2026 at 6:30 PM. Please arrive 10 minutes early.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-11-13',
    },
    {
        name: 'doctor appointment reminder',
        subject: 'Appointment Reminder',
        body: 'This is a reminder of your appointment on December 3 at 11:00 AM with Dr. Lee.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-12-03',
    },
    {
        name: 'office hours',
        subject: 'Office hours this week',
        body: 'Office hours Thursday 2-4 PM in my office, or by appointment.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-24',
    },
    {
        name: 'conference multi-day',
        subject: 'Conference registration confirmed',
        body: 'Your registration for the conference is confirmed. The event runs Oct 6-8, 2026 at the downtown convention center.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-06',
    },
    {
        name: 'deadline shorthand',
        subject: 'Submission deadline',
        body: 'Just a reminder: please submit your report by EOD Thursday.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-24',
    },
    {
        name: 'video call with zoom link',
        subject: 'Standup',
        body: 'Standup tomorrow at 9am. Join here: https://zoom.us/j/123456789',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-19',
    },
    {
        name: 'all-day retreat',
        subject: 'Team retreat',
        body: 'The team retreat is on October 12. Please block your calendar.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-12',
    },
    {
        name: 'bare ordinal day',
        subject: 'Follow-up',
        body: "Let's follow up on the 23rd at 4 to review progress.",
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-23',
    },
    {
        name: 'duration cue sets end time',
        subject: 'Quick sync',
        body: "30-min sync Tuesday 2pm to go over the proposal.",
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-22',
    },
    {
        name: 'next-week relative phrasing',
        subject: 'Planning call',
        body: "Let's plan for next Monday at 10am to discuss the roadmap.",
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-21',
    },
    {
        name: 'informal slash date with time',
        subject: 'Reminder',
        body: 'Reminder: 10/06/2026 at 14:00, dial-in details to follow.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-06',
    },
    {
        name: 'ISO datetime in a system-generated note',
        subject: 'Scheduled maintenance window',
        body: 'The maintenance window is scheduled for 2026-10-06T14:00:00. Expect brief downtime.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-06',
    },
    {
        name: 'no-year month/day',
        subject: 'Save the date',
        body: 'Save the date -- our holiday party is on December 3 at 11:00 AM.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-12-03',
    },
    {
        name: 'spelled-out clock fraction',
        subject: 'Call reminder',
        body: 'Call at half past three on Monday to go over the contract.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-09-21',
    },

    // ---- event: .ics structured invites (Layer 1) ----------------------
    {
        name: 'ics calendar invite',
        subject: 'Invitation: Q4 Planning Sync',
        body: 'See attached invite.',
        referenceDate: REF_SEP, expect: 'event', expectedDate: '2026-10-06',
        icsTexts: [[
            'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
            'DTSTART:20261006T180000Z', 'DTEND:20261006T190000Z',
            'SUMMARY:Q4 Planning Sync', 'LOCATION:Room 4705',
            'END:VEVENT', 'END:VCALENDAR',
        ].join('\r\n')],
    },

    // ---- none: precision guardrails ------------------------------------
    {
        name: 'software release notes',
        subject: 'Release notes: v10.2',
        body: 'We shipped version 10.2 today with several bug fixes and performance improvements.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'order shipment notice',
        subject: 'Your order has shipped',
        body: 'Total: 12/19 items shipped to your address. Track your package for delivery updates.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'quarterly newsletter with past reference',
        subject: 'Q3 2026 Newsletter',
        body: 'Our Q3 2026 results were announced on March 3, 2021. Copyright (c) 2026 Acme Inc. version 10.2. Unsubscribe here.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'invoice with reference number',
        subject: 'Invoice #12/19 due',
        body: 'Your invoice reference 12/19 is due upon receipt. Please remit payment promptly.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'marketing promo with no date',
        subject: '50% off everything!',
        body: 'Shop our biggest sale of the year. Free shipping on all orders. Unsubscribe anytime.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'security alert with build number',
        subject: 'Security update available',
        body: 'A critical security patch (build 10.2) is available. Please update as soon as possible.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'password reset notice',
        subject: 'Your password was changed',
        body: 'Your account password was changed successfully. If this was not you, contact support immediately.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'shipping tracking with order number',
        subject: 'Package tracking update',
        body: 'Your order, reference number 12/19, is now out for delivery.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'past appointment summary (receipt)',
        subject: 'Your visit summary',
        body: 'Thank you for visiting us on March 3, 2021. We hope to see you again soon.',
        referenceDate: REF_SEP, expect: 'none',
    },
    {
        name: 'plain text signature with copyright',
        subject: 'Re: project update',
        body: 'Sounds good, thanks!\n\n--\nJane Doe\nAcme Inc.\nCopyright (c) 2026 Acme Inc. All rights reserved.',
        referenceDate: REF_SEP, expect: 'none',
    },
]
