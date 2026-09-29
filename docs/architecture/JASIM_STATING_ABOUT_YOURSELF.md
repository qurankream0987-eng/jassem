# JASIM — A PERSON CAN SAY SOMETHING ABOUT THEIR OWN THING

## THE GAP

**No turn wrote an attribute anywhere.** `proposeTurn` created its need with
`attributes: {}` and nothing ever put anything in it, so the need a conversation
created was permanently empty. Two things that had just been built could
therefore never work from a conversation at all:

- **proximity had no origin** — «ابحث عن مكانيكي» could not search *near* you
- **disclosure had nothing to release** — «أرسل له موقعي» found no location

The person could say it, and JASIM had nowhere to put it.

---

## THE DISTINCTION

> **A FACT ABOUT ME IS NOT A REQUIREMENT OF THEM**

| Sentence | What it is | Where it lives |
|---|---|---|
| «أريد مكانيكياً ضمن 25 كم» | a **constraint** — what a candidate must satisfy | the need's hard constraints |
| «أنا عند الدوار الخامس» | an **attribute** — what is true of me | the subject's attributes |

Conflating them turns my own location into something candidates get filtered
against, which is not a sentence anybody meant.

The dispatch for this verb is **label-driven on purpose**. «أنا عند الدوار» is
a fact and «قرب الدوار» is a requirement; only the classifier can tell those
apart, so a keyword heuristic here would silently turn requirements into facts
about the person.

---

## WHAT A MODEL'S READING OF MY SENTENCE IS WORTH

> **MODEL_EXTRACTION != OWNER_DECLARATION**

I said words; something turned them into a value. That value may be right and
it is still not me speaking — so it lands **INFERRED**, and an INFERRED value
already decides nothing anywhere in this runtime. It becomes **STATED** at the
moment I look at what was recorded and say yes, which is the only point at which
I actually declared it.

Proven both ways: an unconfirmed point that *would have passed* a 25 km bound
does not admit the candidate either. A guess that admits is as wrong as one that
excludes.

---

## THE RULES AROUND IT

| Law | Behaviour |
|---|---|
| `OWNER_STATES_ONLY_THEIR_OWN` | stating a fact about somebody else's thing is refused in one line |
| `STATING_IS_NOT_PUBLISHING` | the public projection is untouched; telling JASIM is not telling the world |
| `MODEL_NAMES_THE_SEARCH_ORIGIN = 0` | the origin is read from the person's own subject; an envelope claiming a point is ignored |
| `AMBIGUOUS_YES_TAKES_THE_CHEAPEST_MEANING = 0` | a bare «أوافق» is offered to the **release** first, then the publication, then the private record — ordered by what a wrong answer costs |

---

## ONE SUBJECT, FROM THE FIRST SENTENCE TO THE LAST

> **ONE_CONVERSATION_ONE_SUBJECT_OF_MINE**

`proposeTurn` used to create a fresh, empty expression every time, so everything
the person had already said about themselves was left on an object nothing
downstream would look at again. It now reuses the one the conversation has been
about.

When the pursuit changes, the **type** follows it — «أنا عند الدوار» said before
any search leaves the subject untyped, and the search that follows says what it
is about. The **attributes do not move**:

> **A FACT ABOUT ME IS NOT A FACT ABOUT THE TOPIC**

Where I am and what my gate code is are true of me whatever I happen to be
asking for.

---

## THE WHOLE STORY, FROM SENTENCES ALONE

```
«أنا عند الدوار»            → recorded, INFERRED, decides nothing
«أوافق»                     → now STATED, it is my own word
«ابحث عن …» (ضمن 25 كم)     → searched FROM where I am
«خذ الأولى» · «اطلبها»      → selected, requested
«أقبل» (الطرف الآخر)        → inside bounds they set in advance
«أرسل له موقعي»             → shown, with whose word it is
«أوافق»                     → released, to one person, nothing published
```

The release turn names the provenance of what it is about to hand over — «كما
ذكرتَه» when the person stated it, «كما فهمتُه من كلامك» when JASIM only read it
out of a sentence. That difference matters most at the exact moment the value
leaves.

---

## GENERALITY

The same turn records a location, a gate code, a humidity window, a site access
note, a contact preference and a vessel draft. The attribute writer's body names
no field at all.

> **DOMAIN_ATTRIBUTE_TYPES_ADDED = 0**

`tests/block31/stating-about-yourself.test.ts` — 14 tests.
