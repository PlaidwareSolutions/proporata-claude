# Membership vs. portal users (Task #139)

This HOA app has two related-but-distinct concepts. Conflating them is a
governance bug, not a UX preference, so they are kept separate at the
schema and API level.

## Legal members

A **member** is the recorded owner of a unit. Membership is a property
right that runs with title; it is not granted by being given a portal
login.

- Membership is one-per-unit. The `units.owner_email` and `owner_name`
  columns identify the legal owner of record. Co-owner modeling
  (multiple legal members per unit) is out of scope here.
- Membership confers voting rights, the right to run for the board, and
  the right to be counted toward quorum.
- An owner is **in good standing** iff
  `owner_accounts.ownership_status = 'active'`. The other two states —
  `suspended_voting` and `closed` — both block voting.
  - `suspended_voting`: ownership intact, but voting rights are
    suspended (typically because of past-due dues beyond the
    organization's `past_due_voting_threshold_days` setting; default
    60). Recoverable: pay current and rights restore on the next
    `recomputeOwnershipStatuses` run, or immediately via an admin
    override.
  - `closed`: account is closed (sale/transfer in progress, deceased
    estate, etc.). Auto-recompute will not flip a `closed` row; an
    admin must reopen it.

## Portal users

A **user** is a row in the `users` table — anyone who can log in. That
includes:

- **Owners** with a portal login (subset of legal members).
- **Tenants** living in a unit. They are residents, not members. They
  may use the portal for amenities, mail, parking, etc., but they
  cannot vote on motions, run for the board, or be counted toward
  quorum.
- **Managers** and **admins**. Operational accounts; not members
  unless they also separately own a unit.

`users.unit_id` indicates *occupancy*, not ownership. A tenant has
`unit_id` set without owning the unit; the source of truth for
ownership is `units.owner_email` matched against `users.email`.

## Eligibility rule

The single helper `isMemberInGoodStanding(user)` in
`artifacts/api-server/src/lib/membership.ts` is the canonical place to
ask "is this user allowed to cast a member vote right now?". It
returns:

```
{ isMember, inGoodStanding, unitId, ownershipStatus, reason }
```

Callers MUST check `inGoodStanding` (not just `isMember`) before
counting a vote, accepting a candidacy filing, or treating someone as
present for quorum.

## API surface

- `GET /api/members` — manager-only roster (one row per unit). Tenants
  are excluded.
- `POST /api/members/recompute` — manager-only. Re-derives every
  owner's `ownership_status` from the configured past-due threshold.
- `PATCH /api/members/:unitId/status` — admin-only. Manual override.
  All overrides are written to `profile_audit` with the actor user id,
  and the recompute job will not stomp them (it skips rows whose
  `ownership_status_reason` starts with `manual:`).
- `GET /api/settings` exposes `pastDueVotingThresholdDays` (default
  60). Managers may PATCH it via `PATCH /api/settings`.

## What this task did NOT change

- Motion voting is still board-only by `requireBoardMember`. Task #139
  adds a defense-in-depth check that blocks board members whose own
  ownership has lapsed, but it does not open motion voting up to all
  owners. That widening is a separate task.
- Co-owner modeling and proxy voting are out of scope.
- Aged-charge detection mirrors `routes/billing.ts` `deriveStatus`
  semantics; if billing's FIFO logic changes, both paths must move
  together.
