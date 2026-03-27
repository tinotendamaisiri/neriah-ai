# WhatsApp Conversation Flow

See CLAUDE.md Section 5 for the authoritative state machine specification.
This document contains worked examples and edge case notes.

## State Diagram

```
IDLE ──────────────────────────────────────────────────────────
  │ "setup class"                                             ▲
  ▼                                                           │
CLASS_SETUP ──────────────────────────────────────────────── "done"
  │ (class name + education level collected)
  ▼
AWAITING_REGISTER
  │ (register photo OCR'd or names typed or "skip")
  ▼
AWAITING_ANSWER_KEY
  │ (question paper photo or "generate" or manual Q&A)
  ▼
MARKING_ACTIVE ◄────────────────────────────────────── (return here)
  │                         │
  │ image received          │ "done" or "stop"
  ▼                         ▼
[pipeline runs]            IDLE
  │
  └→ send annotated image + score

ERROR ──── any message ──→ IDLE
```

## Worked Example: First-Time Teacher

```
Teacher: hi

Neriah:  Hi! I'm Neriah, your AI marking assistant.
         Here's what I can do:
         • Type 'setup class' — create a new class
         • Type 'mark' — start marking books
         • Type 'answer key' — upload or generate a marking scheme

Teacher: setup class

Neriah:  Let's set up a new class. What is the class name?

Teacher: 3B Maths

Neriah:  [education level menu]
         What education level is this class?
         1. Grade 1 ... 7. Grade 7 ... 14. Tertiary

Teacher: 3

Neriah:  Class created! Now let's add your students.
         Photograph the register page, or type names one per line.
         Reply 'skip' to add students later.

Teacher: [sends register photo]

Neriah:  I found 38 students. Here are the first 5:
         1. Tendai Moyo, 2. Rudo Chikwanda, ...
         Reply 'confirm' to save all, or correct any names.

Teacher: confirm

Neriah:  38 students saved. Now let's set up the answer key.
         Photograph the question paper or type 'generate'.

Teacher: [sends question paper photo]

Neriah:  I've generated a marking scheme with 10 questions.
         Q1: 42 (2 marks), Q2: Paris (1 mark), ...
         Reply 'confirm' to use this scheme, or 'edit' to change it.

Teacher: confirm

Neriah:  Ready to mark! Send a student's book photo.
         You can send photos back-to-back — I'll mark each one.

Teacher: [sends book photo]

Neriah:  [sends annotated image]
         Tendai Moyo — 7/10 (70%) ✓
         Q1 ✓ Q2 ✓ Q3 ✗ Q4 ✓ Q5 ~ Q6 ✓ Q7 ✗ Q8 ✓ Q9 ✓ Q10 ✓

Teacher: [sends next book photo]
...

Teacher: done

Neriah:  Session complete!
         Books marked: 38
         Class average: 6.4/10 (64%)
         Highest: 9/10 | Lowest: 3/10
```

## Edge Cases

### Image quality rejection
```
Teacher: [sends blurry photo]
Neriah:  The photo is blurry. Hold your phone steady and retake.
[session stays in MARKING_ACTIVE — teacher retries]
```

### Session timeout (24h TTL)
```
[Teacher goes inactive for >24h — session document deleted by Cosmos TTL]
Teacher: [sends photo next day]
[session not found → new session created → state = IDLE]
Neriah:  Hi! I'm Neriah... [help menu]
```

### Unknown input in any state
```
Teacher: [sends voice note]
Neriah:  I can only read text and images. Please send the book photo or type a command.
[state unchanged]
```

## TODO
- Add 'help' command handler in every state that shows context-specific guidance
- Add 'cancel' command to abort current flow and return to IDLE
- Document interactive list message flows (education level, class selection)
