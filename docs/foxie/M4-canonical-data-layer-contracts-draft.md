# M4 — Foxie Canonical Data Layer Contracts (DRAFT)

**Date:** 2026-03-11
**Status:** DRAFT — Sections 1, 2, and 3 substantially complete; portal-as-universal-container decision pending
**Scope:** Foundational entity schema, supporting tables, automation cluster, API contract, integration interfaces
**Upstream inputs:** foxie-canonical-data-model-decisions.md, foxie-authentication-identity-design.md, decision-twenty-reference-not-adopt.md
**Next:** Resolve portal-as-universal-container architectural decision; revise Formbricks and Temporal M3 contracts

---

## Purpose

This document defines the contracts for Foxie's canonical data layer — the Foxie-owned schema and API surface that sits above all OSS components. It replaces the CRM-related sections of the M3 draft contracts, which were written against Twenty's data model constraints and are no longer applicable.

The document is being written in stages. Schema definitions are produced in conversation and locked before being handed to agents. Agents cross-reference OSS code and handle implementation scoping — they do not make schema design decisions.

The OSS components (Formbricks, Temporal) remain relevant for their specific domains. Their M3 contracts require only modest revision and are addressed in Section 3. The CRM layer is entirely Foxie-owned.

---

## What Is and Is Not In Scope

**In scope:**
- Foundational entity schema: the tables everything else depends on
- Supporting tables: channels, external ID mapping, audit
- API contract: the operations and filter language the CRM data service must support
- Integration interfaces: how Temporal, Formbricks, and the identity layer connect to this layer

**Not in scope (deferred to later milestones):**
- FeedbackRequest and CollectionRun entity schemas — depend on the foundational layer being locked first
- Reporting and answer row schema — depend on FeedbackRequest
- Implementation framework, ORM choice, or deployment architecture
- Foxie's UI layer or frontend data access patterns

---

## Section 1 — Foundational Entity Schema

### 1.1 — `contact`

The contact is a pure identity record. It carries only the information needed to identify a person and communicate with them. All relational context — which companies or projects they are associated with, in what role — lives in the `association` table. All communication channel details live in `contact_channel`. All external system mappings live in `external_id_mapping`.

```
contact
  id                    UUID          primary key — system generated
  organisation_id       UUID          required — tenant isolation; matches organisation_id in identity token
  first_name            TEXT          required
  last_name             TEXT          required
  language              TEXT          required — BCP 47 language code ('fi', 'en', 'sv', 'de', etc.)
  date_soft_deleted     TIMESTAMPTZ   nullable — soft delete marker; null means active; set on deletion, never unset
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Design notes:**
- No email column on the contact table itself. Email is a channel and lives in `contact_channel` with `channel_type = 'email'`. This keeps the contact table stable as new channel types are added.
- No company or organisation foreign keys. All association context lives in the polymorphic `association` table.
- Language is required from creation. If unknown at import time, default to the organisation's configured default language rather than null. Null language on a contact would cause downstream failures in communication template selection.
- `date_soft_deleted` is a date rather than a boolean so the deletion timestamp is queryable for audit and reporting purposes. All queries against active contacts filter `date_soft_deleted IS NULL`.
- Audit history (who created, who modified, what changed) lives in the shared `audit_event` table, not on this table. Only `date_soft_deleted` is on the table because soft delete directly affects query filtering.

**Indexes:**
- Primary: `id`
- Tenant scoping: `(organisation_id)` — all queries are tenant-scoped first
- Active contact lookups: partial index on `(organisation_id) WHERE date_soft_deleted IS NULL`
- Full-text search: `search_vector` tsvector column (generated from `first_name || ' ' || last_name`) with GIN index — added when search service is implemented

---

### 1.2 — `contact_channel`

Communication channels for a contact. Each row represents one way of reaching the contact via one channel type. One channel per type can be marked as primary.

```
contact_channel
  id                    UUID          primary key — system generated
  organisation_id       UUID          required — tenant isolation
  contact_id            UUID          required — FK to contact.id; CASCADE on delete
  channel_type          TEXT          required — slug from channel_type_registry: 'email', 'slack', 'sms', 'whatsapp'
  channel_value         TEXT          required — the address, ID, or number for this channel
  is_primary            BOOLEAN       required — whether this is the primary channel of its type for this contact
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Design notes:**
- `channel_type` is governed by a `channel_type_registry` (see Section 1.5). New channel types are added to the registry — no schema migration required.
- One primary per channel type per contact is enforced by a partial unique index: `UNIQUE (contact_id, channel_type) WHERE is_primary = true`. Application layer enforces that setting a new primary for a given type un-sets the previous primary atomically.
- `channel_value` format validation is channel-type-specific and enforced at the application layer, not the database layer. Email addresses are validated on write; Slack user IDs have a different format; phone numbers are stored in E.164 format.
- No soft delete on channel rows. When a channel is removed it is deleted. The `audit_event` table captures channel removal events.

**Indexes:**
- `(contact_id)` — primary access pattern: all channels for a contact
- `(organisation_id, channel_type, channel_value)` — lookup by channel value: "which contact has email X"
- Partial unique: `(contact_id, channel_type) WHERE is_primary = true` — enforces one primary per type

---

### 1.3 — `association`

The canonical relationship layer. All associations between any entities in Foxie's domain — contacts to organisations, activities to contacts, analysis results to entities — are stored here. See `foxie-canonical-data-model-decisions.md` Decision 2 for the full design rationale.

```
association
  id                    UUID          primary key — system generated
  organisation_id       UUID          required — tenant isolation
  association_class     TEXT          required — 'entity_relationship' or 'activity_link'
                                                 (denormalised from association_type_registry at write time)
  from_object_type      TEXT          required — e.g. 'contact', 'organisation_entity', 'note'
  from_object_id        UUID          required — ID of the entity on the left side (loose FK — application enforced)
  to_object_type        TEXT          required — e.g. 'organisation_entity', 'contact'
  to_object_id          UUID          required — ID of the entity on the right side (loose FK — application enforced)
  association_type      TEXT          required — slug from association_type_registry
  status                TEXT          required — 'active' | 'archived'
  review_status         TEXT          nullable — 'confirmed' | 'unsure' | 'excluded' | null
                                                 (entity_relationship class only; null for activity_link class)
  activation_timestamp  TIMESTAMPTZ   nullable — when this relationship was formed or activated
                                                 (entity_relationship class only)
  archival_timestamp    TIMESTAMPTZ   nullable — when this relationship was archived
                                                 (entity_relationship class only)
  properties            JSONB         nullable — type-specific Tier 2 metadata (governed by association_type_registry)
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
  deleted_at            TIMESTAMPTZ   nullable — soft delete
  created_by            UUID          nullable — user or system actor ID
```

**Design notes:**
- Polymorphic FK enforcement is an application responsibility. The service layer validates that `from_object_id` and `to_object_id` resolve to existing entities before writing. Delete hooks cascade-archive associations when an entity is deleted. A periodic integrity audit job scans for dangling references.
- `association_class` is denormalised from the type registry onto each row at write time. This avoids a registry join on every query that filters by class.
- Tier 2 metadata in `properties` is governed by the type registry's `properties_schema` field. Hot predicates in `properties` that appear in frequent queries should be promoted to Tier 1 typed columns via the expand-contract migration pattern.
- See Decision 2 in `foxie-canonical-data-model-decisions.md` for the full three-tier metadata model, referential integrity compensating controls, and GraphQL surface pattern.

**Indexes:**
- Forward traversal: `(organisation_id, from_object_type, from_object_id)` — required
- Reverse traversal: `(organisation_id, to_object_type, to_object_id)` — required; treated as equal priority to forward
- Type + status filter: `(organisation_id, association_type, status)`
- Active only: partial index `(organisation_id, from_object_type, from_object_id) WHERE deleted_at IS NULL AND status = 'active'`
- JSONB properties: expression B-tree indexes on specific hot keys as they are identified; full-column GIN only if flexible containment queries are confirmed necessary

---

### 1.4 — `association_type_registry`

Defines all valid association types in the system. The registry is the schema definition layer for the polymorphic association model. See `foxie-canonical-data-model-decisions.md` Decision 4 for full rationale.

```
association_type_registry
  slug                  TEXT          primary key — immutable machine identifier; generated from label at creation; never changed
  label                 TEXT          required — mutable display name shown in UI
  inverse_label         TEXT          nullable — display name for the reverse direction
  association_class     TEXT          required — 'entity_relationship' | 'activity_link'
  from_object_type      TEXT          nullable — if null, valid for any from-type
  to_object_type        TEXT          nullable — if null, valid for any to-type
  tier                  TEXT          required — 'system' | 'custom'
  organisation_id       UUID          nullable — null for system types; set for organisation-defined custom types
  properties_schema     JSONB         nullable — JSON Schema definition of expected Tier 2 properties for this type
  display_field_mapping JSONB         nullable — defines what display data is available for dynamic survey elements
                                                  that evaluate associations of this type (see design notes)
  is_directional        BOOLEAN       required — whether from/to order has semantic meaning
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Initial system type seeds (to be expanded):**

| slug | label | class | from_type | to_type | directional |
|---|---|---|---|---|---|
| `is_customer_of` | Customer relationship | entity_relationship | contact | organisation_entity | true |
| `is_internal_at` | Internal relationship | entity_relationship | contact | organisation_entity | true |
| `is_evaluator_for` | Evaluates | entity_relationship | contact | organisation_entity | true |
| `is_account_owner_of` | Account owner | entity_relationship | contact | organisation_entity | true |
| `collection_run_for` | Collection run for | activity_link | collection_run | organisation_entity | true |
| `feedback_request_for` | Feedback request for | activity_link | feedback_request | contact | true |

**Design notes:**
- `slug` is the stable machine identifier referenced in code constants and API queries. It is immutable after creation.
- `label` is the mutable display string. Changing it requires no code change.
- Custom types have `organisation_id` set. Their slugs are namespaced to prevent collisions: `org_{org_slug}_{normalised_label}`.
- System types are seeded by migrations. The code constants file (`AssociationType`) must be updated in the same commit as the migration. Startup validation confirms that all constants exist in the registry.

**`display_field_mapping` — dynamic survey element display data**

This JSONB field declares what display data is available when associations of this type are used as evaluation targets in dynamic survey elements (repeating groups and singular dynamic elements). It is the "plugin" definition that makes the evaluation target system extensible to any association type without code changes.

Structure:
```json
{
  "from_display_fields": [
    {
      "key": "string",          // template tag key: {{target.key}}
      "label": "string",        // human-readable label for the field
      "source_path": "string",  // dot-notation path: 'contact.first_name', 'organisation_entity.name',
                                //   'association.properties.role'
      "format": "string"        // 'text' | 'full_name' | 'date' | 'currency'
    }
  ],
  "to_display_fields": [
    { "key": "...", "label": "...", "source_path": "...", "format": "..." }
  ]
}
```

`from_display_fields` declares display data available from the entity on the `from` side of the association. `to_display_fields` declares display data from the `to` side.

Example for `is_internal_at` (contact → organisation_entity):
```json
{
  "from_display_fields": [
    { "key": "name", "label": "Full Name", "source_path": "contact.first_name,contact.last_name", "format": "full_name" },
    { "key": "role", "label": "Role", "source_path": "association.properties.role", "format": "text" }
  ],
  "to_display_fields": [
    { "key": "entityName", "label": "Company Name", "source_path": "organisation_entity.name", "format": "text" }
  ]
}
```

The resolved display values are stored in `evaluation_target_assignment.display_data` at launch time (see Section 1.24) — not fetched live at render time. Template tags in survey questions (`{{target.name}}`, `{{target.role}}`) map directly to the `key` values defined here.

`display_field_mapping` is nullable — association types not used as evaluation targets do not need this field.

---

### 1.5 — `channel_type_registry`

Governs valid contact channel types. Follows the same slug-based registry pattern as the association type registry.

```
channel_type_registry
  slug                  TEXT          primary key — e.g. 'email', 'slack', 'sms', 'whatsapp'
  label                 TEXT          required — mutable display name
  value_format          TEXT          nullable — description of expected format (e.g. 'RFC 5321 email address', 'E.164 phone number')
  tier                  TEXT          required — 'system' | 'custom'
  is_active             BOOLEAN       required — whether this channel type is enabled platform-wide
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Initial system type seeds:**

| slug | label | value_format |
|---|---|---|
| `email` | Email | RFC 5321 email address |
| `sms` | SMS | E.164 phone number |
| `slack` | Slack | Slack user ID (Uxxxxxxxxx) |
| `whatsapp` | WhatsApp | E.164 phone number |

---

### 1.6 — `external_id_mapping`

Maps Foxie entity IDs to identifiers in external systems (HubSpot, Salesforce, Pipedrive, custom ERPs). Supports N:M mappings — one Foxie entity can have identifiers in multiple external systems. Applies to any Foxie entity type, not just contacts.

```
external_id_mapping
  id                    UUID          primary key — system generated
  organisation_id       UUID          required — tenant isolation
  foxie_object_type     TEXT          required — 'contact', 'organisation_entity', etc.
  foxie_object_id       UUID          required — ID of the Foxie entity (loose FK — application enforced)
  system_slug           TEXT          required — slug from external_system_registry: 'hubspot', 'salesforce', etc.
  external_id           TEXT          required — the entity's ID as it exists in the external system
  external_metadata     JSONB         nullable — additional context (e.g. portal URL, external display name, last known state)
  synced_at             TIMESTAMPTZ   nullable — last time this mapping was confirmed current by a sync operation
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Design notes:**
- Lookup by external ID (incoming sync): `WHERE organisation_id = :org AND system_slug = :system AND foxie_object_type = :type AND external_id = :ext_id`
- Lookup by Foxie entity (outgoing sync): `WHERE organisation_id = :org AND foxie_object_type = :type AND foxie_object_id = :id`
- One Foxie entity can have at most one mapping per external system per object type — enforced by unique index.
- The inverse constraint (one external ID maps to at most one Foxie entity per system) is also enforced by index but may be relaxed after a contact merge operation.
- `external_metadata` carries system-specific supplementary data — the external record's display URL, last known name, sync state — and is not used for querying. Hot fields that become query targets should be promoted to typed columns.

**Indexes:**
- Foxie entity lookup: `(organisation_id, foxie_object_type, foxie_object_id)` — outgoing sync
- External ID lookup: `(organisation_id, system_slug, foxie_object_type, external_id)` — incoming sync
- Unique constraint: `UNIQUE (organisation_id, foxie_object_type, foxie_object_id, system_slug)` — one mapping per entity per system
- Inverse unique: `UNIQUE (organisation_id, system_slug, foxie_object_type, external_id)` — one Foxie entity per external ID per system (deferrable for post-merge cleanup)

---

### 1.7 — `external_system_registry`

Governs which external systems Foxie supports for identity mapping. Hybrid model: Foxie seeds known systems platform-wide; organisations activate the systems they use.

```
external_system_registry
  slug                  TEXT          primary key — e.g. 'hubspot', 'salesforce', 'pipedrive'
  label                 TEXT          required — mutable display name
  tier                  TEXT          required — 'platform' (seeded by Foxie) | 'custom' (organisation-defined)
  supported_object_types TEXT[]       required — which Foxie object types this system can map to
  organisation_id       UUID          nullable — null for platform-tier systems; set for custom systems
  is_active             BOOLEAN       required — platform-level activation flag
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Initial platform-tier seeds:**

