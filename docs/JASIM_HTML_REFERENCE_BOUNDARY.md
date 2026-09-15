# JASIM HTML Reference Boundary

## Purpose

When a reference HTML file is supplied for JASIM's Conversation or Smart
Bubble interface, use it as a **visual and interaction reference only**. It
must never become a source of product logic, intelligence, authorization, or
state truth.

## Required implementation command

Use this instruction verbatim when handing a reference HTML file to an
implementation agent:

> **REFERENCE-HTML BOUNDARY:** Match the supplied HTML's visual identity and
> interaction language — layout, RTL/LTR behavior, spacing, palette,
> typography, motion, responsive transitions, Bubble shapes, expansion and
> collapse affordances, loading states, and accessibility behavior. Do not copy
> its static JavaScript as application logic. JASIM Runtime remains the sole
> source of conversations, Smart Bubbles, Bubble state, reference resolution,
> Runs, Tasks, permissions, policy, approvals, and execution truth. Replace
> mock data and scripted outcomes with typed runtime calls; keep the model
> untrusted and propose-only. A World Runtime may be shown only as the durable
> internal state of its persistent Smart Bubble, never as a separate product,
> route, or domain template.

## Implementation split

| Match from reference HTML | Must come from JASIM Runtime |
| --- | --- |
| Visual identity, glass/material treatment, typography, spacing, RTL details, motion curves, Bubble geometry, responsiveness | Conversation history, message ordering, Bubble identity and content, semantic descriptions, current Bubble projection/state, permissions, references, model output validation |
| Interaction affordances: compose, expand, minimize, close, retry, inspect, loading/error/empty states | Which interaction is allowed, target resolution, state transition, persistence, event recording, optimistic concurrency, approvals, capabilities, Runs and DAG lifecycle |
| Decorative canvas, particles, static presentation transitions | No decision-making, mock workflows, direct API calls, domain-specific templates, unsafe client-side execution, or fabricated success states |

## Architectural guardrails

1. A **Smart Bubble** is the user-facing unit. A persistent Bubble can have one
   optional durable World Runtime behind it. No Bubble is a static
   domain-specific template.
2. A **Run** is a general durable unit of work. It may represent selling a car,
   advertising a service, booking, price monitoring, recruitment, or any other
   workflow with no persistent Bubble at all.
3. The UI renders Runtime-provided projection data. It must not infer policy,
   create durable world state, or decide execution outcomes from static
   JavaScript.
4. If the reference visual design conflicts with runtime safety, ownership,
   permissions, accessibility, or responsive correctness, preserve runtime
   truth and adapt the presentation.