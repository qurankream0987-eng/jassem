/**
 * JASIM DNA Descriptor — Intent → World Definition
 *
 * Converts structured intent into a complete World DNA.
 * Uses LLM for generative inference with deterministic validation.
 * Falls back to pattern-based generation when LLM is unavailable.
 */

import { z } from "zod";
import {
  type IntentStructure,
  type WorldDNA,
  type EntityDefinition,
  type FieldDefinition,
  type RelationDefinition,
  type CapabilityBinding,
  type WorkflowDefinition,
  type UIDescriptor,
  type PolicyDefinition,
  WorldDNASchema,
  validateWorldDNA,
} from "@contracts/dna";
import { llmRouter } from "./llm-router";

// ═══════════════════════════════════════════════════════════════════════════════
// Prompt Templates
// ═══════════════════════════════════════════════════════════════════════════════

const DNA_GENERATION_PROMPT = `You are JASIM's DNA Engine. Convert a user intent into a structured World Definition.

A World Definition describes:
- Entities (data models)
- Relations (how entities connect)
- Capabilities (what operations are possible)
- Workflows (common sequences of operations)
- UI descriptors (what screens are needed)
- Policies (rules and constraints)

Rules:
1. Use GENERIC names — no domain-specific branding.
2. Entities should be reusable concepts (e.g. "Listing" not "FurnitureListing").
3. Capabilities must use generic primitives: CREATE, READ, UPDATE, DELETE, SEARCH, FILTER, SORT, COMPARE, CONTACT, NEGOTIATE, CONFIRM, VERIFY, TRACK.
4. Every entity needs at minimum: id, createdAt, updatedAt, status.
5. Include ownership/permission fields where appropriate.
6. UI descriptors should describe layout needs, not implementation.

Return ONLY valid JSON matching this structure:
{
  "name": "human-readable world name",
  "description": "what this world enables",
  "entities": [
    {
      "id": "unique-id",
      "name": "EntityName",
      "label": "Human Label",
      "fields": [
        {
          "id": "field-id",
          "name": "fieldName",
          "type": "string|number|boolean|date|datetime|email|url|text|rich_text|image|file|currency|enum|reference|geolocation",
          "label": "Human Label",
          "validation": { "required": true|false, "min": number, "max": number, "minLength": number, "maxLength": number },
          "searchable": true|false,
          "filterable": true|false,
          "sortable": true|false
        }
      ],
      "lifecycle": {
        "states": ["draft", "active", "archived"],
        "initialState": "draft",
        "transitions": [{ "from": "draft", "to": "active", "trigger": "publish" }]
      }
    }
  ],
  "relations": [
    { "id": "rel-id", "name": "hasMany", "fromEntity": "entity-id", "toEntity": "entity-id", "cardinality": "one_to_one|one_to_many|many_to_one|many_to_many" }
  ],
  "capabilities": [
    { "capabilityId": "generic.CREATE", "targetEntity": "entity-id" },
    { "capabilityId": "generic.SEARCH", "targetEntity": "entity-id" },
    { "capabilityId": "generic.FILTER", "targetEntity": "entity-id" }
  ],
  "workflows": [
    {
      "id": "wf-id",
      "name": "Create and Publish",
      "trigger": "user_initiated",
      "steps": [
        { "id": "step-1", "name": "Create", "capabilityBinding": "generic.CREATE" }
      ]
    }
  ],
  "ui": [
    {
      "id": "ui-1",
      "type": "form|list|detail|search|filter|comparison|gallery|progress|confirmation|actions",
      "entityId": "entity-id",
      "title": "Screen Title",
      "fields": ["field-id"],
      "actions": [{ "id": "act-1", "label": "Submit", "capabilityBinding": "generic.CREATE" }]
    }
  ],
  "policies": [
    { "id": "pol-1", "name": "Owner can edit", "type": "authorization", "target": "entity-id", "condition": "owner == self", "action": "allow" }
  ]
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// Pattern-Based Fallback Generation
// ═══════════════════════════════════════════════════════════════════════════════

interface PatternMatch {
  keywords: string[];
  generator: (intent: IntentStructure) => WorldDNA;
}

function createBaseEntity(id: string, name: string, label: string): EntityDefinition {
  return {
    id,
    name,
    label,
    fields: [
      { id: `${id}_id`, name: "id", type: "uuid", label: "ID", validation: { required: true }, searchable: false, filterable: false, sortable: false, displayable: false },
      { id: `${id}_createdAt`, name: "createdAt", type: "datetime", label: "Created At", validation: { required: true }, searchable: false, filterable: true, sortable: true, displayable: true },
      { id: `${id}_updatedAt`, name: "updatedAt", type: "datetime", label: "Updated At", validation: { required: true }, searchable: false, filterable: false, sortable: true, displayable: false },
      { id: `${id}_status`, name: "status", type: "enum", label: "Status", validation: { required: true, enum: ["draft", "active", "archived"] }, searchable: false, filterable: true, sortable: false, displayable: true },
    ],
    relations: [],
    lifecycle: {
      states: ["draft", "active", "archived"],
      initialState: "draft",
      transitions: [
        { from: "draft", to: "active", trigger: "publish" },
        { from: "active", to: "archived", trigger: "archive" },
      ],
    },
    permissions: [],
  };
}

function generateMarketplaceDNA(intent: IntentStructure): WorldDNA {
  // Extract target item type from intent
  const itemType = intent.objects.find(o => o.type === "product" || o.attributes?.category)?.name || "Item";
  const itemLabel = itemType.charAt(0).toUpperCase() + itemType.slice(1);

  const userEntity: EntityDefinition = {
    ...createBaseEntity("user", "User", "User"),
    fields: [
      ...createBaseEntity("user", "User", "User").fields,
      { id: "user_name", name: "name", type: "string", label: "Name", validation: { required: true, maxLength: 100 }, searchable: true, filterable: false, sortable: true, displayable: true },
      { id: "user_email", name: "email", type: "email", label: "Email", validation: { required: true }, searchable: false, filterable: false, sortable: false, displayable: true },
      { id: "user_phone", name: "phone", type: "string", label: "Phone", validation: { maxLength: 20 }, searchable: false, filterable: false, sortable: false, displayable: true },
      { id: "user_location", name: "location", type: "geolocation", label: "Location", validation: {}, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "user_rating", name: "rating", type: "number", label: "Rating", validation: { min: 0, max: 5, default: 0 }, searchable: false, filterable: true, sortable: true, displayable: true },
    ],
  };

  const listingEntity: EntityDefinition = {
    ...createBaseEntity("listing", "Listing", itemLabel),
    fields: [
      ...createBaseEntity("listing", "Listing", itemLabel).fields,
      { id: "listing_title", name: "title", type: "string", label: "Title", validation: { required: true, maxLength: 200 }, searchable: true, filterable: false, sortable: true, displayable: true },
      { id: "listing_description", name: "description", type: "rich_text", label: "Description", validation: { maxLength: 5000 }, searchable: true, filterable: false, sortable: false, displayable: true },
      { id: "listing_price", name: "price", type: "currency", label: "Price", validation: { required: true, min: 0 }, searchable: false, filterable: true, sortable: true, displayable: true },
      { id: "listing_condition", name: "condition", type: "enum", label: "Condition", validation: { enum: ["new", "like_new", "good", "fair", "poor"] }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "listing_images", name: "images", type: "image", label: "Images", validation: { maxLength: 10 }, searchable: false, filterable: false, sortable: false, displayable: true },
      { id: "listing_category", name: "category", type: "string", label: "Category", validation: { required: true }, searchable: true, filterable: true, sortable: true, displayable: true },
      { id: "listing_ownerId", name: "ownerId", type: "reference", label: "Owner", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "listing_location", name: "location", type: "geolocation", label: "Location", validation: {}, searchable: false, filterable: true, sortable: false, displayable: true },
    ],
  };

  const offerEntity: EntityDefinition = {
    ...createBaseEntity("offer", "Offer", "Offer"),
    fields: [
      ...createBaseEntity("offer", "Offer", "Offer").fields,
      { id: "offer_listingId", name: "listingId", type: "reference", label: "Listing", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "offer_buyerId", name: "buyerId", type: "reference", label: "Buyer", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "offer_amount", name: "amount", type: "currency", label: "Offer Amount", validation: { required: true, min: 0 }, searchable: false, filterable: true, sortable: true, displayable: true },
      { id: "offer_message", name: "message", type: "text", label: "Message", validation: { maxLength: 1000 }, searchable: false, filterable: false, sortable: false, displayable: true },
    ],
    lifecycle: {
      states: ["pending", "accepted", "rejected", "withdrawn"],
      initialState: "pending",
      transitions: [
        { from: "pending", to: "accepted", trigger: "accept" },
        { from: "pending", to: "rejected", trigger: "reject" },
        { from: "pending", to: "withdrawn", trigger: "withdraw" },
      ],
    },
  };

  const messageEntity: EntityDefinition = {
    ...createBaseEntity("message", "Message", "Message"),
    fields: [
      ...createBaseEntity("message", "Message", "Message").fields,
      { id: "message_senderId", name: "senderId", type: "reference", label: "Sender", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "message_receiverId", name: "receiverId", type: "reference", label: "Receiver", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "message_content", name: "content", type: "text", label: "Content", validation: { required: true, maxLength: 2000 }, searchable: true, filterable: false, sortable: false, displayable: true },
      { id: "message_read", name: "read", type: "boolean", label: "Read", validation: { default: false }, searchable: false, filterable: true, sortable: false, displayable: true },
    ],
  };

  const transactionEntity: EntityDefinition = {
    ...createBaseEntity("transaction", "Transaction", "Transaction"),
    fields: [
      ...createBaseEntity("transaction", "Transaction", "Transaction").fields,
      { id: "transaction_listingId", name: "listingId", type: "reference", label: "Listing", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "transaction_buyerId", name: "buyerId", type: "reference", label: "Buyer", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "transaction_sellerId", name: "sellerId", type: "reference", label: "Seller", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "transaction_finalPrice", name: "finalPrice", type: "currency", label: "Final Price", validation: { required: true, min: 0 }, searchable: false, filterable: true, sortable: true, displayable: true },
    ],
    lifecycle: {
      states: ["pending", "confirmed", "completed", "cancelled"],
      initialState: "pending",
      transitions: [
        { from: "pending", to: "confirmed", trigger: "confirm" },
        { from: "confirmed", to: "completed", trigger: "complete" },
        { from: "pending", to: "cancelled", trigger: "cancel" },
      ],
    },
  };

  const entities = [userEntity, listingEntity, offerEntity, messageEntity, transactionEntity];

  const relations: RelationDefinition[] = [
    { id: "rel_user_listings", name: "owns", fromEntity: "user", toEntity: "listing", cardinality: "one_to_many", inverseName: "owner" },
    { id: "rel_listing_offers", name: "hasOffers", fromEntity: "listing", toEntity: "offer", cardinality: "one_to_many", inverseName: "listing" },
    { id: "rel_user_offers", name: "madeOffers", fromEntity: "user", toEntity: "offer", cardinality: "one_to_many", inverseName: "buyer" },
    { id: "rel_user_messages_sent", name: "sentMessages", fromEntity: "user", toEntity: "message", cardinality: "one_to_many", inverseName: "sender" },
    { id: "rel_user_messages_received", name: "receivedMessages", fromEntity: "user", toEntity: "message", cardinality: "one_to_many", inverseName: "receiver" },
    { id: "rel_listing_transaction", name: "hasTransaction", fromEntity: "listing", toEntity: "transaction", cardinality: "one_to_one", inverseName: "listing" },
  ];

  const capabilities: CapabilityBinding[] = [
    { capabilityId: "generic.CREATE", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.READ", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.UPDATE", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.DELETE", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.SEARCH", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.FILTER", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.SORT", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.COMPARE", targetEntity: "listing", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.CREATE", targetEntity: "offer", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.CREATE", targetEntity: "message", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.CREATE", targetEntity: "transaction", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.CONFIRM", targetEntity: "offer", inputMapping: {}, outputMapping: {} },
    { capabilityId: "generic.VERIFY", targetEntity: "transaction", inputMapping: {}, outputMapping: {} },
  ];

  const workflows: WorkflowDefinition[] = [
    {
      id: "wf_create_listing",
      name: "Create Listing",
      trigger: "user_initiated",
      steps: [
        { id: "wf_step_create", name: "Create", capabilityBinding: "generic.CREATE", inputs: {}, conditions: [] },
        { id: "wf_step_verify", name: "Verify", capabilityBinding: "generic.VERIFY", inputs: {}, conditions: [] },
      ],
      edges: [{ from: "wf_step_create", to: "wf_step_verify" }],
    },
    {
      id: "wf_make_offer",
      name: "Make Offer",
      trigger: "user_initiated",
      steps: [
        { id: "wf_step_search", name: "Search", capabilityBinding: "generic.SEARCH", inputs: {}, conditions: [] },
        { id: "wf_step_compare", name: "Compare", capabilityBinding: "generic.COMPARE", inputs: {}, conditions: [], optional: true },
        { id: "wf_step_offer", name: "Offer", capabilityBinding: "generic.CREATE", inputs: {}, conditions: [] },
      ],
      edges: [
        { from: "wf_step_search", to: "wf_step_compare" },
        { from: "wf_step_compare", to: "wf_step_offer" },
        { from: "wf_step_search", to: "wf_step_offer", condition: "skip_compare" },
      ],
    },
  ];

  const ui: UIDescriptor[] = [
    {
      id: "ui_search",
      type: "search",
      entityId: "listing",
      title: "Search",
      fields: ["listing_title", "listing_description", "listing_category", "listing_price", "listing_condition", "listing_location"],
      actions: [{ id: "act_search", label: "Search", capabilityBinding: "generic.SEARCH", variant: "primary" }],
      layout: { searchable: true, filterable: true, sortable: true, paginated: true, pageSize: 20 },
    },
    {
      id: "ui_listing_form",
      type: "form",
      entityId: "listing",
      title: "New Listing",
      fields: ["listing_title", "listing_description", "listing_price", "listing_condition", "listing_category", "listing_images", "listing_location"],
      actions: [
        { id: "act_create", label: "Create", capabilityBinding: "generic.CREATE", variant: "primary" },
        { id: "act_cancel", label: "Cancel", capabilityBinding: "generic.CREATE", variant: "ghost" },
      ],
    },
    {
      id: "ui_listing_detail",
      type: "detail",
      entityId: "listing",
      title: "Listing Details",
      fields: ["listing_title", "listing_description", "listing_price", "listing_condition", "listing_category", "listing_images", "listing_location", "listing_ownerId"],
      actions: [
        { id: "act_contact", label: "Contact", capabilityBinding: "generic.CREATE", variant: "primary" },
        { id: "act_offer", label: "Make Offer", capabilityBinding: "generic.CREATE", variant: "secondary" },
      ],
    },
    {
      id: "ui_compare",
      type: "comparison",
      entityId: "listing",
      title: "Compare",
      fields: ["listing_title", "listing_price", "listing_condition", "listing_category", "listing_location"],
      actions: [{ id: "act_compare", label: "Compare", capabilityBinding: "generic.COMPARE", variant: "primary" }],
    },
  ];

  const policies: PolicyDefinition[] = [
    { id: "pol_owner_edit", name: "Owner can edit own listings", type: "authorization", target: "listing", condition: "ownerId == self", action: "allow" },
    { id: "pol_owner_delete", name: "Owner can delete own listings", type: "authorization", target: "listing", condition: "ownerId == self", action: "allow" },
    { id: "pol_public_read", name: "Anyone can read active listings", type: "authorization", target: "listing", condition: "status == active", action: "allow" },
  ];

  return {
    id: `world_${Date.now()}`,
    name: intent.goal.slice(0, 50),
    description: intent.goal,
    version: "1.0.0",
    entities,
    relations,
    capabilities,
    workflows,
    ui,
    policies,
    theme: { direction: "rtl", density: "normal" },
    generatedFrom: intent.goal,
    confidence: intent.confidence,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Lending Pattern (Novel Task)
// ═══════════════════════════════════════════════════════════════════════════════

function generateToolLendingDNA(intent: IntentStructure): WorldDNA {
  const userEntity: EntityDefinition = {
    ...createBaseEntity("user", "User", "User"),
    fields: [
      ...createBaseEntity("user", "User", "User").fields,
      { id: "user_name", name: "name", type: "string", label: "Name", validation: { required: true }, searchable: true, filterable: false, sortable: true, displayable: true },
      { id: "user_location", name: "location", type: "geolocation", label: "Location", validation: {}, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "user_rating", name: "rating", type: "number", label: "Rating", validation: { min: 0, max: 5, default: 0 }, searchable: false, filterable: true, sortable: true, displayable: true },
    ],
  };

  const toolEntity: EntityDefinition = {
    ...createBaseEntity("tool", "ToolItem", "Tool"),
    fields: [
      ...createBaseEntity("tool", "ToolItem", "Tool").fields,
      { id: "tool_name", name: "name", type: "string", label: "Tool Name", validation: { required: true }, searchable: true, filterable: false, sortable: true, displayable: true },
      { id: "tool_description", name: "description", type: "text", label: "Description", validation: {}, searchable: true, filterable: false, sortable: false, displayable: true },
      { id: "tool_category", name: "category", type: "string", label: "Category", validation: {}, searchable: true, filterable: true, sortable: true, displayable: true },
      { id: "tool_ownerId", name: "ownerId", type: "reference", label: "Owner", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "tool_condition", name: "condition", type: "enum", label: "Condition", validation: { enum: ["excellent", "good", "fair", "worn"] }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "tool_availability", name: "availability", type: "enum", label: "Availability", validation: { required: true, enum: ["available", "borrowed", "unavailable"] }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "tool_images", name: "images", type: "image", label: "Images", validation: {}, searchable: false, filterable: false, sortable: false, displayable: true },
    ],
    lifecycle: {
      states: ["draft", "active", "archived"],
      initialState: "draft",
      transitions: [
        { from: "draft", to: "active", trigger: "publish" },
        { from: "active", to: "archived", trigger: "archive" },
      ],
    },
  };

  const borrowRequestEntity: EntityDefinition = {
    ...createBaseEntity("borrow_request", "BorrowRequest", "Borrow Request"),
    fields: [
      ...createBaseEntity("borrow_request", "BorrowRequest", "Borrow Request").fields,
      { id: "br_toolId", name: "toolId", type: "reference", label: "Tool", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "br_borrowerId", name: "borrowerId", type: "reference", label: "Borrower", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "br_startDate", name: "startDate", type: "date", label: "Start Date", validation: { required: true }, searchable: false, filterable: true, sortable: true, displayable: true },
      { id: "br_endDate", name: "endDate", type: "date", label: "End Date", validation: { required: true }, searchable: false, filterable: true, sortable: true, displayable: true },
      { id: "br_purpose", name: "purpose", type: "text", label: "Purpose", validation: { maxLength: 500 }, searchable: false, filterable: false, sortable: false, displayable: true },
    ],
    lifecycle: {
      states: ["pending", "approved", "rejected", "active", "returned", "completed"],
      initialState: "pending",
      transitions: [
        { from: "pending", to: "approved", trigger: "approve" },
        { from: "pending", to: "rejected", trigger: "reject" },
        { from: "approved", to: "active", trigger: "handover" },
        { from: "active", to: "returned", trigger: "return" },
        { from: "returned", to: "completed", trigger: "confirm_return" },
      ],
    },
  };

  const reviewEntity: EntityDefinition = {
    ...createBaseEntity("review", "Review", "Review"),
    fields: [
      ...createBaseEntity("review", "Review", "Review").fields,
      { id: "review_requestId", name: "requestId", type: "reference", label: "Request", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "review_reviewerId", name: "reviewerId", type: "reference", label: "Reviewer", validation: { required: true }, searchable: false, filterable: true, sortable: false, displayable: true },
      { id: "review_rating", name: "rating", type: "number", label: "Rating", validation: { required: true, min: 1, max: 5 }, searchable: false, filterable: true, sortable: true, displayable: true },
      { id: "review_comment", name: "comment", type: "text", label: "Comment", validation: { maxLength: 1000 }, searchable: false, filterable: false, sortable: false, displayable: true },
    ],
  };

  const entities = [userEntity, toolEntity, borrowRequestEntity, reviewEntity];

  const relations: RelationDefinition[] = [
    { id: "rel_user_tools", name: "owns", fromEntity: "user", toEntity: "tool", cardinality: "one_to_many", inverseName: "owner" },
    { id: "rel_tool_requests", name: "hasRequests", fromEntity: "tool", toEntity: "borrow_request", cardinality: "one_to_many", inverseName: "tool" },
    { id: "rel_user_requests", name: "madeRequests", fromEntity: "user", toEntity: "borrow_request", cardinality: "one_to_many", inverseName: "borrower" },
    { id: "rel_request_review", name: "hasReview", fromEntity: "borrow_request", toEntity: "review", cardinality: "one_to_one", inverseName: "request" },
  ];

  const capabilities: CapabilityBinding[] = [
    { capabilityId: "generic.CREATE", targetEntity: "tool" },
    { capabilityId: "generic.READ", targetEntity: "tool" },
    { capabilityId: "generic.SEARCH", targetEntity: "tool" },
    { capabilityId: "generic.FILTER", targetEntity: "tool" },
    { capabilityId: "generic.CREATE", targetEntity: "borrow_request" },
    { capabilityId: "generic.UPDATE", targetEntity: "borrow_request" },
    { capabilityId: "generic.CONFIRM", targetEntity: "borrow_request" },
    { capabilityId: "generic.CREATE", targetEntity: "review" },
    { capabilityId: "generic.TRACK", targetEntity: "borrow_request" },
  ];

  const workflows: WorkflowDefinition[] = [
    {
      id: "wf_borrow",
      name: "Borrow Tool",
      trigger: "user_initiated",
      steps: [
        { id: "step_search", name: "Search", capabilityBinding: "generic.SEARCH" },
        { id: "step_request", name: "Request", capabilityBinding: "generic.CREATE" },
        { id: "step_approve", name: "Approve", capabilityBinding: "generic.CONFIRM" },
      ],
      edges: [{ from: "step_search", to: "step_request" }, { from: "step_request", to: "step_approve" }],
    },
  ];

  const ui: UIDescriptor[] = [
    {
      id: "ui_search_tools",
      type: "search",
      entityId: "tool",
      title: "Search Tools",
      fields: ["tool_name", "tool_category", "tool_condition", "tool_location"],
      actions: [{ id: "act_search", label: "Search", capabilityBinding: "generic.SEARCH", variant: "primary" }],
      layout: { searchable: true, filterable: true, sortable: true, paginated: true, pageSize: 20 },
    },
    {
      id: "ui_tool_detail",
      type: "detail",
      entityId: "tool",
      title: "Tool Details",
      fields: ["tool_name", "tool_description", "tool_category", "tool_condition", "tool_ownerId", "tool_availability"],
      actions: [
        { id: "act_borrow", label: "Request to Borrow", capabilityBinding: "generic.CREATE", variant: "primary" },
      ],
    },
  ];

  const policies: PolicyDefinition[] = [
    { id: "pol_owner_tool", name: "Owner controls tool", type: "authorization", target: "tool", condition: "ownerId == self", action: "allow" },
    { id: "pol_public_read", name: "Public can view available tools", type: "authorization", target: "tool", condition: "availability == available", action: "allow" },
  ];

  return {
    id: `world_${Date.now()}`,
    name: intent.goal.slice(0, 50),
    description: intent.goal,
    version: "1.0.0",
    entities,
    relations,
    capabilities,
    workflows,
    ui,
    policies,
    theme: { direction: "rtl", density: "normal" },
    generatedFrom: intent.goal,
    confidence: intent.confidence,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pattern Registry
// ═══════════════════════════════════════════════════════════════════════════════

const PATTERNS: PatternMatch[] = [
  {
    keywords: [
      "سوق", "بيع", "شراء", "marketplace", "listing", "offer", "product", "item",
      "أثاث", "furniture", "سيارة", "car", "هاتف", "phone", "كتاب", "book",
    ],
    generator: generateMarketplaceDNA,
  },
  {
    keywords: [
      "أداة", "استعارة", "إعارة", "استعارة", "tool", "lend", "borrow", "rent",
      "neighbor", "جار", "حي", "معدات", "equipment",
    ],
    generator: generateToolLendingDNA,
  },
];

function matchPattern(intent: IntentStructure): ((intent: IntentStructure) => WorldDNA) | null {
  const text = `${intent.goal} ${intent.domainHints.join(" ")} ${intent.objects.map(o => o.name).join(" ")}`.toLowerCase();
  let bestMatch: ((intent: IntentStructure) => WorldDNA) | null = null;
  let bestScore = 0;

  for (const pattern of PATTERNS) {
    let score = 0;
    for (const kw of pattern.keywords) {
      if (text.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = pattern.generator;
    }
  }

  return bestScore >= 2 ? bestMatch : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DNA Descriptor Engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface DNADescriptorOptions {
  useLLM?: boolean;
  fallbackToPattern?: boolean;
  validateOutput?: boolean;
}

export class DNADescriptor {
  async generate(intent: IntentStructure, options: DNADescriptorOptions = {}): Promise<WorldDNA> {
    const { useLLM = true, fallbackToPattern = true, validateOutput = true } = options;

    // Try LLM generation first
    if (useLLM) {
      try {
        const llmDna = await this.generateWithLLM(intent);
        if (llmDna) {
          if (validateOutput) {
            const validation = validateWorldDNA(llmDna);
            if (validation.valid) return llmDna;
            console.warn("[DNADescriptor] LLM-generated DNA failed validation:", validation.errors);
          } else {
            return llmDna;
          }
        }
      } catch (err) {
        console.warn("[DNADescriptor] LLM generation failed:", err);
      }
    }

    // Fallback to pattern-based generation
    if (fallbackToPattern) {
      const pattern = matchPattern(intent);
      if (pattern) {
        const dna = pattern(intent);
        if (validateOutput) {
          const validation = validateWorldDNA(dna);
          if (validation.valid) return dna;
          console.warn("[DNADescriptor] Pattern-generated DNA failed validation:", validation.errors);
        } else {
          return dna;
        }
      }
    }

    // Ultimate fallback: generic single-entity world
    return this.generateGenericDNA(intent);
  }

  private async generateWithLLM(intent: IntentStructure): Promise<WorldDNA | null> {
    const response = await llmRouter.route({
      complexity: "complex",
      prompt: `${DNA_GENERATION_PROMPT}\n\nUser Intent: ${intent.goal}\nActors: ${JSON.stringify(intent.actors)}\nObjects: ${JSON.stringify(intent.objects)}\nActions: ${JSON.stringify(intent.actions)}\nConstraints: ${JSON.stringify(intent.constraints)}`,
      systemPrompt: "You are JASIM's DNA Engine. Generate structured World Definitions. Return ONLY valid JSON.",
      responseFormat: "json",
      temperature: 0.3,
      maxTokens: 4000,
    });

    if (!response?.text) return null;

    const parsed = JSON.parse(response.text);
    // Inject metadata
    parsed.id = `world_${Date.now()}`;
    parsed.generatedFrom = intent.goal;
    parsed.confidence = response.confidence ?? 0.8;
    parsed.version = "1.0.0";
    parsed.createdAt = new Date().toISOString();

    return parsed as WorldDNA;
  }

  private generateGenericDNA(intent: IntentStructure): WorldDNA {
    const mainObject = intent.objects[0]?.name || "Item";
    const entity: EntityDefinition = {
      ...createBaseEntity("main", mainObject, mainObject),
      fields: [
        ...createBaseEntity("main", mainObject, mainObject).fields,
        { id: "main_name", name: "name", type: "string", label: "Name", validation: { required: true }, searchable: true, filterable: false, sortable: true, displayable: true },
        { id: "main_description", name: "description", type: "text", label: "Description", validation: {}, searchable: true, filterable: false, sortable: false, displayable: true },
      ],
    };

    return {
      id: `world_${Date.now()}`,
      name: intent.goal.slice(0, 50),
      description: intent.goal,
      version: "1.0.0",
      entities: [entity],
      relations: [],
      capabilities: [
        { capabilityId: "generic.CREATE", targetEntity: "main" },
        { capabilityId: "generic.READ", targetEntity: "main" },
        { capabilityId: "generic.UPDATE", targetEntity: "main" },
        { capabilityId: "generic.DELETE", targetEntity: "main" },
        { capabilityId: "generic.SEARCH", targetEntity: "main" },
      ],
      workflows: [],
      ui: [
        {
          id: "ui_main_list",
          type: "list",
          entityId: "main",
          title: mainObject,
          fields: ["main_name", "main_description"],
          actions: [
            { id: "act_create", label: "Create", capabilityBinding: "generic.CREATE", variant: "primary" },
            { id: "act_search", label: "Search", capabilityBinding: "generic.SEARCH", variant: "secondary" },
          ],
          layout: { searchable: true, filterable: true, sortable: true },
        },
      ],
      policies: [],
      theme: { direction: "rtl", density: "normal" },
      generatedFrom: intent.goal,
      confidence: 0.5,
    };
  }
}

// Singleton
let dnaDescriptorInstance: DNADescriptor | null = null;

export function getDNADescriptor(): DNADescriptor {
  if (!dnaDescriptorInstance) {
    dnaDescriptorInstance = new DNADescriptor();
  }
  return dnaDescriptorInstance;
}