| slug | label | supported_object_types |
|---|---|---|
| `hubspot` | HubSpot | `['contact', 'organisation_entity']` |
| `salesforce` | Salesforce | `['contact', 'organisation_entity']` |
| `pipedrive` | Pipedrive | `['contact', 'organisation_entity']` |

**Design notes:**
- Organisations activate platform-tier systems by creating a configuration record (not yet specified — part of integration scoping).
- Custom systems allow an organisation to register a proprietary ERP or internal system that Foxie does not know about centrally.
- `supported_object_types` is an array of Foxie object type strings that the external system can provide IDs for. This governs what `foxie_object_type` values are valid for this system in `external_id_mapping`.

---

### 1.8 — `audit_event`

Append-only audit trail for all entity mutations. Entity tables carry only `date_soft_deleted` directly; all other audit information is here.

```
audit_event
  id                    UUID          primary key — system generated
  organisation_id       UUID          required — tenant isolation
  object_type           TEXT          required — 'contact', 'organisation_entity', 'association', etc.
  object_id             UUID          required — ID of the entity that was changed
  action                TEXT          required — 'created' | 'updated' | 'soft_deleted' | 'restored' | 'hard_deleted'
  changed_by_type       TEXT          required — 'user' | 'system' | 'service_account'
  changed_by_id         UUID          nullable — user or service account ID; null for system-initiated changes
  changed_at            TIMESTAMPTZ   required — when the change occurred
  diff                  JSONB         nullable — field-level diff: { field: { from: value, to: value } }
  context               JSONB         nullable — additional context: automation run ID, import batch ID, etc.
```

**Design notes:**
- Append-only. No updates or deletes on audit_event rows.
- `diff` captures only changed fields, not the full record state. Full record state at any point in time can be reconstructed by replaying the diff chain from creation.
- `context` carries correlation IDs — if a change was made as part of an automation run, the `automationRunId` is here. This links audit events to the processes that caused them.
- This table will grow large. Partitioning by `changed_at` (monthly or quarterly) should be planned before the table reaches operational scale.

**Indexes:**
- Entity history: `(organisation_id, object_type, object_id, changed_at DESC)` — primary access pattern
- Actor history: `(organisation_id, changed_by_id, changed_at DESC)` — "what did this user change"
- No index on `diff` or `context` — these are read fields, not filter fields

### 1.9 — `organisation_entity`

The canonical entity record for any company, project, subsidiary, team, or other organisational unit in Foxie's domain. A single self-referential table represents arbitrary hierarchies via `parent_id`. All relational context lives in the `association` table. Tags and segments live in `tag_assignment`. Financial detail lives in a separate time-series table (see Section 1.12). Lifecycle stage history lives in `lifecycle_stage_record` (see Section 1.13). External system mappings live in `external_id_mapping`.

```
organisation_entity
  id                          UUID          primary key
  organisation_id             UUID          required — tenant isolation
  name                        TEXT          required
  type                        TEXT          required — slug from organisation_entity_type_registry
                                                        e.g. 'company' | 'subsidiary' | 'project' | 'team'
  parent_id                   UUID          nullable — FK to organisation_entity.id (self-referential hierarchy)
                                                        null for top-level entities; cycle prevention enforced
                                                        at application layer (see design notes)

  -- Snapshot fields (fast-path read; see design notes for source of truth)
  owner_contact_id            UUID          nullable — SNAPSHOT: contact.id of current account owner
                                                        source of truth is association type 'is_account_owner_of'
                                                        refreshed by service layer when ownership association changes
  current_lifecycle_stage     TEXT          nullable — SNAPSHOT: slug of current lifecycle stage
                                                        source of truth is lifecycle_stage_record table
                                                        refreshed when a new lifecycle_stage_record is created

  review_status               TEXT          required — 'active' | 'under_review' | 'excluded'
                                                        default: 'active'
                                                        cascades to contact associations (see design notes)
  last_reviewed_by_id         UUID          nullable — contact.id of last reviewer (fast-path read field)
  last_reviewed_at            TIMESTAMPTZ   nullable — when the last review action occurred (fast-path read field)

  -- Financial snapshot fields (fast-path read; source of truth is financial_record table)
  snapshot_revenue_amount     BIGINT        nullable — most recent revenue in minor currency units (e.g. euro cents)
  snapshot_revenue_currency   TEXT          nullable — ISO 4217 currency code ('EUR', 'USD')
  snapshot_revenue_period     TEXT          nullable — period this revenue figure covers (e.g. '2025', '2025-Q4')
  snapshot_profitability      BIGINT        nullable — most recent profitability figure in minor currency units
  financial_snapshot_at       TIMESTAMPTZ   nullable — when the financial snapshot fields were last refreshed

  -- Stub field — to be deprecated when financial data layer is fully scoped
  annual_revenue_estimate     BIGINT        nullable — DEPRECATED STUB: replaced by snapshot_revenue_amount
                                                        retained for migration compatibility only

  date_soft_deleted           TIMESTAMPTZ   nullable — soft delete marker; null means active
  created_at                  TIMESTAMPTZ   auto
  updated_at                  TIMESTAMPTZ   auto
```

**Design notes:**

**Owner as a snapshot field, not a source-of-truth FK.**
`owner_contact_id` is a denormalised snapshot of the most recent active association of type `is_account_owner_of`. The canonical source of truth for account ownership — including the full history of who owned the account and when — is the `association` table. When ownership changes, the old `is_account_owner_of` association is archived (setting `archival_timestamp`) and a new one is created. The service layer then refreshes `owner_contact_id` on the entity as a side effect. This preserves the complete ownership history for long-term attribution analysis, while keeping entity-level queries fast. Querying "all entities owned by contact X" uses the snapshot field; querying "who owned this entity in 2023" uses the association table with date range filters.

**Lifecycle stage as a snapshot field.**
`current_lifecycle_stage` is a denormalised snapshot of the entity's most recent `lifecycle_stage_record` (see Section 1.13). The full stage history lives in `lifecycle_stage_record`. The snapshot field is refreshed by the service layer when a new stage record is written. Querying "all companies currently in onboarding" uses the snapshot; querying "which companies were in onboarding during Q1 2024" uses the time-series table.

**Review status cascade.**
`review_status = 'excluded'` on an `organisation_entity` implicitly excludes all contacts associated with it from automation targeting and cohort assembly. This cascade is enforced at the application layer — the cohort assembly service filters out entities with `review_status = 'excluded'` and excludes all their associations transitively. The entity-level review state is a second layer above the per-association `review_status` in the polymorphic association table.

**Circular hierarchy prevention.**
Before setting `parent_id`, the service layer walks upward from the proposed parent using a recursive CTE until it either reaches a null parent (safe) or encounters the entity being updated (circular — reject with a validation error). A periodic audit query checks for cycles as a safety net. No database-level constraint — the application check is sufficient at the write frequencies expected.

**Type governance.**
`type` is governed by `organisation_entity_type_registry` (see Section 1.10). TEXT field with application-layer enforcement via the registry, consistent with Foxie's pattern elsewhere. Adding a new type is a data migration, not a schema migration.

**Financial snapshot fields.**
The four snapshot fields (`snapshot_revenue_amount`, `snapshot_revenue_currency`, `snapshot_revenue_period`, `snapshot_profitability`) are denormalised fast-path read fields — the same pattern as `last_reviewed_by_id`. They are refreshed by a background job or event-driven update whenever new financial records are written. The canonical financial data lives in the `financial_record` table (Section 1.12).

**Indexes:**
- Primary: `id`
- Tenant scoping: `(organisation_id)`
- Active entity lookups: partial index on `(organisation_id, type) WHERE date_soft_deleted IS NULL`
- Hierarchy traversal: `(parent_id)` — for finding all children of a parent
- Owner snapshot lookups: `(organisation_id, owner_contact_id)` — fast path for "all entities owned by contact X"
- Lifecycle stage filter: `(organisation_id, current_lifecycle_stage) WHERE date_soft_deleted IS NULL`
- Review status filter: `(organisation_id, review_status) WHERE date_soft_deleted IS NULL`
- Financial snapshot queries: `(organisation_id, snapshot_revenue_amount) WHERE date_soft_deleted IS NULL` — added when financial querying is confirmed as a hot path
- Full-text search: `search_vector` tsvector on `name` with GIN index — added when search service is implemented

---

### 1.10 — `organisation_entity_type_registry`

Governs valid entity type values. Seeded with system types; extensible with custom types per organisation if needed in future.

```
organisation_entity_type_registry
  slug                  TEXT          primary key — e.g. 'company', 'project', 'team'
  label                 TEXT          required — mutable display name
  tier                  TEXT          required — 'system' | 'custom'
  organisation_id       UUID          nullable — null for system types
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Initial system type seeds:**

| slug | label |
|---|---|
| `company` | Company |
| `subsidiary` | Subsidiary |
| `project` | Project |
| `team` | Team |

---

### 1.11 — `tag` and `tag_assignment`

A general-purpose tagging system for any Foxie entity. Tags have a `category` field that determines their semantic role — `category = 'segment'` produces segments, `category = 'tier'` produces tier labels, `category = 'lifecycle'` is reserved for lifecycle stages (handled separately in Section 1.13). The `tag_assignment` table tracks the full history of tag assignments — when a tag was assigned and when it was removed — so segment and tier membership can be queried at any point in time.

```
tag
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  slug                  TEXT          required — generated from label at creation; immutable
  label                 TEXT          required — mutable display name
  category              TEXT          required — 'segment' | 'tier' | 'industry' | 'custom' | etc.
                                                  governed by application layer; not a separate registry at this stage
  colour                TEXT          nullable — hex colour code for UI display (e.g. '#E87040')
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto

  UNIQUE (organisation_id, slug)
```

```
tag_assignment
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  tag_id                UUID          required — FK to tag.id; CASCADE on delete
  object_type           TEXT          required — 'organisation_entity' | 'contact' | etc.
  object_id             UUID          required — ID of the tagged entity (loose FK — application enforced)
  assigned_at           TIMESTAMPTZ   required — when this tag was assigned to this entity
  assigned_by_id        UUID          nullable — contact.id of the user who applied the tag
  unassigned_at         TIMESTAMPTZ   nullable — when this tag was removed; null means currently active
  unassigned_by_id      UUID          nullable — contact.id of the user who removed the tag
```

**Design notes:**
- Tags are organisation-scoped. Two organisations can have tags with the same label; they are independent records.
- The `category` field is application-governed at this stage — valid categories are defined in code constants rather than a registry table. If category management becomes a user-facing feature, a `tag_category_registry` can be introduced later without schema changes.
- `tag_assignment` uses temporal tracking — rows are never deleted when a tag is removed. When a tag is removed from an entity, `unassigned_at` and `unassigned_by_id` are set. Active assignments have `unassigned_at IS NULL`. This enables full segment and tier history queries: "which segments was this company in during Q3 2024?" is answered by filtering `assigned_at <= period_end AND (unassigned_at IS NULL OR unassigned_at >= period_start)`.
- The unique constraint on active assignments (preventing a tag being applied twice simultaneously) is a partial unique index: `UNIQUE (tag_id, object_type, object_id) WHERE unassigned_at IS NULL`.
- `lifecycle` category is reserved. Lifecycle stage management uses `lifecycle_stage_record` (Section 1.13) rather than tag_assignment, because lifecycle stages are ordered, mutually exclusive, and transition-significant in ways that general tags are not.

**Indexes for `tag`:**
- `(organisation_id, category)` — find all tags of a given category
- `(organisation_id, slug)` — unique constraint + lookup by slug

**Indexes for `tag_assignment`:**
- `(organisation_id, object_type, object_id) WHERE unassigned_at IS NULL` — active tags for a given entity (primary access pattern)
- `(organisation_id, object_type, object_id, assigned_at)` — full history for a given entity
- `(organisation_id, tag_id) WHERE unassigned_at IS NULL` — all entities currently carrying a given tag
- `(organisation_id, tag_id, assigned_at, unassigned_at)` — historical membership queries per tag
- Partial unique: `UNIQUE (tag_id, object_type, object_id) WHERE unassigned_at IS NULL` — prevent duplicate active assignments

---

### 1.12 — `financial_record` (placeholder)

Time-series financial data linked to `organisation_entity`. The snapshot fields on `organisation_entity` (Section 1.9) are derived from this table. Full scoping of the financial data layer is deferred — this section establishes the structural intent and the connection point to `organisation_entity`.

```
financial_record
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  entity_id             UUID          required — FK to organisation_entity.id
  record_type           TEXT          required — 'revenue' | 'profitability' | 'resource_usage' | etc.
  period_type           TEXT          required — 'month' | 'quarter' | 'year' | 'custom'
  period_label          TEXT          required — human-readable period (e.g. '2025-Q4', '2025-11')
  period_start          DATE          required — start of the period this record covers
  period_end            DATE          required — end of the period this record covers
  amount                BIGINT        nullable — value in minor currency units for monetary types
  currency              TEXT          nullable — ISO 4217 code for monetary types
  unit_value            NUMERIC       nullable — value for non-monetary types (e.g. resource hours)
  unit_label            TEXT          nullable — label for non-monetary unit (e.g. 'hours', 'FTE')
  source_system_slug    TEXT          nullable — which external system this record came from
  source_record_id      TEXT          nullable — the record ID in the source system
  imported_at           TIMESTAMPTZ   auto — when this record was imported
  created_at            TIMESTAMPTZ   auto
```

**Design notes:**
- This is a placeholder schema. The full financial data layer — aggregation strategy, multiple aggregation levels, source system sync, and reporting queries — is a separate design task.
- The `record_type` field allows different financial metric types to coexist in one table. If types diverge significantly in their field requirements, separate tables may be warranted when the layer is fully scoped.
- `source_system_slug` connects to `external_system_registry`. Financial records are typically pulled from a billing ERP or accounting system.
- The snapshot fields on `organisation_entity` are refreshed from this table when new records are imported or when a background job detects that the most recent period for an entity has changed.

**Indexes:**
- `(organisation_id, entity_id, record_type, period_start DESC)` — primary access: financial history for an entity by type
- `(organisation_id, record_type, period_start DESC)` — cross-entity queries: all revenue records for a period

---

### 1.13 — `lifecycle_stage_record` and `lifecycle_stage_registry`

Tracks the full history of lifecycle stage transitions for each `organisation_entity`. Lifecycle stages are ordered, mutually exclusive events in the relationship between an agency and an end-customer entity — onboarding, continuous relationship, at risk, exiting, churned. The transition between stages is itself a meaningful event and is recorded as a first-class record, not a tag change.

The `current_lifecycle_stage` snapshot field on `organisation_entity` (Section 1.9) is derived from this table and refreshed when a new record is written. Historical stage analysis uses this table directly.

```
lifecycle_stage_record
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  entity_id             UUID          required — FK to organisation_entity.id
  stage_slug            TEXT          required — slug from lifecycle_stage_registry
                                                  e.g. 'onboarding' | 'continuous' | 'at_risk' | 'exiting' | 'churned'
  entered_at            TIMESTAMPTZ   required — when the entity entered this stage
  exited_at             TIMESTAMPTZ   nullable — when the entity left this stage; null means currently in this stage
  entered_by_id         UUID          nullable — contact.id of who recorded the transition
  notes                 TEXT          nullable — context on why the transition happened
  created_at            TIMESTAMPTZ   auto
```

```
lifecycle_stage_registry
  slug                  TEXT          primary key — immutable machine identifier
  label                 TEXT          required — mutable display name
  description           TEXT          nullable — what this stage means in plain language
  sort_order            INTEGER       required — display order in UI; also indicates progression order
  tier                  TEXT          required — 'system' | 'custom'
  organisation_id       UUID          nullable — null for system stages; set for organisation-defined custom stages
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Initial system stage seeds:**

| slug | label | sort_order | description |
|---|---|---|---|
| `onboarding` | Onboarding | 10 | New customer, typically first 1-3 months |
| `continuous` | Continuous relationship | 20 | Established, ongoing customer relationship |
| `at_risk` | At risk | 30 | Relationship showing warning signals |
| `exiting` | Exiting | 40 | Customer has indicated intent to leave |
| `churned` | Churned | 50 | Customer has ended the relationship |

**Design notes:**

**Mutual exclusivity.** An entity can only be in one stage at a time. When a new `lifecycle_stage_record` is created for an entity, the service layer sets `exited_at` on the most recent prior record before inserting the new one. A database-level partial unique index enforces that only one record per entity has `exited_at IS NULL`: `UNIQUE (entity_id) WHERE exited_at IS NULL`.

**Stages are ordered but not strictly sequential.** An entity can transition from `continuous` to `at_risk` and back to `continuous`. Skipping stages (e.g. `onboarding` directly to `churned`) is permitted. The `sort_order` field governs display ordering, not enforced transition rules.

**Custom stages.** Organisations may define custom stages for their own relationship vocabulary — some agencies have bespoke terminology or additional stages (e.g. `re-engaged`, `growth`). Custom stages follow the same hybrid registry pattern as association types: system stages are seeded by migration, custom stages are created at runtime per organisation. The `sort_order` for custom stages is set by the organisation.

**Historical queries.** "Which companies were in onboarding during Q1 2024?" is answered by: `WHERE stage_slug = 'onboarding' AND entered_at <= '2024-03-31' AND (exited_at IS NULL OR exited_at >= '2024-01-01')`. The time-series structure makes this query natural without any reconstruction.

**Snapshot refresh.** When a new `lifecycle_stage_record` is created, the service layer refreshes `current_lifecycle_stage` on `organisation_entity` in the same transaction. The snapshot is always consistent with the most recent record.

**Audit.** Stage transitions are high-significance events. In addition to `audit_event` records (which capture the `lifecycle_stage_record` create and the `organisation_entity` update), the `entered_by_id` and `notes` fields on the record itself provide immediate context without requiring an audit log join.

**Indexes for `lifecycle_stage_record`:**
- `(organisation_id, entity_id, entered_at DESC)` — full stage history for an entity
- `(organisation_id, stage_slug) WHERE exited_at IS NULL` — all entities currently in a given stage
- `(organisation_id, entity_id, stage_slug, entered_at)` — historical stage membership queries
- Partial unique: `UNIQUE (entity_id) WHERE exited_at IS NULL` — enforces one active stage per entity

**Indexes for `lifecycle_stage_registry`:**
- `(organisation_id, sort_order)` — ordered stage list per organisation (null org_id = system stages)

---

### 1.14 — Audience Type Registry

Defines the valid audience types for collection runs — who is being asked. Audience type is a cross-cutting concept: it determines which contacts qualify for a phase, how reporting is segmented, what the default execution behaviour is, and what prior-phase context is surfaced in the portal.

Audience type is distinct from automation phase. A phase is a structural execution concept (how the automation runs). An audience is a domain concept (who is being targeted). They are configured together but owned separately.

```
audience_type_registry
  slug                              TEXT          primary key — e.g. 'customer', 'internal', 'supplier'
  label                             TEXT          required — mutable display name
  qualifying_association_type_slugs TEXT[]        required — which association type slugs qualify contacts
                                                              for this audience; references association_type_registry
  default_link_behaviour            TEXT          required — 'direct_survey' | 'portal' | 'auto_resolve'
                                                              'auto_resolve': at URL access time, if one active
                                                              FeedbackRequest → direct survey; if multiple → portal
  portal_context_source_slug        TEXT          nullable — for portal-mode audiences, which audience's prior
                                                              answers to surface as context; null = no prior context
  tier                              TEXT          required — 'system' | 'custom'
  organisation_id                   UUID          nullable — null for system types; set for custom types
  created_at                        TIMESTAMPTZ   auto
  updated_at                        TIMESTAMPTZ   auto
```

**Initial system type seeds:**

| slug | label | qualifying_assoc_types | default_link_behaviour |
|---|---|---|---|
| `customer` | Customer | `['is_customer_of', 'is_evaluator_for']` | `direct_survey` |
| `internal` | Internal | `['is_internal_at']` | `portal` |

**Design notes:**
- `qualifying_association_type_slugs` is the direct link from audience type into the polymorphic association table. When assembling a cohort for a customer-audience CollectionRun, the query filters associations where `association_type IN (qualifying_association_type_slugs)`.
- `portal_context_source_slug` configures what prior-phase answers are surfaced in the portal for this audience. For the internal audience, this would typically be set to `'customer'` — showing customer feedback alongside the internal response form.
- Portal searches for active FeedbackRequests across **all** AutomationCycles for a given contact, not just the current cycle. This is a deliberate design decision: one portal view aggregates all active and historical requests across every running automation.
- Custom audience types (e.g. `supplier`, `board`) extend the system types. Adding a custom audience type requires defining its qualifying association types — which implies first registering the corresponding association type slugs in `association_type_registry`.

---

### 1.15 — `batch_launch`

The persistent record of a UI launch event — when a user initiates one or more AutomationCycles in a single operation. Carries batch-level settings that apply across all cycles created in this launch.

```
batch_launch
  id                          UUID          primary key
  organisation_id             UUID          required — tenant isolation
  launched_by_id              UUID          required — contact.id of the user who triggered the launch
  launched_at                 TIMESTAMPTZ   required — when the launch was executed
  automation_template_id      UUID          nullable — reference to the AutomationTemplate used
                                                        (AutomationTemplate schema deferred — see note below)
  notification_settings       JSONB         nullable — batch-level notification configuration
                                                        (who gets notified of completion, digest settings, etc.)
  archive_settings            JSONB         nullable — batch-level soft-delete and archive behaviour
                                                        (e.g. auto-archive after N days of inactivity)
  status                      TEXT          required — 'draft' | 'active' | 'completed' | 'cancelled'
                                                        'draft': configuration created, not yet confirmed
                                                        'active': confirmed and launched, Temporal running
                                                        'completed': all cycles in terminal state
                                                        'cancelled': discarded before or after launch

  -- Draft-phase fields (populated during configuration, preserved read-only after confirmation)
  target_entity_ids           UUID[]        nullable — organisation_entity IDs selected for this batch
                                                        set during draft; read-only after confirmation
  draft_exclusions            JSONB         nullable — per-entity manual exclusion decisions made during preview
                                                        format: { "entity_id": ["assoc_id", ...] }
                                                        set during draft; read-only after confirmation

  -- Snapshot fields (set at confirmation time, never updated)
  snapshot_company_count      INTEGER       nullable — how many companies/projects were included at launch
  snapshot_contact_count      INTEGER       nullable — how many contacts were included across all cohorts
  snapshot_feedback_request_count INTEGER   nullable — how many FeedbackRequests were created
  date_soft_deleted           TIMESTAMPTZ   nullable — soft delete marker
  created_at                  TIMESTAMPTZ   auto
  updated_at                  TIMESTAMPTZ   auto
```

**Design notes:**
- BatchLaunch persists after the launch event. It is the anchor for "show me everything launched in this batch" reporting and for batch-level operational changes (archive all, change notification settings for all).
- `status` transitions: `draft` → `active` on `confirmBatchLaunch`; `draft` → `cancelled` on `discardDraftBatchLaunch`; `active` → `completed` when all AutomationCycles reach a terminal state.
- `target_entity_ids` and `draft_exclusions` are draft-phase fields. After confirmation they become historical read-only data — preserved for audit ("what did the user see and decide at launch time") but no longer operationally active.
- The preview cohort is always computed live from current CRM state — it is never persisted. Only the exclusion decisions persist. This means adding a contact in the CRM and refreshing the preview shows the new contact immediately, while prior exclusion decisions are preserved.
- Snapshot count fields are set at confirmation time and not updated afterward.
- `notification_settings` and `archive_settings` are JSONB because their structure may vary and they are not query predicates.
- `automation_template_id` is a loose reference to the AutomationTemplate that was used. The AutomationTemplate schema is deferred — see the deferred note at end of this section.

---

### 1.16 — `sender_assignment`

Defines who sends and via which channel for a specific audience phase within a BatchLaunch. Referenced by CollectionRuns — shared across all CollectionRuns in the same BatchLaunch that target the same sender and audience. Mutable: updating a SenderAssignment propagates to all referencing CollectionRuns simultaneously.

```
sender_assignment
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  batch_launch_id       UUID          required — FK to batch_launch.id — scoped per batch
  sender_contact_id     UUID          required — FK to contact.id — who is sending
  channel_type          TEXT          required — slug from channel_type_registry: 'email' | 'sms' etc.
  audience_type_slug    TEXT          required — which audience this assignment applies to
  phase_order           INTEGER       nullable — if multiple assignments exist for the same audience,
                                                  phase_order determines which applies when
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Design notes:**
- SenderAssignment is scoped per BatchLaunch. Two different BatchLaunches always have independent SenderAssignments. Changes to a SenderAssignment affect only CollectionRuns within the same BatchLaunch.
- To change the sender for **all** CollectionRuns in a batch referencing this assignment: update `sender_contact_id` or `channel_type` on this record. All referencing CollectionRuns pick up the change.
- To change the sender for **some** CollectionRuns: create a new SenderAssignment and update `sender_assignment_id` on only the target CollectionRuns. The rest continue referencing the original.
- The convergence problem — where multiple AutomationCycles from different BatchLaunches route to the same centralised sender (e.g. a shared internal portal) — is noted as **unresolved**. The current model does not attempt to solve this automatically. Resolution policy for convergence cases is deferred to a separate design task.

---

### 1.17 — `automation_phase_snapshot`

A point-in-time snapshot of one phase's configuration from the AutomationTemplate, created at launch time. Referenced by CollectionRuns within the same BatchLaunch. This is the operational configuration record that running automations execute against — changes to the AutomationTemplate in the editor do not affect running automations.

Mutable for operational changes: if the user needs to update settings for a running automation (e.g. change the survey, adjust the schedule), they update the snapshot directly rather than the source template.

```
automation_phase_snapshot
  id                        UUID          primary key
  organisation_id           UUID          required — tenant isolation
  batch_launch_id           UUID          required — FK to batch_launch.id
  audience_type_slug        TEXT          required — which audience this phase targets
  survey_id                 TEXT          nullable — fixed Formbricks survey ID (cuid format)
                                                      null if survey_selection_rule is used instead
  survey_selection_rule     JSONB         nullable — rule-based survey selection (experimental, low priority)
                                                      evaluated at FeedbackRequest creation time
                                                      mutually exclusive with survey_id
  link_behaviour            TEXT          required — 'direct_survey' | 'portal' | 'auto_resolve'
                                                      inherits from audience_type_registry default at launch;
                                                      overridable here
  reminder_schedule         JSONB         nullable — reminder timing configuration
                                                      (e.g. [{day: 3, type: 'reminder'}, {day: 7, type: 'final'}])
  completion_threshold      NUMERIC       nullable — percentage of contacts that must complete before
                                                      the phase is considered done (0.0–1.0)
  approval_gate             BOOLEAN       required — whether a manual approval is required before the
                                                      next phase begins; default false
  settings                  JSONB         nullable — additional phase-level configuration not captured
                                                      in typed columns; read by execution layer at workflow start
  created_at                TIMESTAMPTZ   auto
  updated_at                TIMESTAMPTZ   auto
```

**Design notes:**
- `survey_id` and `survey_selection_rule` are mutually exclusive. Exactly one must be non-null. The 95% case is a fixed `survey_id`. The rule-based option is present but marked experimental and low priority.
- `link_behaviour` is copied from the audience type registry default at launch time and stored here. The snapshot owns the value — the registry default is only used at launch to populate it.
- `reminder_schedule` is JSONB because its structure may vary and it is not a query predicate. The execution layer reads it once at workflow start to configure timers.
- `settings` is the JSONB catch-all for configuration that is not yet promoted to typed columns, following the Tier 2 pattern established in the polymorphic association model.
- The AutomationTemplate is not referenced here by a foreign key — the snapshot was materialised from it at launch but is now independent. The `batch_launch.automation_template_id` is the only record of which template was used.

---

### 1.18 — `automation_cycle`

Groups all phases (CollectionRuns) for one company/project in one automation run. The top-level record for "we are running a feedback cycle for Company A." All CollectionRuns for different audience phases of this cycle hang off this record.

```
automation_cycle
  id                        UUID          primary key
  organisation_id           UUID          required — tenant isolation
  batch_launch_id           UUID          nullable — FK to batch_launch.id; null for individually-launched cycles
  entity_id                 UUID          required — FK to organisation_entity.id — which company/project
  temporal_workflow_id      TEXT          required — Temporal group workflow execution ID
                                                      used as grouping key and for signalling
  status                    TEXT          required — 'active' | 'paused' | 'completed' | 'cancelled'
  initiated_by_id           UUID          nullable — contact.id of the user who launched this cycle
  completed_at              TIMESTAMPTZ   nullable — when the cycle reached a terminal state
  date_soft_deleted         TIMESTAMPTZ   nullable — soft delete marker
  created_at                TIMESTAMPTZ   auto
  updated_at                TIMESTAMPTZ   auto
```

**Design notes:**
- One AutomationCycle per company/project per BatchLaunch. Multiple AutomationCycles can exist for the same entity over time (different cycles in different BatchLaunches).
- `temporal_workflow_id` is the Temporal group workflow ID. It is the stable identifier used by Temporal to signal the cycle and by the system to locate the running workflow. It also serves as the grouping key when querying all CollectionRuns for a cycle.
- The portal queries AutomationCycles across all BatchLaunches for all entities a contact is associated with. This is the mechanism by which the portal aggregates across automations — there is no portal-specific entity; the portal is a derived view over AutomationCycle and FeedbackRequest records.

**Indexes:**
- `(organisation_id, entity_id, status)` — active cycles for a company/project
- `(organisation_id, batch_launch_id)` — all cycles in a batch
- `(temporal_workflow_id)` — lookup by Temporal workflow ID
- `(organisation_id, status) WHERE date_soft_deleted IS NULL` — active cycle queries

---

### 1.19 — `collection_run`

One phase of one AutomationCycle. A CollectionRun is scoped to a single audience type and a single AutomationPhaseSnapshot configuration. All FeedbackRequests and CohortMembership records for this phase hang off this record.

```
collection_run
  id                            UUID          primary key
  organisation_id               UUID          required — tenant isolation
  automation_cycle_id           UUID          required — FK to automation_cycle.id
  automation_phase_snapshot_id  UUID          required — FK to automation_phase_snapshot.id
  sender_assignment_id          UUID          required — FK to sender_assignment.id
  audience_type_slug            TEXT          required — which audience this run targets
  survey_id                     TEXT          required — RESOLVED survey ID frozen at CollectionRun creation
                                                          derived from automation_phase_snapshot at creation;
                                                          immutable after creation
  phase_order                   INTEGER       required — ordering of this run within the AutomationCycle
                                                          (e.g. 1 = customer phase, 2 = internal phase)
  status                        TEXT          required — 'pending' | 'active' | 'paused' |
                                                          'awaiting_approval' | 'completed' | 'cancelled'
  deadline                      TIMESTAMPTZ   required — when this phase must complete
  settings                      JSONB         nullable — per-run overrides to snapshot settings;
                                                          merged with snapshot settings at execution time
                                                          (run-level settings take precedence)

  -- Aggregate completion snapshot counters (refreshed as FeedbackRequest statuses change)
  total_contacts                INTEGER       required default 0
  completed_count               INTEGER       required default 0
  partial_count                 INTEGER       required default 0
  cancelled_count               INTEGER       required default 0
  active_count                  INTEGER       required default 0

  completed_at                  TIMESTAMPTZ   nullable — when the run reached a terminal state
  date_soft_deleted             TIMESTAMPTZ   nullable — soft delete marker
  created_at                    TIMESTAMPTZ   auto
  updated_at                    TIMESTAMPTZ   auto
```

**Design notes:**
- `survey_id` is resolved at CollectionRun creation from the AutomationPhaseSnapshot (either from its fixed `survey_id` or by evaluating `survey_selection_rule`). Once set, it is immutable. This ensures that all FeedbackRequests within this run use the same survey and that historical reporting is stable.
- `settings` JSONB carries per-run overrides. At execution time, the settings are merged: snapshot settings provide the base, run-level settings override specific fields. The merged result is what Temporal acts on.
- Aggregate counters are snapshot fields updated atomically when a FeedbackRequest changes state. They enable fast dashboard queries ("how many companies are at 80%+ completion?") without aggregating across FeedbackRequest rows.
- `phase_order` determines the sequence of phases in a cycle. When phase 1 completes (or reaches the approval gate), phase 2 becomes active.

**Indexes:**
- `(organisation_id, automation_cycle_id, phase_order)` — all phases for a cycle in order
- `(organisation_id, status) WHERE date_soft_deleted IS NULL` — active runs
- `(organisation_id, audience_type_slug, status)` — runs by audience type
- `(sender_assignment_id)` — all runs using a given sender assignment

---

### 1.20 — `cohort_membership`

Junction table linking a CollectionRun to the specific association records included in its cohort. One row per association — included or manually excluded. Created at automation launch time. Immutable after creation.

```
cohort_membership
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  collection_run_id     UUID          required — FK to collection_run.id; CASCADE on delete
  association_id        UUID          required — FK to association.id (polymorphic association table)
  included              BOOLEAN       required — true = included in cohort; false = manually excluded
  exclusion_reason      TEXT          nullable — user-provided reason for exclusion; null if included
  excluded_by_id        UUID          nullable — contact.id of who excluded this association; null if included
  created_at            TIMESTAMPTZ   auto
```

**Design notes:**
- Immutable after creation. The cohort is a snapshot of who was included at launch time.
- Excluded associations are recorded with `included = false` rather than being omitted. This preserves the full audit trail of who was considered and who was manually removed.
- `association_id` references the canonical polymorphic `association` table. The association's `from_object_id` is the contact; `to_object_id` is the organisation entity. No junction-per-pair complexity.

**Indexes:**
- `(collection_run_id, included)` — included contacts for a run (primary access pattern)
- `(organisation_id, association_id)` — all runs where a given contact was cohorted

---

### 1.21 — `feedback_request`

One contact's participation in one CollectionRun. The central operational record of the feedback collection process. Created by Temporal at launch for automated runs, or manually by a user. The session token for survey access is in a separate table.

```
feedback_request
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  collection_run_id     UUID          nullable — FK to collection_run.id
                                                  null for standalone manual requests
  contact_id            UUID          required — FK to contact.id — who is being asked
  association_id        UUID          required — FK to association.id — which relationship context
  survey_id             TEXT          required — resolved Formbricks survey ID (cuid format)
                                                  frozen at creation; never changes
  status                TEXT          required — 'active' | 'partial' | 'completed' | 'cancelled'
  source                TEXT          required — 'automation' | 'manual'
  completed_at          TIMESTAMPTZ   nullable — when the respondent completed or partially completed
  date_soft_deleted     TIMESTAMPTZ   nullable — soft delete marker
  created_at            TIMESTAMPTZ   auto
  updated_at            TIMESTAMPTZ   auto
```

**Status transitions:**

| From | To | Trigger |
|---|---|---|
| `active` | `partial` | Respondent answers at least one question but does not submit |
| `active` | `completed` | Respondent submits all required questions |
| `active` | `cancelled` | Deadline passed, or manual cancellation |
| `partial` | `completed` | Respondent returns and completes |
| `partial` | `cancelled` | Deadline passed, or manual cancellation |

**Design notes:**
- `collection_run_id` is nullable for standalone manual requests. The timeline display for a contact shows all FeedbackRequests regardless of whether they belong to a CollectionRun.
- `survey_id` is frozen at creation — copied from the resolved CollectionRun survey at that point in time. Historical reporting always reflects what survey was actually used.
- `source` is informational metadata for auditability and reporting segmentation. It does not affect behaviour.
- Component interfaces: Automation creates and updates status. Formbricks reads `contact_id`, `survey_id`, `association_id` for session resolution. Reporting aggregates across all fields.

**Indexes:**
- `(organisation_id, collection_run_id, status)` — all requests for a run by status
- `(organisation_id, contact_id, status)` — portal query: all active requests for a contact
- `(organisation_id, association_id)` — requests for a specific relationship
- `(organisation_id, contact_id, created_at DESC)` — contact timeline, all historical requests
- Partial: `(organisation_id, contact_id) WHERE status = 'active'` — active requests for portal

---

### 1.22 — `session_token`

A separate table for survey session tokens. Tokens are stored hashed, with expiry and revocation support. One active token per FeedbackRequest at a time; new tokens can be issued on re-send.

```
session_token
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  feedback_request_id   UUID          required — FK to feedback_request.id
  token_hash            TEXT          required — HMAC-SHA256 hash of the token; token itself never stored
  expires_at            TIMESTAMPTZ   required — when this token expires
  first_seen_at         TIMESTAMPTZ   nullable — when the URL was first opened (set on GET)
                                                  null until the link is opened for the first time
  first_redeemed_at     TIMESTAMPTZ   nullable — when the first explicit user action occurred
                                                  (set when browser session is issued, not on GET)
                                                  null until the respondent actively engages
  revoked_at            TIMESTAMPTZ   nullable — when this token was explicitly revoked; null = active
  revoked_by_id         UUID          nullable — contact.id of who revoked the token; null if not revoked
  revocation_reason     TEXT          nullable — reason for revocation (e.g. 'contact_excluded', 'resent')
  created_at            TIMESTAMPTZ   auto
```

**Design notes:**
- Token values are never stored. Only the hash is persisted. Resolution works by hashing the presented token and looking up the hash.
- **Email scanner prefetch protection:** Enterprise mail security systems automatically follow links before the recipient sees the message. To protect against this, Foxie must NOT issue a browser session on the first GET request. The correct flow: validate the token on GET and set `first_seen_at`; only issue a short-lived browser session (15-60 minutes, renewable) on the first explicit user action (answering a question, clicking start), then set `first_redeemed_at`. This means a scanner fetching the URL does not "consume" the token.
- `first_seen_at` and `first_redeemed_at` together provide telemetry for diagnosing scanner prefetch incidents and measuring respondent engagement latency.
- When a survey link is re-sent, the previous token is revoked (`revoked_at`, `revocation_reason = 'resent'`) and a new token record is created. The FeedbackRequest record is unchanged.
- When a contact is excluded from a CollectionRun after their link has been sent, their token is revoked with `revocation_reason = 'contact_excluded'`. Any active browser session minted from this token is also invalidated.
- Token expiry is set to the CollectionRun deadline plus a 48-hour grace period, with a hard maximum of 30 days from creation. If the deadline changes, a new token with updated expiry should be issued.
- Multiple token records per FeedbackRequest are permitted over time (one per send/resend cycle). Only one should be active (non-revoked, non-expired) at any time — enforced by application logic, not a database constraint.

**Indexes:**
- `(token_hash)` — primary resolution lookup: find the token record from the presented hash
- `(feedback_request_id, revoked_at, expires_at)` — find the active token for a request
- Partial: `(token_hash) WHERE revoked_at IS NULL` — active token lookup only

---

### 1.23 — `standardised_answer_row`

The Reporting-layer normalised answer record. One row per question per respondent per evaluation target. This is Layer 2 of the two-layer answer data model: Formbricks stores raw answers in `Response.data` (Layer 1, Survey-owned); the standardised answer row is the queryable, reporting-optimised representation (Layer 2, Reporting-owned).

Written by the Reporting write endpoint when it receives a per-question event from the Formbricks fork. Upserted — if the respondent updates an answer, the existing row is overwritten.

**Source:** Derived from M3 draft contracts Section 3c, with field names converted to snake_case and `company_id`/`project_id` replaced by `organisation_entity_id` per Decision D6 (single entity table hierarchy). All type consistency checks confirmed in M3 source investigation.

```
standardised_answer_row
  id                          UUID          primary key — system generated
  organisation_id             UUID          required — tenant isolation
  feedback_request_id         UUID          required — FK to feedback_request.id
  survey_id                   TEXT          required — Formbricks survey ID (cuid format)
                                                        from Response.surveyId
  question_id                 TEXT          required — Formbricks question ID (cuid format)
                                                        extracted from Response.data JSON key
  evaluator_association_id    UUID          required — association.id of the respondent giving feedback
  eval_target_association_id  UUID          nullable — association.id of the entity being evaluated
                                                        set for repeating group questions; null for
                                                        non-repeating questions
  organisation_entity_id      UUID          nullable — denormalised from association reference
                                                        quick filter for entity-scoped reporting queries;
                                                        resolved at write time from feedback_request →
                                                        association → to_object_id

  -- Answer value fields — exactly one is populated per row (mutually exclusive)
  text                        TEXT          nullable — OpenText, MultipleChoiceSingle, Consent,
                                                        CTA, Date, Cal
  value                       NUMERIC       nullable — NPS (0-10), Rating (configurable scale)
  choices                     TEXT[]        nullable — MultipleChoiceMulti, Ranking,
                                                        PictureSelection, FileUpload
  structured                  JSONB         nullable — Matrix, Address, ContactInfo
                                                        type: Record<string, string> — flat key-value map
                                                        verified via ZResponseDataValue at
                                                        packages/types/responses.ts:6-11

  created_at                  TIMESTAMPTZ   auto — set on first write
  updated_at                  TIMESTAMPTZ   auto — updated on each upsert
```

### Input field type mapping

| Field | Formbricks question types | Value format |
|---|---|---|
| `text` | OpenText, MultipleChoiceSingle, Consent, CTA, Date, Cal | string |
| `value` | NPS (0–10), Rating | number |
| `choices` | MultipleChoiceMulti, Ranking, PictureSelection, FileUpload | string[] |
| `structured` | Matrix, Address, ContactInfo | `Record<string, string>` — flat key-value map |

### Upsert key

`(feedback_request_id, question_id, eval_target_association_id)` — one row per question per evaluation target per feedback request. When a respondent modifies an answer, the row is overwritten.

### Trickle-down write path

```
[Respondent answers or modifies a question]
    → Formbricks fork persists to Response.data (Layer 1 — Survey-owned)
    → Fork emits per-question event (diff detected in updateResponse())
        → Reporting write endpoint receives event
            → Resolves organisation_entity_id from feedback_request → association
            → Upserts standardised_answer_row (Layer 2 — Reporting-owned)
```

**Per-question event payload emitted by the Formbricks fork:**

| Field | Type | Source |
|---|---|---|
| `feedback_request_id` | UUID | From extended JWT session context |
| `survey_id` | string (cuid) | From `Response.surveyId` |
| `question_id` | string (cuid) | Changed key in `Response.data` |
| `answer_value` | string \| number \| string[] \| Record<string,string> | New answer value |
| `answer_type` | enum: `text` \| `value` \| `choices` \| `structured` | Derived from question type |
| `evaluator_association_id` | UUID | From session context |
| `eval_target_association_id` | UUID or null | From repeating element context if applicable |

### Required Formbricks fork changes

**Updated based on POC findings (2026-03-19).** The callback path (omitting `appUrl`/`environmentId`) delivers per-question data directly via the `onResponse` callback — no diff detection in `updateResponse()` is needed for the portal integration path.

Two fork changes remain required:

| Change | File | Lines | What |
|---|---|---|---|
| Completion signal via gateway | `apps/web/app/api/(internal)/pipeline/route.ts` | 214-222 | Add Foxie gateway HTTP POST as an additional promise in the existing `Promise.allSettled` array on `responseFinished`. |
| EE feature unlock (contactId on responses) | `apps/web/modules/ee/...` | — | Unlock `Response.contactId` for use in the fork. Required for session identity on the Formbricks backend side. |

**Changes no longer needed for the portal path:**
- Diff detection in `updateResponse()` (`apps/web/lib/response/service.ts:438-453`) — the `onResponse` callback delivers per-question data `{data, finished, ttc}` directly to the portal shell, which forwards to the Reporting write endpoint with session context attached
- JWT extension for `feedbackRequestId` (`apps/web/modules/ee/contacts/lib/contact-survey-link.ts:46-49`) — the portal shell carries `feedbackRequestId` in its own session state; no JWT embedding needed

**Note on the trickle-down write path:** The path from survey answer to standardised answer row is unchanged in design but the mechanism is cleaner than originally specified. Instead of the fork detecting diffs and emitting events, the portal shell receives `{data, finished, ttc}` via `onResponse` callback on every question answer, attaches Foxie session context (`feedbackRequestId`, `evaluator_association_id`, `eval_target_association_id`), and posts directly to `/internal/v1/answer-rows/upsert`. The Layer 1 / Layer 2 two-layer model is preserved; only the emission mechanism changes.

**Design notes:**
- Layer 1 raw answers in Formbricks (`Response.data`) are the authoritative source. The standardised answer row is derived and queryable. On discrepancy, Layer 1 wins.
- `organisation_entity_id` is denormalised at write time — no join required on reporting queries scoped to an entity.
- `structured` uses JSONB (not TEXT) to allow key-existence queries on structured answer maps if needed.

**Indexes:**
- `(organisation_id, feedback_request_id)` — all answers for a request
- `(organisation_id, organisation_entity_id, survey_id)` — entity-scoped survey answers (hot reporting path)
- `(organisation_id, evaluator_association_id)` — all answers by a specific respondent
- Unique constraint: `(feedback_request_id, question_id, eval_target_association_id)` — upsert key
- `(organisation_id, survey_id, question_id)` — cross-entity question-level aggregation

---

### 1.24 — `evaluation_target_assignment`

A snapshot of which associations each evaluator is assigned to evaluate for a specific dynamic survey element within a FeedbackRequest. Created at automation launch time alongside the FeedbackRequest. Immutable after creation except via explicit named operations.

This table is the auditable answer to: "for this feedback request, what entities was this respondent asked to evaluate, in which survey element, and with what display data?" Without this table, the evaluation target list can only be inferred from live association data — which may have changed since launch.

**Multi-phase note:** The same underlying association may appear as an evaluation target across multiple phases. For example, an internal contact's association may be an evaluation target in a customer-side phase (customers evaluate internal team members) and also in a peer-evaluation internal phase. Each phase produces a separate FeedbackRequest with its own assignment rows. The cross-phase relationship is navigable via `feedback_request.collection_run_id → collection_run.audience_type_slug`, not by joining assignment rows directly.

```
evaluation_target_assignment
  id                    UUID          primary key
  organisation_id       UUID          required — tenant isolation
  feedback_request_id   UUID          required — FK to feedback_request.id
  survey_element_id     TEXT          required — Formbricks element/question-group ID (cuid)
                                                  identifies which dynamic survey element these
                                                  targets serve (see Formbricks fork note below)
  element_type          TEXT          required — 'repeating_group' | 'singular_dynamic'
  association_type_slug TEXT          required — which association type slug these targets resolve to;
                                                  references association_type_registry.slug
  association_id        UUID          required — FK to association.id — the target association
  display_data          JSONB         required — resolved display values at assignment creation time
                                                  format: { "key": "value", ... }
                                                  keys match association_type_registry.display_field_mapping
                                                  e.g. { "name": "Matti Virtanen", "role": "Lead Developer" }
  display_order         INTEGER       required — presentation order within this element for this request
  created_at            TIMESTAMPTZ   auto
```

**Design notes:**

- Immutable after creation. Post-send modifications (adding or removing evaluation targets) use `updateEvaluationTargets` (Section 2.3), which deletes and re-inserts assignment rows for the affected element — not in-place updates. Deletions and re-insertions both produce `audit_event` records.
- `display_data` is resolved and frozen at creation time from `association_type_registry.display_field_mapping`. It is not fetched live at payload retrieval time. This ensures the respondent sees a stable set of evaluation targets and display values even if the underlying entities or associations change post-send.
- `display_order` is set at creation time and is stable across survey opens. Without it, the repeating group order could shift between sessions.
- Zero rows for a `(feedback_request_id, survey_element_id)` combination is a valid state — it means no qualifying associations existed for this element at launch time. The rendering layer receives an empty `targets` array and handles it according to the UI decision (skip the element or show a generic fallback).
- One row per target per element per FeedbackRequest. A contact evaluated in two phases (e.g. internal evaluation in both customer and internal phases) has independent assignment rows under two different FeedbackRequests — not shared rows.

**Formbricks fork requirement — `dynamic_elements` declaration:**

Surveys in the Formbricks fork must carry a `dynamic_elements` metadata field that declares which survey elements are dynamic, their type, and which association type slug they resolve against. This is a custom fork addition — it does not exist in upstream Formbricks.

Structure on the survey definition:
```json
{
  "dynamic_elements": [
    {
      "element_id": "cuid-of-question-group",
      "element_type": "repeating_group",
      "target_association_type_slug": "is_internal_at"
    },
    {
      "element_id": "cuid-of-singular-field",
      "element_type": "singular_dynamic",
      "target_association_type_slug": "is_account_owner_of"
    }
  ]
}
```

This declaration is read by the automation layer at launch time (Phase 1 in Section 3.1) to determine which association types to resolve and snapshot. A survey with no `dynamic_elements` entry requires no evaluation target assignments — the FeedbackRequest is created with an empty assignment set.

The `target_association_type_slug` must correspond to a registered type in `association_type_registry` that has a `display_field_mapping` defined. If the slug has no display_field_mapping, the system logs a configuration warning and skips the element.

**Template tag convention in survey content:**

Survey question text and element headers can contain template tags of the form `{{target.key}}`, where `key` corresponds to a key defined in `association_type_registry.display_field_mapping`. The portal rendering layer replaces these tags with the resolved values from `evaluation_target_assignment.display_data` before rendering the question.

Example: "How would you rate the performance of {{target.name}} on this project?" renders as "How would you rate the performance of Matti Virtanen on this project?"

This is a Formbricks fork rendering addition. Tags for which no resolved value is available are replaced with an empty string.

**Indexes:**
- `(feedback_request_id, survey_element_id)` — all targets for a specific element in a request (primary access pattern for payload assembly)
- `(organisation_id, association_id)` — audit: all requests where a given association appeared as an evaluation target
- `(feedback_request_id)` — all assignments for a request across all elements

---

### Deferred: AutomationTemplate (editor-layer configuration)

The AutomationTemplate — the reusable automation definition that users build and edit in the automation editor — is out of scope for this M4 cluster. It belongs to a separate configuration layer upstream of the operational data layer defined here.

**Confirmed design direction for when this is scoped:**

A hybrid structure: typed columns for metadata (name, version, status, created_by, timestamps), and a versioned JSONB document for the template definition itself (phases, actions, content, scheduling parameters, logic). Each time the user saves the template, a new version row is created with the full definition as a JSON document. This gives flexibility to evolve the template schema without database migrations while keeping metadata queryable.

**Justification:** The template definition will evolve significantly — new action types, logic gates, conditional branches, audience-specific overrides. Storing the definition as a versioned JSON document means adding a new concept is a schema change to the document format (no migration), not a database migration. The execution layer defines a contract interface of required fields; the launch materialisation step validates the template satisfies the contract before creating the AutomationPhaseSnapshot.

**The separation:** at launch time, the materialisation step reads the relevant phase definitions from the AutomationTemplate JSON document and creates structured `AutomationPhaseSnapshot` records. After that, running automations reference only the snapshot — the template is no longer in the execution path. Changes to the template do not affect running automations.

---

## Section 2 — API Contract

### 2.0 — Design Decisions

**Query interface: hybrid.** A general-purpose filter DSL covers all read operations. Named operations cover writes and domain-specific mutations. The DSL is scoped to a single entity type per call — cross-entity queries go through the search interface.

**Protocol: hybrid.** GraphQL serves the CRM data service — complex reads, polymorphic types, UI and reporting consumption. REST serves the integration interfaces — Temporal, Formbricks, external sync, background jobs. Both protocols share the same underlying data access layer, the same identity validation, and the same contract guarantees. A write via REST and a write via GraphQL produce identical audit events, identical tenant scoping, and identical validation behaviour.

---

### 2.1 — Shared Contract Guarantees

These guarantees apply to every operation across both protocols unless explicitly stated otherwise.

**Tenant isolation.** Every operation is automatically scoped to the `organisation_id` from the caller's identity token. The caller cannot specify, override, or omit `organisation_id` — it is injected by the API layer from the validated token. Any attempt to access records belonging to a different organisation results in a 404 (not a 403 — the record should appear not to exist).

**Soft delete behaviour.** All read operations filter `date_soft_deleted IS NULL` by default. Deleted records are invisible to standard queries. An explicit `includeSoftDeleted: true` parameter (GraphQL) or `?include_deleted=true` query flag (REST) is available to admin and audit operations only. Write operations that attempt to mutate a soft-deleted record return a 404.

**Audit trail.** Every mutation — create, update, soft delete, restore, hard delete — produces an `audit_event` record atomically within the same transaction. This is a contract guarantee. Callers can depend on audit coverage being complete.

**Cursor-based pagination.** All list operations use cursor-based pagination. Response shape:
```
{
  data: [...],
  pageInfo: {
    startCursor: string,
    endCursor: string,
    hasNextPage: boolean,
    hasPreviousPage: boolean
  },
  totalCount: integer  // included when explicitly requested; expensive on large sets
}
```
Page size defaults to 20. Maximum page size is 100 for standard queries, 500 for batch-optimised export operations. Cursors are opaque strings — callers must not parse or construct them.

**Error shape.** All errors return a structured error object:
```
{
  code: string,        // machine-readable: 'NOT_FOUND', 'VALIDATION_ERROR', 'FORBIDDEN', etc.
  message: string,     // human-readable description
  field: string|null,  // field name for validation errors
  details: object|null // additional context where relevant
}
```

---

### 2.2 — Filter DSL Specification

The filter DSL applies to all read operations on a single entity type. It is borrowed from Twenty's implementation as a specification and reimplemented against Foxie's canonical tables.

#### Operators

| Operator | Meaning | Applicable types |
|---|---|---|
| `eq` | Equal | All |
| `neq` | Not equal | All |
| `gt` | Greater than | Number, Date, Timestamp |
| `gte` | Greater than or equal | Number, Date, Timestamp |
| `lt` | Less than | Number, Date, Timestamp |
| `lte` | Less than or equal | Number, Date, Timestamp |
| `in` | Value is in array | All |
| `nin` | Value is not in array | All |
| `is` | Null check — `IS NULL` or `IS NOT NULL` | All nullable fields |
| `startsWith` | String prefix match (case-sensitive) | Text |
| `endsWith` | String suffix match (case-sensitive) | Text |
| `like` | Pattern match with `%` wildcard (case-sensitive) | Text |
| `ilike` | Pattern match with `%` wildcard (case-insensitive) | Text |

#### Logical conjunctions

Operators are combined with `and`, `or`, and `not`. Conjunctions nest arbitrarily:

```
filter: {
  and: [
    { field: "status", eq: "active" },
    { or: [
      { field: "review_status", eq: "confirmed" },
      { field: "review_status", is: "NULL" }
    ]}
  ]
}
```

#### Field access conventions

- Simple fields: `{ field: "status", eq: "active" }`
- Nested JSONB fields: `{ field: "properties.contract_tier", eq: "enterprise" }` — dot notation
- Relation ID fields: `{ field: "owner_contact_id", eq: "<uuid>" }` — filter by FK directly

The filter DSL does not resolve or traverse relations. If a caller needs to filter contacts by the name of their associated organisation, they first query the entity, then filter contacts by the returned association IDs. This keeps the DSL single-table and prevents unbounded join chains.

#### Scope boundary

The filter DSL applies within one entity type per call. Cross-entity queries — returning mixed results across contacts and organisation entities in a single result set — use the search interface (Section 2.4). This boundary is enforced by the API layer.

#### Sort specification

Sort is specified alongside the filter:
```
sort: [
  { field: "last_reviewed_at", direction: "DESC" },
  { field: "name", direction: "ASC" }
]
```
Multi-field sort is supported. Sort fields must be indexed for sort operations on large result sets — the API layer may reject sort requests on unindexed fields at scale.

---

### 2.3 — Named Mutation Operations

Writes use named operations rather than generic REST PUT/PATCH or GraphQL generic mutations. Each operation has a known contract, a known set of side effects, and a known audit event shape.

#### Contact operations

| Operation | Method (REST) | Mutation (GraphQL) | Description |
|---|---|---|---|
| `createContact` | `POST /contacts` | `createContact(input)` | Create one contact record |
| `createContactsBatch` | `POST /contacts/batch` | `createContactsBatch(inputs[])` | Bulk create up to 200 contacts |
| `updateContact` | `PATCH /contacts/:id` | `updateContact(id, input)` | Update mutable fields on a contact |
| `softDeleteContact` | `DELETE /contacts/:id` | `softDeleteContact(id)` | Set date_soft_deleted; cascades to associations |
| `restoreContact` | `POST /contacts/:id/restore` | `restoreContact(id)` | Clear date_soft_deleted |
| `addContactChannel` | `POST /contacts/:id/channels` | `addContactChannel(contactId, input)` | Add a channel; enforces one-primary-per-type |
| `setPrimaryChannel` | `PATCH /contacts/:id/channels/:channelId/primary` | `setPrimaryChannel(contactId, channelId)` | Set as primary; unsets previous primary atomically |
| `removeContactChannel` | `DELETE /contacts/:id/channels/:channelId` | `removeContactChannel(contactId, channelId)` | Remove a channel |
| `assignTag` | `POST /contacts/:id/tags` | `assignTag(objectType, objectId, tagId)` | Assign a tag; sets `assigned_at` and `assigned_by_id`; enforces no duplicate active assignment |
| `removeTag` | `PATCH /contacts/:id/tags/:tagId/remove` | `removeTag(objectType, objectId, tagId)` | Sets `unassigned_at` and `unassigned_by_id` on the active assignment row — does NOT delete the row. Full assignment history is preserved for temporal queries. |

#### Lifecycle stage operations

| Operation | Method (REST) | Description |
|---|---|---|
| `transitionLifecycleStage` | `POST /entities/:id/lifecycle-stage` | Creates a new `lifecycle_stage_record` for the entity. Atomically sets `exited_at` on the current active stage record. Updates `current_lifecycle_stage` snapshot on `organisation_entity`. Requires `stage_slug` and optional `notes`. Enforces one active stage per entity via partial unique index. |

#### Organisation entity operations

| Operation | Method (REST) | Mutation (GraphQL) | Description |
|---|---|---|---|
| `createOrganisationEntity` | `POST /entities` | `createOrganisationEntity(input)` | Create one entity; validates parent_id for cycles |
| `createOrganisationEntitiesBatch` | `POST /entities/batch` | `createOrganisationEntitiesBatch(inputs[])` | Bulk create up to 200 entities |
| `updateOrganisationEntity` | `PATCH /entities/:id` | `updateOrganisationEntity(id, input)` | Update mutable fields |
| `setReviewStatus` | `PATCH /entities/:id/review-status` | `setReviewStatus(id, status)` | Update review_status; writes last_reviewed_by_id and last_reviewed_at; produces audit event |
| `softDeleteOrganisationEntity` | `DELETE /entities/:id` | `softDeleteOrganisationEntity(id)` | Soft delete; cascades archive to active associations |
| `mergeOrganisationEntities` | `POST /entities/merge` | `mergeOrganisationEntities(input)` | Merge duplicate entities; re-points all association and external ID mapping references to survivor; supports dry run |
| `setParent` | `PATCH /entities/:id/parent` | `setParent(id, parentId)` | Set or change parent; validates cycle prevention |

#### Association operations

| Operation | Method (REST) | Mutation (GraphQL) | Description |
|---|---|---|---|
| `createAssociation` | `POST /associations` | `createAssociation(input)` | Create one association; validates both endpoints exist |
| `updateAssociationReviewStatus` | `PATCH /associations/:id/review-status` | `updateAssociationReviewStatus(id, status)` | Update review_status and activation/archival timestamps |
| `archiveAssociation` | `PATCH /associations/:id/archive` | `archiveAssociation(id)` | Set status to archived; sets archival_timestamp |
| `setAssociationProperties` | `PATCH /associations/:id/properties` | `setAssociationProperties(id, properties)` | Update Tier 2 JSONB properties for this association |

#### External ID mapping operations

| Operation | Method (REST) | Mutation (GraphQL) | Description |
|---|---|---|---|
| `upsertExternalIdMapping` | `POST /external-ids` | `upsertExternalIdMapping(input)` | Create or update a mapping; enforces unique constraint |
| `deleteExternalIdMapping` | `DELETE /external-ids/:id` | `deleteExternalIdMapping(id)` | Remove a mapping |
| `lookupByExternalId` | `GET /external-ids/lookup` | `lookupByExternalId(systemSlug, objectType, externalId)` | Resolve an external ID to a Foxie entity |

#### Batch size limits

| Operation class | Limit |
|---|---|
| Batch create (contacts, entities) | 200 records per request |
| Batch upsert (external ID mappings) | 500 records per request |
| Filter DSL result page | 100 records default; 500 maximum |
| Search results | 20 records default; 100 maximum |

---

#### Automation cluster operations

The automation cluster involves a draft/confirm lifecycle for batch launches, flow control signals for running automations, and operational updates for mutable configuration. Operations that affect running Temporal workflows both update the canonical data layer record AND send a signal to the Temporal workflow via the API gateway — atomically from the caller's perspective.

**BatchLaunch — draft lifecycle**

| Operation | Method (REST) | Description |
|---|---|---|
| `createDraftBatchLaunch` | `POST /batch-launches` | Creates BatchLaunch (`status = 'draft'`), AutomationPhaseSnapshots (one per phase/audience), and SenderAssignments from the provided configuration. Returns the draft BatchLaunch ID. |
| `previewBatchLaunchCohort` | `GET /batch-launches/:id/cohort-preview` | Computes the candidate contact list from live CRM state for each target entity. Applies `draft_exclusions` from the BatchLaunch. Returns a per-entity list of included and excluded contacts. Not a mutation — result is never persisted. Idempotent. |
| `setDraftExclusions` | `PATCH /batch-launches/:id/draft-exclusions` | Persists exclusion decisions. Accepts `{ entity_id: [association_id, ...] }` map. Replaces the full `draft_exclusions` JSONB — not merged. Only valid in `draft` status. |
| `updateDraftSettings` | `PATCH /batch-launches/:id/settings` | Updates `notification_settings`, `archive_settings`, or `target_entity_ids` while BatchLaunch is in `draft` status. |
| `confirmBatchLaunch` | `POST /batch-launches/:id/confirm` | Executes launch: reads target entities, calls cohort preview one final time per entity, applies draft exclusions, creates AutomationCycles, triggers Temporal per cycle. Sets status to `active`. Sets snapshot count fields. Draft fields become read-only. Idempotent — returns existing active launch if already confirmed. |
| `discardDraftBatchLaunch` | `DELETE /batch-launches/:id` | Soft deletes a draft BatchLaunch and its associated AutomationPhaseSnapshots and SenderAssignments. Only valid in `draft` status. |

**BatchLaunch — post-launch operational**

| Operation | Method (REST) | Description |
|---|---|---|
| `updateBatchLaunchSettings` | `PATCH /batch-launches/:id/operational-settings` | Updates `notification_settings` and `archive_settings` on an active BatchLaunch. |
| `archiveBatchLaunch` | `DELETE /batch-launches/:id` | Soft deletes an active or completed BatchLaunch. Does not affect running AutomationCycles. |

**SenderAssignment**

| Operation | Method (REST) | Description |
|---|---|---|
| `updateSenderAssignment` | `PATCH /sender-assignments/:id` | Updates `sender_contact_id` or `channel_type`. Propagates immediately to all CollectionRuns referencing this assignment. Produces audit event. |
| `reassignCollectionRun` | `PATCH /collection-runs/:id/sender-assignment` | Points a specific CollectionRun to a different SenderAssignment. All other CollectionRuns referencing the original assignment are unaffected. |

**AutomationPhaseSnapshot**

| Operation | Method (REST) | Description |
|---|---|---|
| `updateAutomationPhaseSnapshot` | `PATCH /automation-phase-snapshots/:id` | Updates mutable fields: `survey_id`, `reminder_schedule`, `link_behaviour`, `completion_threshold`, `approval_gate`, `settings`. Changes take effect on the next Temporal decision point. Temporal polls or receives a settings-changed signal. Produces audit event. |

**AutomationCycle**

| Operation | Method (REST) | Description |
|---|---|---|
| `pauseAutomationCycle` | `POST /automation-cycles/:id/pause` | Sets `status = 'paused'`. Sends Temporal group workflow signal to pause all active contact-level workflows. |
| `resumeAutomationCycle` | `POST /automation-cycles/:id/resume` | Sets `status = 'active'`. Sends Temporal resume signal. |
| `cancelAutomationCycle` | `POST /automation-cycles/:id/cancel` | Sets `status = 'cancelled'`. Sends Temporal cancel signal. Cascades to all active CollectionRuns in the cycle. |

**CollectionRun**

| Operation | Method (REST) | Description |
|---|---|---|
| `pauseCollectionRun` | `POST /collection-runs/:id/pause` | Sets `status = 'paused'`. Sends Temporal signal to pause contact-level workflows for this phase. |
| `resumeCollectionRun` | `POST /collection-runs/:id/resume` | Sets `status = 'active'`. Sends Temporal resume signal for this phase. |
| `cancelCollectionRun` | `POST /collection-runs/:id/cancel` | Sets `status = 'cancelled'`. Sends Temporal cancel signal. Cancels all active FeedbackRequests in this run. |
| `approveCollectionRun` | `POST /collection-runs/:id/approve` | Valid only when `status = 'awaiting_approval'` (approval gate reached). Sets `status = 'active'` and sends Temporal signal to proceed to next phase. |
| `updateCollectionRunSettings` | `PATCH /collection-runs/:id/settings` | Updates per-run `settings` JSONB override. Merged with snapshot settings at next Temporal decision point. |

**FeedbackRequest (human-facing operations)**

| Operation | Method (REST) | Description |
|---|---|---|
| `createManualFeedbackRequest` | `POST /feedback-requests` | Creates a standalone FeedbackRequest (`collection_run_id = null`, `source = 'manual'`) and atomically issues a `session_token`. Returns both the request ID and the survey URL with embedded token. |
| `cancelFeedbackRequest` | `POST /feedback-requests/:id/cancel` | Sets `status = 'cancelled'`. Revokes the active session token. |
| `resendFeedbackRequest` | `POST /feedback-requests/:id/resend` | Revokes the current session token (`revocation_reason = 'resent'`) and issues a new one. Sends the new survey URL via the contact's primary channel. Does not create a new FeedbackRequest record. |
| `updateEvaluationTargets` | `PATCH /feedback-requests/:id/evaluation-targets` | Updates the evaluation target assignments for a specific survey element post-send. Accepts `{ survey_element_id, add_association_ids[], remove_association_ids[] }`. Removes specified associations (audit_event written), adds new ones with freshly resolved display_data. The respondent sees the updated list on next survey open. Valid only while `status = 'active'` or `'partial'`. |

**EvaluationTargetAssignment (Temporal-internal batch create)**

| Operation | Method (REST) | Description |
|---|---|---|
| `createEvaluationTargetAssignmentsBatch` | `POST /internal/v1/feedback-requests/:id/evaluation-targets/batch` | Creates evaluation target assignment rows for a FeedbackRequest at launch time. Temporal-only — prefixed `/internal/`, not exposed to other consumers. Accepts an array of `{ survey_element_id, element_type, association_type_slug, association_id, display_data, display_order }`. Up to 200 rows per batch. |

**SessionToken**

| Operation | Method (REST) | Description |
|---|---|---|
| `revokeSessionToken` | `POST /session-tokens/:id/revoke` | Sets `revoked_at` and `revocation_reason`. The token is immediately invalid. Used when a contact is excluded post-send. |
| `reissueSessionToken` | `POST /feedback-requests/:id/reissue-token` | Revokes any current active token and creates a new one with updated `expires_at`. Returns the new token hash reference (not the token itself — the token is only in the URL). |

**Note on Temporal signal coupling.** All flow control operations (pause, resume, cancel, approve) both update the canonical data layer record and send a Temporal signal atomically. The API layer sends the signal directly to Temporal via the API gateway — the same mechanism as the completion signal (Section 3, G-07). Temporal does not poll for status changes; it receives explicit signals.

---

### 2.4 — Search Interface

Cross-entity full-text search returns ranked results across contacts and organisation entities simultaneously. The search service runs against PostgreSQL `tsvector` columns on the canonical tables.

#### Search request

```
GET /search?q={query}&types[]={entity_types}&limit={n}   (REST)

query search(q: String!, types: [SearchableEntityType], limit: Int): SearchResult  (GraphQL)
```

- `q` — search terms; prefix matching applied automatically; AND semantics across terms by default
- `types` — optional filter to specific entity types; if omitted, searches all searchable types
- Diacritics normalised via PostgreSQL `unaccent` extension

#### Search result shape

```
{
  results: [
    {
      objectType: "contact" | "organisation_entity",
      objectId: UUID,
      label: string,        // display name: "First Last" for contacts, entity name for organisations
      highlightedLabel: string,  // label with matched terms highlighted
      score: float,         // combined ts_rank_cd + ts_rank score
      imageUrl: string|null // avatar or logo URL if available
    }
  ],
  pageInfo: { ... }         // standard cursor pagination
}
```

#### Ranking

Results are ranked by dual score: `ts_rank_cd` (cover density — rewards proximity of matching terms) descending, then `ts_rank` (term frequency) descending. This is borrowed directly from the Twenty reference as a proven approach.

#### Searchable fields per entity type

| Entity type | Searchable fields |
|---|---|
| `contact` | `first_name`, `last_name`, `email` (from contact_channel) |
| `organisation_entity` | `name` |

#### Search scope

Search automatically applies tenant scoping (`organisation_id` from token) and excludes soft-deleted records. `review_status = 'excluded'` entities are included in search results — exclusion from automation does not mean exclusion from lookup.

---

### 2.5 — GraphQL Schema Shape (CRM Data Service)

The GraphQL API is the primary interface for the CRM UI and reporting layer. It exposes the full canonical data model with polymorphic union types for associations.

#### Core types

```graphql
type Contact {
  id: ID!
  organisationId: ID!
  firstName: String!
  lastName: String!
  language: String!
  channels: [ContactChannel!]!
  associations(filter: AssociationFilter, sort: [SortInput], first: Int, after: String): AssociationConnection!
  tags: [Tag!]!
  externalIds(systemSlug: String): [ExternalIdMapping!]!
  dateSoftDeleted: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

type OrganisationEntity {
  id: ID!
  organisationId: ID!
  name: String!
  type: String!
  parent: OrganisationEntity
  children(first: Int, after: String): OrganisationEntityConnection!
  ownerContact: Contact
  reviewStatus: String!
  lastReviewedBy: Contact
  lastReviewedAt: DateTime
  snapshotRevenue: FinancialSnapshot
  associations(filter: AssociationFilter, sort: [SortInput], first: Int, after: String): AssociationConnection!
  tags: [Tag!]!
  externalIds(systemSlug: String): [ExternalIdMapping!]!
  dateSoftDeleted: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

# Polymorphic association endpoint — either side can be any entity type
union AssociationEndpoint = Contact | OrganisationEntity

type Association {
  id: ID!
  organisationId: ID!
  associationClass: String!
  associationType: String!
  source: AssociationEndpoint!
  target: AssociationEndpoint!
  status: String!
  reviewStatus: String
  activationTimestamp: DateTime
  archivalTimestamp: DateTime
  properties: JSON
  createdAt: DateTime!
  updatedAt: DateTime!
}
```

#### Filter input types

```graphql
input ContactFilter {
  and: [ContactFilter!]
  or: [ContactFilter!]
  not: ContactFilter
  id: UUIDFilterInput
  firstName: StringFilterInput
  lastName: StringFilterInput
  language: StringFilterInput
  dateSoftDeleted: DateTimeFilterInput
  createdAt: DateTimeFilterInput
  updatedAt: DateTimeFilterInput
}

input StringFilterInput {
  eq: String
  neq: String
  in: [String!]
  nin: [String!]
  is: NullCheck
  startsWith: String
  endsWith: String
  like: String
  ilike: String
}

# Equivalent filter input types for UUIDs, Integers, DateTimes follow the same pattern
# NullCheck enum: NULL | NOT_NULL
```

---

### 2.6 — REST Integration Interface Shape

The REST API is the interface for automated services — Temporal workflows, Formbricks fork, external sync jobs, background processes. Operations are simple, predictable, and optimised for machine consumption.

#### Base URL conventions

```
/api/v1/contacts
/api/v1/contacts/:id
/api/v1/contacts/:id/channels
/api/v1/entities
/api/v1/entities/:id
/api/v1/associations
/api/v1/associations/:id
/api/v1/external-ids
/api/v1/search
```

#### Authentication

Every REST request carries a Bearer token in the `Authorization` header. The token is validated by the identity layer. Service accounts use short-lived OAuth 2.0 client credentials tokens. The `organisation_id` is extracted from the token — never from the request body or URL.

#### Filter DSL in REST

Filter expressions are passed as a URL-encoded JSON parameter or in the request body for POST-based list operations:

```
GET /api/v1/contacts?filter={"and":[{"field":"review_status","eq":"confirmed"},{"field":"language","eq":"fi"}]}&sort=[{"field":"last_name","direction":"ASC"}]&first=50&after=<cursor>
```

For complex filters, a POST-based read endpoint is available:
```
POST /api/v1/contacts/query
Content-Type: application/json

{
  "filter": { "and": [...] },
  "sort": [...],
  "first": 50,
  "after": "<cursor>"
}
```

#### Response conventions

All REST responses follow a consistent envelope:

```json
// Success — single record
{
  "data": { ...record fields },
  "meta": { "requestId": "uuid" }
}

// Success — list
{
  "data": [ ...records ],
  "pageInfo": { "startCursor": "...", "endCursor": "...", "hasNextPage": true, "hasPreviousPage": false },
  "meta": { "requestId": "uuid" }
}

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "language must be a valid BCP 47 code",
    "field": "language",
    "details": null
  },
  "meta": { "requestId": "uuid" }
}
```

#### Idempotency

Mutation requests that carry an `Idempotency-Key` header are idempotent — repeating the same request with the same key within 24 hours returns the original response without re-executing the operation. This is required for Temporal workflows, which may retry activity executions.

```
POST /api/v1/contacts
Idempotency-Key: <workflow-run-id>-<activity-id>
```

---

## Section 3 — Integration Interfaces

### 3.0 — Design Decisions

**Protocol:** All integration interfaces use REST. GraphQL is reserved for the CRM UI and reporting layer (Section 2.5). Automated services have well-defined, narrow operations that do not benefit from GraphQL's field selection flexibility.

**Authentication:** All integration consumers authenticate as service accounts using short-lived OAuth 2.0 client credentials tokens issued by the identity layer. Scopes are narrow by default and expanded only when evidence demands it.

**Shared guarantees:** All guarantees from Section 2.1 apply — tenant isolation, soft delete filtering, audit trail, idempotency key support. Idempotency keys are mandatory for all Temporal writes.

---

### 3.1 — Temporal → Canonical Data Layer

Temporal workflows write to the canonical data layer at defined points in the automation lifecycle. All writes use the REST API. All writes carry an `Idempotency-Key` header to make activity retries safe against duplicate writes.

#### Service account scope

```
scope: 'automation_cycle:write collection_run:write cohort_membership:write
        feedback_request:write session_token:write contact:read association:read
        batch_launch:read automation_phase_snapshot:read sender_assignment:read'
```

Read access to configuration entities (BatchLaunch, AutomationPhaseSnapshot, SenderAssignment) is required so Temporal can read settings at workflow start. Temporal does not write to these — they are created by the API layer during the draft/confirm flow.

#### The launch boundary: what the API creates vs. what Temporal creates

The draft/confirm flow (Section 2.3 automation cluster operations) creates everything upstream of Temporal:

**Created by the API layer (before Temporal starts):**
- `batch_launch` — via `createDraftBatchLaunch` + `confirmBatchLaunch`
- `automation_phase_snapshot` — one per phase, created during `createDraftBatchLaunch`
- `sender_assignment` — one per phase/audience, created during `createDraftBatchLaunch`
- `automation_cycle` — one per entity, created during `confirmBatchLaunch`

**Created by Temporal (after workflow starts):**
- `collection_run` — one per phase per AutomationCycle, created when the phase begins
- `cohort_membership` — one per association per CollectionRun, created at phase start
- `feedback_request` — one per contact per CollectionRun, created at phase start
- `session_token` — one per FeedbackRequest, created atomically with the FeedbackRequest

Temporal receives the `automation_cycle.id` as its primary workflow input. From there it reads the BatchLaunch, AutomationPhaseSnapshots, and SenderAssignments to configure itself.

#### Write operations by automation phase

**Phase 0 — Workflow initialisation (on workflow start)**

Temporal reads configuration. No writes.

| Operation | Endpoint | Notes |
|---|---|---|
| Read AutomationCycle | `GET /api/v1/automation-cycles/:id` | Confirm status is `active`; read entity reference and BatchLaunch ID |
| Read AutomationPhaseSnapshots | `GET /api/v1/automation-phase-snapshots?batch_launch_id=:id` | Read phase configurations ordered by `phase_order` |
| Read SenderAssignments | `GET /api/v1/sender-assignments?batch_launch_id=:id` | Read sender and channel per phase |

**Phase 1 — Collection run launch (start of each phase)**

Triggered when the group workflow begins a phase (phase 1 at start; subsequent phases after prior phase completes or approval gate is passed).

| Operation | Endpoint | Notes |
|---|---|---|
| Create CollectionRun | `POST /api/v1/collection-runs` | Carries `automation_cycle_id`, `automation_phase_snapshot_id`, `sender_assignment_id`, `audience_type_slug`, resolved `survey_id`, `phase_order`, `deadline` from snapshot |
| Read survey dynamic elements | `GET {FORMBRICKS_URL}/api/v1/surveys/:survey_id` | Reads the survey's `dynamic_elements` declaration from the Formbricks fork. Identifies which elements are dynamic, their types, and their `target_association_type_slug` values. If no `dynamic_elements` field exists, no evaluation target assignments are created. |
| Query active associations for cohort | `POST /api/v1/associations/query` | Filter: `entity_relationship` class, `status = active`, `review_status IN (confirmed, unsure)`, audience qualifying types, scoped to entity. Returns candidate evaluator list. |
| Apply draft exclusions | Read from `batch_launch.draft_exclusions` | Subtract excluded association_ids from candidate list |
| Query evaluation target associations | `POST /api/v1/associations/query` (per dynamic element) | For each dynamic element's `target_association_type_slug`, query associations of that type for the entity. Returns the evaluation target candidate list per element type. |
| Create CohortMembership rows | `POST /api/v1/collection-runs/:id/cohort-memberships/batch` | One row per association (included or excluded). Up to 200 per batch. |
| Create FeedbackRequest + SessionToken | `POST /api/v1/feedback-requests/batch` | One record per included evaluator contact. Each creation atomically issues a `session_token`. Returns FeedbackRequest IDs. Up to 200 per batch. |
| Create EvaluationTargetAssignment rows | `POST /api/v1/feedback-requests/:id/evaluation-targets/batch` | For each FeedbackRequest, for each dynamic element: create assignment rows from the resolved target list. Resolves `display_data` by reading display fields from target entities using `association_type_registry.display_field_mapping`. Up to 200 rows per batch. |

**Phase 2 — Per-contact workflow execution**

Triggered within each child workflow for one contact.

| Operation | Endpoint | Notes |
|---|---|---|
| Update FeedbackRequest status | `PATCH /api/v1/feedback-requests/:id/status` | Transitions: `active → partial` on first answer; `active/partial → completed` on completion signal; `active/partial → cancelled` on timeout. |

**Phase 3 — Completion signal receipt**

Triggered when Temporal receives the `feedbackCompleted` signal from the Formbricks fork via the API gateway.

| Operation | Endpoint | Notes |
|---|---|---|
| Update FeedbackRequest status | `PATCH /api/v1/feedback-requests/:id/status` | Set to `completed` or `partial`. Sets `completed_at`. |
| Update CollectionRun counters | `PATCH /api/v1/collection-runs/:id/progress` | Increments `completed_count` or `partial_count`, decrements `active_count`. Computed server-side — Temporal sends a signal, not a counter value. |

**Phase 4 — Phase completion**

Triggered when all contacts have reached a terminal state or the deadline has passed.

| Operation | Endpoint | Notes |
|---|---|---|
| Update CollectionRun status | `PATCH /api/v1/collection-runs/:id/status` | Set to `completed` or `cancelled`. |
| Check approval gate | Read `automation_phase_snapshot.approval_gate` | If true, set CollectionRun status to `awaiting_approval` and halt. Wait for `approveCollectionRun` signal before proceeding to next phase. |
| Advance to next phase | Start next CollectionRun | If `approval_gate = false` and another phase exists, begin Phase 1 operations for the next phase. |

**Phase 5 — Cycle completion**

Triggered when all phases have completed.

| Operation | Endpoint | Notes |
|---|---|---|
| Update AutomationCycle status | `PATCH /api/v1/automation-cycles/:id/status` | Set to `completed`. |

**Phase 6 — Timeout or cancellation**

Triggered when a contact workflow reaches its deadline without completion, or when a signal is received from `cancelCollectionRun` or `cancelAutomationCycle`.

| Operation | Endpoint | Notes |
|---|---|---|
| Update FeedbackRequest status | `PATCH /api/v1/feedback-requests/:id/status` | Set to `cancelled`. Revoke session token. |
| Update CollectionRun status | `PATCH /api/v1/collection-runs/:id/status` | Set to `cancelled` or `completed` depending on completion threshold. |
| Update AutomationCycle status | `PATCH /api/v1/automation-cycles/:id/status` | Set to `cancelled` if cycle-level cancellation. |

#### Idempotency key format

```
Idempotency-Key: {workflow-run-id}-{activity-id}-{operation-slug}

Examples:
  run-abc123-act-001-create-collection-run
  run-abc123-act-002-create-cohort-batch-1
  run-abc123-act-003-create-feedback-requests-batch-1
  run-abc123-act-004-update-status-feedback-request-{id}
```

The operation slug prevents key collisions when the same activity ID is reused across multiple operations within one activity execution.

---

### 3.2 — Formbricks / Portal → Canonical Data Layer

The portal (and, until the portal POC determines the final architecture, the Formbricks fork) interacts with the canonical data layer in one direction only: reading data to render the survey experience. No writes originate from this interface. Write interactions (completion signals) go to Temporal via Section 3.6.

Two distinct read endpoints serve two distinct moments in the portal experience:

1. **Session payload endpoint** — called once when a respondent opens a URL token. Resolves the token and returns the minimum data to begin rendering.
2. **Contact feedback requests endpoint** — called by the portal shell to assemble the full view for a contact: all active and historical FeedbackRequests across all AutomationCycles.

#### Service account scope

```
scope: 'feedback_request:read association:read session_token:read'
```

Read-only. The portal and Formbricks fork cannot create, update, or delete any canonical data layer record.

#### Endpoint 1 — Session payload

When a respondent opens a survey URL, this endpoint resolves the opaque token and returns the session context needed to render the survey.

```
GET /api/v1/session-payload/:token
Authorization: Bearer {formbricks-service-account-token}
```

**Token:** Opaque session token embedded in the survey URL. Resolved server-side via hash lookup in `session_token` table. Never a JWT — contents never exposed to the respondent.

**Response — known fields (v0.1):**

```json
{
  "data": {
    "feedbackRequestId": "uuid",
    "contactId": "uuid",
    "contactFirstName": "string",
    "contactLastName": "string",
    "surveyId": "string (cuid)",
    "organisationId": "uuid",
    "sessionScope": "string",
    "dynamicElements": [
      {
        "elementId": "cuid-of-survey-element",
        "elementType": "repeating_group | singular_dynamic",
        "associationTypeSlug": "string",
        "targets": [
          {
            "associationId": "uuid",
            "displayData": {
              "name": "string",
              "role": "string"
            },
            "displayOrder": 1
          }
        ]
      }
    ],
    "expiresAt": "datetime"
  }
}
```

**`dynamicElements`** replaces the former flat `evaluationTargets` array. Each entry corresponds to one dynamic survey element declared in the survey's `dynamic_elements` Formbricks fork metadata. Elements are keyed by `elementId` so the rendering layer can apply each target set to the correct question group or singular field.

`targets` is read from `evaluation_target_assignment` rows for this FeedbackRequest — snapshotted at launch, not computed live from the association table. An empty `targets` array is valid and indicates no qualifying associations existed at launch for that element.

`displayData` keys match the `key` values defined in `association_type_registry.display_field_mapping` for the given `associationTypeSlug`. Template tags in survey content (`{{target.name}}`, `{{target.role}}`) map directly to these keys.

`contactFirstName` and `contactLastName` are included for personalisation (survey greeting, message content). Derived from `feedback_request.contact_id → contact` at payload resolution time.

**G-07 open design task:** The following enrichment fields are explicitly deferred and not in v0.1:
- Contextual enrichment (previous answer summaries, relationship duration) — reserved as `context_data: null` extension point for when the reporting and melting pot layers are available
- Payload versioning — not needed; payload is always current state of assignment rows
- Partial loading strategy — performance concern, not a contract concern; rendering layer handles loading states

**Error responses:**

| Scenario | HTTP status | Error code |
|---|---|---|
| Token not found | 404 | `SESSION_NOT_FOUND` |
| Token expired | 410 | `SESSION_EXPIRED` |
| Token revoked | 410 | `SESSION_REVOKED` |
| FeedbackRequest cancelled | 410 | `SESSION_CANCELLED` |

HTTP 410 (Gone) rather than 401 — the token was valid but is no longer. Meaningful distinction for respondent-facing messaging.

---

#### Endpoint 2 — Contact feedback requests (portal aggregation)

Called by the portal shell after session resolution to build the full contact view. Returns all FeedbackRequests for a specific contact across all AutomationCycles and all automation types — not scoped to any single cycle or batch.

This endpoint is what makes the portal genuinely universal: a contact with active requests from a customer feedback automation and a project feedback automation sees all of them in one place.

```
GET /api/v1/contacts/:contact_id/feedback-requests
Authorization: Bearer {formbricks-service-account-token}
```

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `status` | enum | Filter by status: `active`, `partial`, `completed`, `cancelled`. Omit for all. Multiple values supported: `?status=active&status=partial`. |
| `include_completed` | boolean | Whether to include completed and cancelled requests in the response. Default: `false` (active and partial only). Portal listing view sets `true` to show history. |
| `limit` | integer | Page size. Default 20, maximum 100. |
| `after` | string | Cursor for pagination. |

**Response:**

```json
{
  "data": [
    {
      "feedbackRequestId": "uuid",
      "surveyId": "string (cuid)",
      "status": "active | partial | completed | cancelled",
      "collectionRunId": "uuid | null",
      "audienceTypeSlug": "string | null",
      "entityId": "uuid",
      "entityName": "string",
      "entityType": "string",
      "completedAt": "datetime | null",
      "createdAt": "datetime",
      "evaluationTargets": [
        {
          "associationId": "uuid",
          "entityId": "uuid",
          "entityName": "string",
          "entityType": "string",
          "associationType": "string"
        }
      ]
    }
  ],
  "pageInfo": {
    "startCursor": "string",
    "endCursor": "string",
    "hasNextPage": boolean,
    "hasPreviousPage": boolean
  }
}
```

**Design notes:**

- `audienceTypeSlug` is derived from `feedback_request.collection_run_id → collection_run.audience_type_slug`. Null for standalone manual requests with no CollectionRun.
- `entityId` and `entityName` are derived from the `association.to_object_id` reference — the organisation entity being evaluated. Denormalised in the response for display without additional lookups.
- `evaluationTargets` is included per request so the portal can show which entities each survey covers in the listing view, without a second call per request.
- This endpoint is authenticated with the same Formbricks service account token as the session payload endpoint. The `contact_id` in the URL must match the `contact_id` resolved from the active session token — the portal passes the token-resolved contact ID, not a user-provided one. This enforces that a respondent can only see their own FeedbackRequests.
- The query crosses AutomationCycle boundaries by design. It queries `feedback_request WHERE contact_id = :id AND organisation_id = :org` with status filters applied. No cycle-level scoping.

**Tenant isolation note:** `organisation_id` is injected from the service account token, not from the URL. The contact must belong to the same organisation as the service account. Any attempt to query a contact from a different organisation returns 404.

---

### 3.3 — Identity Layer → Canonical Data Layer

The identity layer does not read from or write to the canonical data layer during normal request handling. Its contribution to every request is the `organisation_id` and identity claims embedded in the token.

The one write interaction occurs at user provisioning time.

#### User provisioning flow

When a new agency staff member account is created in the identity layer, a `user.provisioned` event is emitted. The canonical data layer consumes this event and creates or links a `contact` record.

**Event payload:**
```json
{
  "event": "user.provisioned",
  "userId": "uuid",
  "organisationId": "uuid",
  "email": "string",
  "firstName": "string",
  "lastName": "string",
  "language": "string (BCP 47)",
  "provisionedAt": "datetime"
}
```

**Contact resolution logic — three outcomes:**

1. **Match found:** An active contact exists in the same `organisation_id` with a `contact_channel` record of `channel_type = 'email'` and `channel_value` matching the provisioned email. Link the user account to that existing contact by storing the `userId` → `contactId` mapping in the identity layer. No new contact record is created. An audit event is written: `action: 'user_account_linked', context: { userId, matchedBy: 'email' }`.

2. **No match:** No contact with that email exists in the organisation. Create a new `contact` record with `first_name`, `last_name`, `language`, and `organisation_id` from the event. Create a `contact_channel` record with `channel_type = 'email'`, `channel_value` from the event, `is_primary: true`. Store the `userId` → `contactId` mapping. An audit event is written: `action: 'created', context: { userId, provisionedBy: 'identity_layer' }`.

3. **Multiple matches:** More than one contact with that email exists in the organisation (data quality issue). Do not auto-link. Flag for manual resolution via an admin notification. Create the user account without a linked contact record — the user can log in but their activity will not be attributed to a contact record until the duplicate is resolved.

**Contact deduplication note:** Email is the provisioning key for v0.1. More sophisticated matching (name similarity, external ID cross-reference) is deferred.

#### Token claim → data layer enforcement

Every API request carries an identity token. The canonical data layer extracts two claims on every request:

| Claim | Field | Usage |
|---|---|---|
| `organisation_id` | Injected into every query `WHERE` clause | Tenant isolation — no query runs without this |
| `sub` (subject) | Resolved to `contact_id` for audit events | `changed_by_id` in `audit_event` records |
| `token_type` | Determines permission scope | `'staff'` gets full access; `'service_account'` gets scope-limited access; `'respondent'` gets session-only read access |

The data layer never trusts `organisation_id` from the request body or URL parameters. It always comes from the validated token.

---

### 3.4 — External System Sync → Canonical Data Layer

External systems — HubSpot, Salesforce, ERP systems — sync contact and entity data into Foxie. Sync is unidirectional in this interface: external system → Foxie. Foxie → external system sync is out of scope and deferred.

#### Service account scope

Each external system integration authenticates with a system-specific service account scope:

```
scope: 'hubspot:sync'        — for HubSpot sync jobs
scope: 'salesforce:sync'     — for Salesforce sync jobs
scope: 'erp:sync'            — for ERP/billing system sync jobs
```

Each sync scope grants: `contact:write`, `organisation_entity:write`, `external_id_mapping:write`. It does not grant access to `feedback_request`, `collection_run`, `association`, or other Foxie-owned operational records.

#### Sync write operations

| Operation | Endpoint | Notes |
|---|---|---|
| Create or update contact | `POST /api/v1/contacts` or `PATCH /api/v1/contacts/:id` | Conflict resolution applies (see below) |
| Create or update entity | `POST /api/v1/entities` or `PATCH /api/v1/entities/:id` | Conflict resolution applies |
| Upsert external ID mapping | `POST /api/v1/external-ids` | Creates or updates the mapping; `upsertExternalIdMapping` operation from Section 2.3 |
| Lookup by external ID | `GET /api/v1/external-ids/lookup` | Resolves external ID to Foxie entity before deciding whether to create or update |

#### Sync flow

For each record in the external system:

1. **Lookup:** Call `lookupByExternalId` with `system_slug`, `object_type`, and `external_id`. 
2. **If found:** A Foxie entity already maps to this external record. Apply conflict resolution to decide whether to update.
3. **If not found:** Create a new Foxie entity via `createContact` or `createOrganisationEntity`. Then upsert the external ID mapping.

#### Conflict resolution — Foxie wins with recency threshold

When an external sync attempts to update a Foxie record that has also been modified within Foxie, the following principle applies:

**Foxie wins** for records that have been modified by a human user (`audit_event.changed_by_type = 'user'`) within the recency threshold. The external sync update is skipped for those records; only the `external_id_mapping.synced_at` timestamp is updated to confirm the mapping is current.

**External system wins** for records that have not been modified by a human user within the recency threshold, or for records where the specific field being updated was last set by a previous sync (not by a user). These records accept the external update.

**Specific parameters requiring further definition before implementation:**
- The recency threshold value (candidate: 30 days — any record touched by a user in the last 30 days is protected)
- Field-level vs. record-level granularity (whether individual fields can have different protection status — e.g. financial snapshot fields may always accept sync updates regardless of recency)
- How the sync job surfaces skipped records for visibility (a sync report endpoint or log is likely needed)

**Financial snapshot fields** always accept external sync updates regardless of the recency threshold. These fields are explicitly designed to be refreshed from external systems — the Foxie-wins principle applies to CRM data (names, contact details, relationship data), not to financial time-series data.

#### External sync audit

All sync writes produce `audit_event` records with `changed_by_type = 'service_account'` and `context: { systemSlug: 'hubspot', externalId: '...', syncJobId: '...' }`. This makes it possible to audit which records were last modified by an external sync vs. by a user.

---

### 3.6 — Completion Signal Contract (Formbricks → Temporal)

The completion signal notifies Temporal that a respondent has completed their feedback. It flows from the Formbricks fork through a Foxie API gateway to the Temporal group workflow, which routes the signal to the appropriate contact-level child workflow.

**Source:** Migrated from M3 draft contracts Section 3e. Updated for M4: snake_case field names, gateway lookup updated to use the group workflow path rather than a direct contact workflow lookup, reconciliation endpoint updated to M4 REST paths.

#### Signal direction and trigger

**Direction:** Formbricks fork → Foxie API gateway → Temporal group workflow → contact child workflow

**Trigger:** The `responseFinished` event in Formbricks — when `Response.finished` transitions to `true`. The fork emits an active API call to the gateway rather than a fire-and-forget webhook.

Partial completion signalling (where Temporal needs to know a respondent has started but not finished) is deferred for v0.1. The primary signal covers full completion only.

#### Signal payload

| Field | Type | Description |
|---|---|---|
| `feedback_request_id` | UUID | Identifies the FeedbackRequest. Used by the gateway to resolve the target Temporal group workflow. Type consistent with `feedback_request.id`. |
| `completion_degree` | enum: `"full"` \| `"partial"` | `"full"` = `Response.finished = true`. `"partial"` = answers submitted but survey not finished. |
| `timestamp` | datetime (ISO 8601) | When the completion event occurred. |
| `respondent_contact_id` | UUID | CRM contact ID of the respondent. Used for correlation and validation at the group workflow. |

#### Delivery flow

```
Formbricks fork
  → HTTP POST {FOXIE_GATEWAY_URL}/signals/feedback-completed
    → Gateway resolves feedbackRequestId → group workflow identifiers
      → Gateway calls Temporal SignalWorkflowExecution gRPC
        → Group workflow receives signal and routes to contact child workflow
          → Child workflow updates state; Temporal writes to canonical data layer
```

**Step-by-step:**

| Step | Component | Action |
|---|---|---|
| 1 | Formbricks fork | Detects `responseFinished` event. Constructs payload from session context (JWT carries `feedback_request_id`). |
| 2 | Formbricks fork | HTTP POST to `{FOXIE_GATEWAY_URL}/signals/feedback-completed` with JSON payload. |
| 3 | Foxie API gateway | Validates payload. Resolves `feedback_request_id` → `collection_run_id` → `automation_cycle_id` → `automation_cycle.temporal_workflow_id` via two FK hops on the canonical data layer. |
| 4 | Foxie API gateway | Calls Temporal `SignalWorkflowExecution` gRPC: `signal_name = "feedbackCompleted"`, target = group workflow at `automation_cycle.temporal_workflow_id`, `input` = encoded payload. |
| 5 | Temporal group workflow | Receives signal. Looks up which child contact workflow corresponds to `feedback_request_id` (maintained in workflow in-memory state). Forwards signal to child. |
| 6 | Temporal contact workflow | Receives signal. Updates internal state. Triggers canonical data layer writes (Phase 3 in Section 3.1). |
| 7 | Foxie API gateway | Returns HTTP 200 `{ "status": "accepted" }` to Formbricks fork. |

**Why group workflow, not direct contact workflow signalling:** The contact-level Temporal workflow ID is not stored in the canonical data layer — there is no operational use case for it outside Temporal's own execution context. The group workflow already maintains the `feedback_request_id → child workflow` mapping as part of its fan-out state. Signalling the group workflow avoids storing Temporal-internal identifiers in the database and keeps the signal routing concern inside Temporal where it belongs.

#### Failure handling and retry

**Formbricks fork retry policy:**
- On HTTP 4xx/5xx or network error: retry with exponential backoff
- 3 attempts: delays of 1s, 5s, 30s
- Retries are asynchronous — they must NOT block the pipeline `Promise.allSettled` in the pipeline handler. Implement as a deferred/queued retry outside the pipeline handler.
- After exhausting retries: log failure with `feedback_request_id`, `timestamp`, and error for reconciliation pickup.

**Successful confirmation:** HTTP 200. The fork does not treat a 200 as guaranteed delivery to the child workflow — it confirms the group workflow received the signal. Child workflow processing is async.

#### Fallback: Temporal reconciliation query

The contact workflow maintains a periodic reconciliation timer as a safety net against lost signals.

1. Timer fires every 30 minutes (configurable via `automation_phase_snapshot.settings`).
2. If no completion signal has been received, the workflow queries `GET /api/v1/feedback-requests/:feedback_request_id`.
3. If `status` is `"completed"` or `"partial"` but the workflow has not advanced, the workflow self-advances as if the signal had arrived.
4. This ensures eventual consistency. Under normal operation, the primary signal delivers within seconds and reconciliation never triggers.

The reconciliation query uses Temporal's own service account credentials — the same read scope used for Phase 0 configuration reads.

#### Formbricks fork changes required

Three changes required. File paths and line numbers confirmed from M3 source investigation.

| Change | File | Lines | What |
|---|---|---|---|
| Active API call on `responseFinished` | `apps/web/app/api/(internal)/pipeline/route.ts` | 214-222 | Add Foxie gateway HTTP POST as an additional promise in the existing `Promise.allSettled` array. Natural isolation — does not fail-fast or block other webhooks. `sendToPipeline()` at `apps/web/app/lib/pipelines.ts:5-25` is already fire-and-forget. |
| Async retry logic | New utility in fork | — | Exponential backoff retry for the gateway call. First attempt in `Promise.allSettled`. Retries scheduled asynchronously after first failure — must NOT hold the pipeline open. 3 attempts: 1s, 5s, 30s. |
| `feedback_request_id` extraction + completion degree derivation | Session/response context in pipeline | — | Extract `feedback_request_id` from extended JWT token. Derive `completion_degree` from `Response.finished`: `true → "full"`, `false → "partial"`. |

**Note:** `feedbackRequestId` must already be in the JWT for the answer row trickle-down path (Section 1.23 fork changes). The completion signal extraction reuses the same JWT extension — no additional JWT change is needed beyond what Section 1.23 already requires.

---

### 3.5 — Integration Interface Summary

| Interface | Direction | Protocol | Auth scope | Key open item |
|---|---|---|---|---|
| Temporal writes | Temporal → Canonical | REST | Write: automation_cycle, collection_run, cohort_membership, feedback_request, session_token, evaluation_target_assignment. Read: batch_launch, automation_phase_snapshot, sender_assignment, contact, association | None — fully documented in Section 3.1 |
| Formbricks session read + portal aggregation | Formbricks fork / Portal → Canonical | REST | Read-only: feedback_request, association, session_token | G-07 contextual enrichment deferred — v0.1 payload complete |
| Completion signal | Formbricks fork → Gateway → Temporal | HTTP + gRPC | Gateway service account only | Partial completion signalling deferred to v0.1+ |
| Answer row write | Portal shell → Reporting write layer | HTTP POST | Portal service account: answer_row:write | Future direction: replace HTTP with event bus |
| Identity provisioning | Identity → Canonical | Event (user.provisioned) | N/A — internal event | Multi-match resolution requires admin tooling |
| External sync | External → Canonical | REST | System-specific sync scope | Conflict resolution parameters need implementation-time configuration |

---

### 3.7 — Formbricks Fork → Reporting Write Layer (Answer Row)

Every time a respondent answers or modifies a question, the portal shell receives per-question data via the Formbricks SDK's `onResponse` callback and writes it to the Reporting write layer. This is the trickle-down write path that populates `standardised_answer_row` (Section 1.23) from the SDK's callback output.

**Updated mechanism (2026-03-19 POC finding):** The original design specified diff detection in Formbricks' `updateResponse()` server function. The POC confirmed a cleaner approach: the portal shell uses the SDK's callback path (omitting `appUrl`/`environmentId`), which delivers per-question data directly via `onResponse` with zero Formbricks network calls and zero fork changes to the response handling pipeline. The portal shell owns the write path entirely.

This is an internal endpoint — prefixed `/internal/` to distinguish it from the consumer-facing API.

#### Service account scope

The portal service account carries one write scope in addition to its read scopes:

```
scope: 'feedback_request:read association:read session_token:read answer_row:write'
```

#### Endpoint

```
POST /internal/v1/answer-rows/upsert
Authorization: Bearer {portal-service-account-token}
Content-Type: application/json
```

#### Request payload

The portal shell constructs this from the SDK `onResponse` callback output plus its own session context:

```json
{
  "feedback_request_id": "uuid",
  "survey_id": "string (cuid)",
  "question_id": "string (cuid)",
  "answer_value": "string | number | string[] | Record<string,string>",
  "answer_type": "text | value | choices | structured",
  "evaluator_association_id": "uuid",
  "eval_target_association_id": "uuid | null"
}
```

`feedback_request_id`, `evaluator_association_id`, and `eval_target_association_id` come from the portal shell's session state (resolved at session start from the Foxie session token). `question_id` and `answer_value` come from the SDK's `onResponse` callback payload: `{data: {"question-id": value}, finished: bool, ttc: {...}}`. `answer_type` is derived from the question type in the survey definition.

#### Response

```
HTTP 202 Accepted
{ "status": "queued" }
```

#### Upsert behaviour

The Reporting write layer:
1. Receives the payload
2. Resolves `organisation_entity_id` from `feedback_request_id → association → to_object_id`
3. Maps `answer_value` to the correct typed field based on `answer_type`
4. Upserts on key `(feedback_request_id, question_id, eval_target_association_id)`

#### Failure handling (portal shell side)

- On HTTP 5xx or network error: retry with exponential backoff, 3 attempts at 1s/5s/30s delays
- After exhausting retries: log with `feedback_request_id`, `question_id`, and error. Do not block the survey session.
- Raw answer data is not persisted by the SDK in callback-only mode — the portal shell is the only write path. This means failure logging is more important here than in the original diff-detection design, where Formbricks Layer 1 provided a fallback.

On HTTP 4xx: do not retry. Log and alert — indicates schema or auth mismatch.

#### Future direction: event bus

The HTTP POST transport is the initial implementation. When Foxie's infrastructure supports it, replace with an event bus message. The payload structure is identical — transport changes, contract does not.

---

## Open Items

| Item | Notes |
|---|---|
| Portal-as-universal-container | Direction decided (portal is universal container). Build path (fork vs. custom) pending POC results. See `universal-portal-decision-and-poc-scope.md`. |
| Portal convergence logic | Notification identity conflict when multiple AutomationCycles share a centralised sender. Unresolved. Separate design task. |
| G-07 — Session payload contextual enrichment | v0.1 payload is fully defined. Contextual enrichment reserved as `context_data: null` extension point. Requires reporting and melting pot layers. Not a blocker for implementation. |
| Singular dynamic element — skip vs. generic fallback | When no qualifying associations exist for a singular_dynamic element, rendering layer receives empty targets[]. Skip vs. generic fallback is a UI decision not yet made. |
| Formbricks fork consolidated change summary | Fork scope confirmed minimal by POC. Required changes: EE unlock, completion signal gateway call, `dynamic_elements` declaration, template tag rendering. Diff detection and JWT extension not needed for portal path. Full implementation spec is a separate agent briefing document. |
| AutomationTemplate (editor layer) | Schema deferred. Design direction confirmed: hybrid typed columns + versioned JSONB. See deferred note after Section 1.24. |
| Formbricks and Temporal M3 contract revisions | M3 contracts require revision against the new canonical layer. M4 is now substantially complete — this is the final cross-cutting task. |
| Sync conflict resolution parameters | Recency threshold and field-level granularity need implementation-time configuration (Section 3.4). |
| Admin tooling for multi-match provisioning | Manual resolution UI for multiple contact matches on provisioning not yet specified. |
| Search vector strategy | tsvector columns on contact and organisation_entity deferred until search service is scoped. |
| audit_event partitioning | Table partitioning by changed_at deferred until operational scale is anticipated. |
| Financial data layer full scoping | financial_record is a placeholder. |
| GraphQL subscriptions | Real-time data push deferred. |
| Rate limiting | Per-tenant rate limits deferred to infrastructure scoping. |
